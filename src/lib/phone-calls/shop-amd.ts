/**
 * Google Voice answers the shop <Number> before a person does. Sequential dial
 * then never moves on to Mike, and the caller sits on that bridge for minutes.
 * Twilio answering-machine detection runs on the shop leg only. A person stays
 * with the shop. A machine, fax, or unknown result hangs that leg up so the
 * Dial action can dial Mike while the caller is still here.
 * Mike's voice, greeting, and callback flag are not involved.
 */
import { aiFallbackNumber } from './config.ts';
import {
  amdFromProcessing,
  recordAnsweredParty,
  withAmd,
} from './missed-alert.ts';
import { buildAiHandoffTwiml } from './twiml.ts';

const CALL_SID = /^CA[0-9a-f]{32}$/i;

export type ShopAmdDecision = {
  /** ignore: empty or unrecognized, do not lock the row. keep: a person. roll: dial Mike. */
  action: 'keep' | 'roll' | 'ignore';
  kind: 'human' | 'machine' | null;
};

/**
 * `Enable` returns human, machine_start, fax, or unknown.
 * `DetectMessageEnd` also returns machine_end_*.
 * unknown means Twilio never heard a person (silence or a tone it would not call speech).
 * An empty value is not a result: do not record it, or a retry could not roll the call.
 */
export function shopAmdDecision(answeredBy: string | null | undefined): ShopAmdDecision {
  const value = (answeredBy || '').trim().toLowerCase();
  if (!value) return { action: 'ignore', kind: null };
  if (value === 'human') return { action: 'keep', kind: 'human' };
  if (value === 'fax' || value === 'unknown' || value.startsWith('machine')) return { action: 'roll', kind: 'machine' };
  return { action: 'ignore', kind: null };
}

/**
 * The shop in-progress callback fires when Google Voice answers, before anyone speaks.
 * That is not a shop answer. A completed shop leg still counts, unless AMD already said machine.
 */
export function shopLegRecordsAnswer(input: {
  party: string | null;
  params: Record<string, string>;
  processingError?: string | null;
}): boolean {
  if (input.party !== 'shop' && input.party !== 'mike') return false;
  if (input.party === 'shop' && amdFromProcessing(input.processingError) === 'machine') return false;
  const status = (input.params.CallStatus || '').toLowerCase();
  if (input.party === 'shop' && (status === 'in-progress' || status === 'answered')) return false;
  const dur = parseInt(input.params.CallDuration || input.params.Duration || '0', 10);
  if (status === 'in-progress' || status === 'answered') return true;
  if (status !== 'completed') return false;
  return Number.isFinite(dur) && dur > 0;
}

type Claim = 'ok' | 'lost' | 'error';

async function claimProcessing(db: any, callSid: string, previous: string | null, next: string): Promise<Claim> {
  let query = db.from('inbound_call_recordings').update({
    processing_error: next,
    updated_at: new Date().toISOString(),
  }).eq('call_sid', callSid);
  query = previous == null ? query.is('processing_error', null) : query.eq('processing_error', previous);
  const claimed = await query.select('call_sid');
  if (claimed?.error) return 'error';
  return claimed?.data?.length ? 'ok' : 'lost';
}

export type AmdRecord = {
  status: 'recorded' | 'already' | 'missing' | 'error';
  kind: 'human' | 'machine' | null;
  previous: string | null;
  next: string | null;
};

/** First AMD result on the parent call wins. */
export async function recordShopAmd(db: any, callSid: string, kind: 'human' | 'machine'): Promise<AmdRecord> {
  const loaded = await db.from('inbound_call_recordings').select('call_sid, processing_error').eq('call_sid', callSid).maybeSingle();
  const row = loaded?.data;
  if (!row) return { status: 'missing', kind: null, previous: null, next: null };
  const current = row.processing_error ?? null;
  const existing = amdFromProcessing(current);
  if (existing) return { status: 'already', kind: existing, previous: current, next: current };
  const next = withAmd(current, kind);
  const result = await claimProcessing(db, callSid, current, next);
  if (result === 'ok') return { status: 'recorded', kind, previous: current, next };
  if (result === 'error') return { status: 'error', kind: null, previous: current, next: null };
  const again = await db.from('inbound_call_recordings').select('processing_error').eq('call_sid', callSid).maybeSingle();
  const now = again?.data?.processing_error ?? null;
  return { status: 'already', kind: amdFromProcessing(now), previous: current, next: now };
}

export async function revertShopAmd(db: any, callSid: string, previous: string | null, next: string): Promise<void> {
  await db.from('inbound_call_recordings').update({
    processing_error: previous,
    updated_at: new Date().toISOString(),
  }).eq('call_sid', callSid).eq('processing_error', next);
}

export type TwilioCallWrite = 'ok' | 'finished' | 'error';

/** Point a live call at new TwiML. `finished` means Twilio says that call already ended. */
export async function setCallTwiml(
  callSid: string,
  twiml: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<TwilioCallWrite> {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token || !CALL_SID.test(callSid)) return 'error';
  const body = new URLSearchParams();
  body.set('Twiml', twiml);
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls/${encodeURIComponent(callSid)}.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );
  } catch (error) {
    console.error('[phone-calls] amd call update failed', error instanceof Error ? error.message : error);
    return 'error';
  }
  if (response.ok) return 'ok';
  const text = await response.text().catch(() => '');
  if (response.status === 400 && /not in-progress|not in progress/i.test(text)) return 'finished';
  console.error('[phone-calls] amd call update failed', response.status, text.slice(0, 180));
  return 'error';
}

const HANGUP_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';

function mikeTwiml(env: NodeJS.ProcessEnv): string | null {
  const ai = aiFallbackNumber(new URLSearchParams('ai=1'), env);
  if (!ai) return null;
  const base = (env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app').replace(/\/$/, '');
  return buildAiHandoffTwiml(ai, base, '?rolled=1&leg=mike');
}

export type ShopAmdResult = { httpStatus: number; action: 'keep' | 'roll' | 'ignored' };

/**
 * Record the AMD result, then either leave the shop leg up (human) or hang it up (machine)
 * so /api/calls/inbound/status can dial Mike. The marker is written first: the status
 * callback runs only after the hangup, and it must see amd:machine.
 * Without a database row, redirect the parent straight to Mike. That path is the fallback
 * when the inbound log never inserted.
 */
export async function handleShopAmd(input: {
  answeredBy: string | null | undefined;
  parentCallSid: string | null | undefined;
  childCallSid: string | null | undefined;
  db: any | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<ShopAmdResult> {
  const decision = shopAmdDecision(input.answeredBy);
  if (decision.action === 'ignore' || !decision.kind) return { httpStatus: 200, action: 'ignored' };
  const parent = (input.parentCallSid || '').trim();
  const child = (input.childCallSid || '').trim();
  if (!CALL_SID.test(parent) || (child && parent === child)) return { httpStatus: 200, action: 'ignored' };
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const canHangup = CALL_SID.test(child) && child !== parent;

  if (!input.db) {
    if (decision.action === 'keep') return { httpStatus: 200, action: 'keep' };
    const twiml = mikeTwiml(env);
    if (!twiml) return { httpStatus: 500, action: 'roll' };
    const wrote = await setCallTwiml(parent, twiml, env, fetchImpl);
    return { httpStatus: wrote === 'error' ? 500 : 200, action: 'roll' };
  }

  const recorded = await recordShopAmd(input.db, parent, decision.kind);
  if (recorded.status === 'error') return { httpStatus: 500, action: decision.action };
  if (recorded.status === 'missing') {
    if (decision.action === 'keep') return { httpStatus: 200, action: 'keep' };
    const twiml = mikeTwiml(env);
    if (!twiml) return { httpStatus: 500, action: 'roll' };
    const wrote = await setCallTwiml(parent, twiml, env, fetchImpl);
    return { httpStatus: wrote === 'error' ? 500 : 200, action: 'roll' };
  }
  if (recorded.kind !== 'machine') {
    if (recorded.kind === 'human' && recorded.status === 'recorded') {
      try { await recordAnsweredParty(input.db, parent, 'shop'); }
      catch (error) { console.error('[phone-calls] amd human note failed', error instanceof Error ? error.message : error); }
    }
    return { httpStatus: 200, action: recorded.kind === 'human' ? 'keep' : 'ignored' };
  }
  if (!canHangup) {
    if (recorded.status === 'recorded' && recorded.next) {
      try { await revertShopAmd(input.db, parent, recorded.previous, recorded.next); }
      catch (error) { console.error('[phone-calls] amd revert failed', error instanceof Error ? error.message : error); }
    }
    return { httpStatus: 200, action: 'ignored' };
  }
  const hung = await setCallTwiml(child, HANGUP_TWIML, env, fetchImpl);
  if (hung === 'error' && recorded.status === 'recorded' && recorded.next) {
    try { await revertShopAmd(input.db, parent, recorded.previous, recorded.next); }
    catch (error) { console.error('[phone-calls] amd revert failed', error instanceof Error ? error.message : error); }
    return { httpStatus: 500, action: 'roll' };
  }
  if (hung === 'error') return { httpStatus: 500, action: 'roll' };
  return { httpStatus: 200, action: 'roll' };
}
