/**
 * One office email for every inbound call: shop answered, missed, or Mike.
 * Mike's email waits until his call has ended, then uses his end-of-call report
 * (summary and outcome) so the office does not also get that email separately.
 * Mike's voice, greeting, and callback flag are not involved.
 */
import { formatPhoneDisplay, OFFICE_ALERT_EMAILS } from '../receptionist/office-callback.ts';
import { AI_RECEPTIONIST, PORTED_LINES, TRACKING_SOURCES, directToAi } from './config.ts';
import { finalStatusPatch, hangupSummary } from './final-status.ts';
import { RECORDING_NOTICE_SECONDS } from './ring-timeout.ts';

/** Claim token stored on the call row so a Twilio retry cannot send a second email. */
export const CALL_ALERT_MARKER = 'call-alert-sent';
/** Older claim token. Still means this call was already emailed. */
export const MISSED_ALERT_MARKER = 'missed-alert-sent';
/** `leg:shop` or `leg:mike`, written when that party answers. */
export const LEG_PREFIX = 'leg:';

export type AnsweredBy = 'shop' | 'mike' | 'missed';

export function processingParts(value: string | null | undefined): string[] {
  return (value || '').split('|').map((part) => part.trim()).filter(Boolean);
}

export function hasAlertMarker(value: string | null | undefined): boolean {
  return processingParts(value).some((part) => part === CALL_ALERT_MARKER || part === MISSED_ALERT_MARKER);
}

export function partyFromProcessing(value: string | null | undefined): 'shop' | 'mike' | null {
  const part = processingParts(value).find((item) => item.startsWith(LEG_PREFIX));
  const party = part?.slice(LEG_PREFIX.length);
  return party === 'shop' || party === 'mike' ? party : null;
}

/** Keep the alert claim and the answered-party token; append a recording note. */
export function mergeProcessingError(current: string | null | undefined, note: string | null | undefined): string | null {
  const kept = processingParts(current).filter((part) => part === CALL_ALERT_MARKER || part === MISSED_ALERT_MARKER || part.startsWith(LEG_PREFIX));
  if (note && !kept.includes(note)) kept.push(note);
  return kept.length ? kept.join('|') : null;
}

export function withParty(current: string | null | undefined, party: 'shop' | 'mike'): string {
  if (partyFromProcessing(current)) return current || '';
  return [...processingParts(current), `${LEG_PREFIX}${party}`].join('|');
}

export function withAlert(current: string | null | undefined): string {
  const rest = processingParts(current).filter((part) => part !== CALL_ALERT_MARKER && part !== MISSED_ALERT_MARKER);
  return [CALL_ALERT_MARKER, ...rest].join('|');
}

const BRIGHTON = 'brighton@scwellservice.com';

/** Brighton always, plus the office list, each address once. */
export function missedAlertRecipients(extra: readonly string[] = OFFICE_ALERT_EMAILS): string[] {
  const out: string[] = [];
  for (const raw of [BRIGHTON, ...extra]) {
    const email = raw.trim().toLowerCase();
    if (email && !out.includes(email)) out.push(email);
  }
  return out;
}

const SOURCE_LABEL: Record<string, string> = {
  google_ads: 'Google Ads',
  google_ads_drilling: 'Google Ads · Drilling',
  google_ads_weekend: 'Google Ads · Weekend',
  seo: 'Website',
  yelp: 'Yelp',
  apple_maps: 'Apple Maps',
  gbp_ramona: 'Google profile · Ramona',
  gbp_anza: 'Google profile · Anza',
  direct: 'Direct',
  direct_mail: 'Direct mail',
  toll_free: 'Toll-free',
  line_7963: 'Line 823-7963',
  main_line: 'Main',
  ransom_line: 'Ransom',
  test: 'Test',
};

export function lineLabel(called: string | null | undefined, source: string | null | undefined): string {
  const number = called ? formatPhoneDisplay(called) : '';
  const fromNumber = called ? SOURCE_LABEL[TRACKING_SOURCES[called] || ''] : '';
  const fromSource = source && source !== 'test' ? SOURCE_LABEL[source] : '';
  const port = called ? Object.values(PORTED_LINES).find((l) => l.number === called)?.label : '';
  const name = fromNumber || fromSource || port || (source === 'test' ? 'Test' : '');
  if (name && number) return `${name} ${number}`;
  return name || number || 'Unknown line';
}

export function formatPacific(when: Date): string {
  const text = when.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${text} PT`;
}

export function callDashboardUrl(callSid: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app').replace(/\/$/, '');
  return `${base}/ops/calls?call=${encodeURIComponent(callSid)}`;
}

/**
 * Shop ring, not the whole call. The recording notice is about 5 seconds and is not ringing.
 * A hang-up during that notice never rang the shop.
 */
export function ringSecondsForAlert(input: {
  phase: 'before_dial' | 'dial';
  startedAt: string | null | undefined;
  now: Date;
  noticePlayed: boolean;
}): number {
  if (input.phase === 'before_dial') return 0;
  const started = Date.parse(input.startedAt || '');
  if (!Number.isFinite(started)) return 0;
  const elapsed = Math.max(0, Math.round((input.now.getTime() - started) / 1000));
  if (input.noticePlayed) return Math.max(0, elapsed - RECORDING_NOTICE_SECONDS);
  return elapsed;
}

function secondsLabel(n: number): string {
  return `${n} second${n === 1 ? '' : 's'}`;
}

export function durationLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return secondsLabel(s);
  const minutes = Math.floor(s / 60);
  const rem = s % 60;
  const minuteLabel = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (!rem) return minuteLabel;
  return `${minuteLabel} ${secondsLabel(rem)}`;
}

const WHO_LABEL: Record<AnsweredBy, string> = { shop: 'Shop', mike: 'Mike', missed: 'Missed' };

export type InboundAlertCopyInput = {
  callSid: string;
  caller: string | null | undefined;
  called: string | null | undefined;
  source: string | null | undefined;
  when: Date;
  who: AnsweredBy;
  /** Ring seconds when missed, talk seconds when someone answered. */
  durationSeconds: number;
  summary?: string | null;
  outcome?: string | null;
};

export function inboundFactBlock(input: InboundAlertCopyInput, env: NodeJS.ProcessEnv = process.env): string {
  const durationName = input.who === 'missed' ? 'Ring duration' : 'Talk duration';
  return [
    `Answered by: ${WHO_LABEL[input.who]}`,
    `Caller: ${input.caller ? formatPhoneDisplay(input.caller) : 'Unknown caller'}`,
    `Line: ${lineLabel(input.called, input.source)}`,
    `Time: ${formatPacific(input.when)}`,
    `${durationName}: ${durationLabel(input.durationSeconds)}`,
    `Dashboard: ${callDashboardUrl(input.callSid, env)}`,
  ].join('\n');
}

export function inboundAlertCopy(input: InboundAlertCopyInput, env: NodeJS.ProcessEnv = process.env): { subject: string; text: string } {
  const caller = input.caller ? formatPhoneDisplay(input.caller) : 'Unknown caller';
  const lead = input.who === 'shop'
    ? 'The shop answered this call.'
    : input.who === 'mike'
      ? 'Mike answered this call.'
      : 'Nobody answered this call.';
  const text = [
    lead,
    '',
    inboundFactBlock(input, env),
    input.outcome ? `Outcome: ${input.outcome}` : '',
    input.summary ? `Summary: ${input.summary}` : '',
  ].filter((line) => line !== '').join('\n');
  const subject = input.who === 'shop'
    ? `Shop answered: ${caller}`
    : input.who === 'mike'
      ? `Mike answered: ${caller}`
      : `Missed call: ${caller}`;
  return { subject, text };
}

/** @deprecated Use inboundAlertCopy. Kept so older call sites still describe a miss. */
export function missedAlertCopy(input: {
  callSid: string;
  caller: string | null | undefined;
  called: string | null | undefined;
  source: string | null | undefined;
  when: Date;
  ringSeconds: number;
  phase: 'before_dial' | 'dial';
  callLengthSeconds?: number | null;
}, env: NodeJS.ProcessEnv = process.env): { subject: string; text: string } {
  return inboundAlertCopy({
    callSid: input.callSid,
    caller: input.caller,
    called: input.called,
    source: input.source,
    when: input.when,
    who: 'missed',
    durationSeconds: input.ringSeconds,
  }, env);
}

const ANSWERED = new Set(['completed', 'answered']);

/**
 * What the <Dial action> should do.
 * handoff: caller is still here and Mike has not been dialed yet.
 * send now: shop answered, or nobody did. A canceled dial means the caller is
 * already gone, so TwiML returned from this request will not run.
 * defer: Mike answered. His end-of-call report sends the one email, with the summary.
 */
export function inboundCallEmailPlan(input: {
  dialStatus: string | null | undefined;
  canHandoff: boolean;
  party: 'shop' | 'mike' | null;
  /** This dial's only number was Mike (after hours, or the follow-up leg). */
  mikeOnly: boolean;
  /** Mike was one of the numbers in this dial. */
  mikeInDial: boolean;
}): { handoff: boolean; send: 'now' | 'defer' | 'no'; who: AnsweredBy | null } {
  const status = (input.dialStatus || '').trim().toLowerCase();
  if (ANSWERED.has(status)) {
    if (input.party === 'shop') return { handoff: false, send: 'now', who: 'shop' };
    if (input.party === 'mike' || input.mikeOnly) return { handoff: false, send: 'defer', who: 'mike' };
    // Both numbers were dialed and the leg callback has not arrived. Wait for Mike's
    // report if it was him. The sweep does not send a shop backup until that report
    // has had time to claim the row.
    if (input.mikeInDial) return { handoff: false, send: 'defer', who: 'mike' };
    return { handoff: false, send: 'now', who: 'shop' };
  }
  if (status === 'canceled' || status === 'cancelled') return { handoff: false, send: 'now', who: 'missed' };
  if (input.canHandoff && (status === 'no-answer' || status === 'busy' || status === 'failed')) {
    return { handoff: true, send: 'no', who: null };
  }
  return { handoff: false, send: 'now', who: 'missed' };
}

export function statusCallbackPlan(input: { dialStatus: string | null | undefined; canHandoff: boolean }): { handoff: boolean; alert: boolean } {
  const plan = inboundCallEmailPlan({ ...input, party: null, mikeOnly: false, mikeInDial: false });
  return { handoff: plan.handoff, alert: plan.send === 'now' };
}

/** Final status for a call that never reached <Dial>. Rows that already have a dial result are left to the status callback. */
export function abandonAlertDecision(input: {
  params: Record<string, string>;
  row: { dial_status: string | null; processing_status: string } | null;
}): { closeOut: boolean; alert: boolean } {
  const patch = finalStatusPatch(input.params);
  if (!patch || !input.row) return { closeOut: false, alert: false };
  if (input.row.dial_status != null || input.row.processing_status !== 'pending') return { closeOut: false, alert: false };
  return { closeOut: true, alert: true };
}

/**
 * How long to wait for the <Dial action> before treating a still-open row as abandoned.
 * The action and the number status callback arrive together. An answered call also has no
 * dial_status until that action lands, so a long call must not be emailed on the first look.
 * A hang-up during the recording notice never starts <Dial>, so it does not wait.
 */
export const DIAL_RESULT_WAIT_MS = 4000;

export function abandonTiming(input: {
  callLengthSeconds: number | null;
  afterHours: boolean;
}): { waitForDial: boolean; phase: 'before_dial' | 'dial'; noticePlayed: boolean; ringSeconds: number } {
  const length = input.callLengthSeconds;
  // Business hours: the first ~5s is the recording notice. <Dial> has not started, so no action callback is coming.
  if (!input.afterHours && length != null && length <= RECORDING_NOTICE_SECONDS) {
    return { waitForDial: false, phase: 'before_dial', noticePlayed: false, ringSeconds: 0 };
  }
  const ringSeconds = input.afterHours || length == null
    ? Math.max(0, length ?? 0)
    : Math.max(0, length - RECORDING_NOTICE_SECONDS);
  return { waitForDial: true, phase: 'dial', noticePlayed: !input.afterHours, ringSeconds };
}

export function abandonSummary(timing: { phase: 'before_dial' | 'dial'; ringSeconds: number }, callLengthSeconds: number | null): string {
  if (timing.phase === 'before_dial') return hangupSummary(callLengthSeconds);
  const total = callLengthSeconds != null ? `${callLengthSeconds} second${callLengthSeconds === 1 ? '' : 's'}` : 'the ring';
  const ring = `${timing.ringSeconds} second${timing.ringSeconds === 1 ? '' : 's'}`;
  return `Caller hung up after ${total}. The phone rang about ${ring} and nobody answered. It never reached Mike.`;
}

type DialSnapshot = { dial_status: string | null; processing_status: string; started_at?: string | null };

/** Close and email only if the dial action never recorded a result. An answered call shows up during the wait. */
export async function confirmedAbandon(input: {
  params: Record<string, string>;
  row: DialSnapshot | null;
  reread?: () => Promise<DialSnapshot | null>;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}): Promise<{ closeOut: boolean; alert: boolean; phase: 'before_dial' | 'dial'; noticePlayed: boolean; ringSeconds: number; summary: string; reason: string }> {
  const none = { closeOut: false, alert: false, phase: 'before_dial' as const, noticePlayed: false, ringSeconds: 0, summary: '', reason: 'not-abandoned' };
  if (!abandonAlertDecision(input).closeOut) return none;
  const length = parseInt(input.params.CallDuration || '', 10);
  const callLengthSeconds = Number.isFinite(length) ? length : null;
  const started = input.row?.started_at;
  const afterHours = !!started && Number.isFinite(Date.parse(started)) && directToAi(new Date(started), AI_RECEPTIONIST, input.env);
  const timing = abandonTiming({ callLengthSeconds, afterHours });
  if (timing.waitForDial && input.reread) {
    await (input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(DIAL_RESULT_WAIT_MS);
    try {
      const again = await input.reread();
      if (again && (again.dial_status != null || again.processing_status !== 'pending')) {
        return { ...none, reason: 'dial-arrived' };
      }
    } catch (error) {
      console.error('[missed-alert] dial re-read failed', error instanceof Error ? error.message : error);
    }
  }
  return { closeOut: true, alert: true, phase: timing.phase, noticePlayed: timing.noticePlayed, ringSeconds: timing.ringSeconds, summary: abandonSummary(timing, callLengthSeconds), reason: 'abandoned' };
}

type SendFn = (message: { to: string; subject: string; text: string; html?: string }) => Promise<{ success?: boolean; error?: string }>;

export type MissedCallNotifyInput = {
  callSid: string;
  caller?: string | null;
  called?: string | null;
  source?: string | null;
  startedAt?: string | null;
  phase: 'before_dial' | 'dial';
  noticePlayed: boolean;
  callLengthSeconds?: number | null;
  /** When the final-status path already measured the ring, skip the clock math. */
  ringSeconds?: number | null;
  who?: AnsweredBy;
  /** Talk time when the shop or Mike answered. */
  durationSeconds?: number | null;
  summary?: string | null;
  outcome?: string | null;
  now?: Date;
};

type CallRow = {
  call_sid: string;
  caller_number: string | null;
  tracking_number: string | null;
  source: string | null;
  started_at: string | null;
  processing_error: string | null;
};

/**
 * Claim the row, then email. A second call for the same CallSid does not send.
 * If every send fails, the claim is released so Twilio's retry can try again.
 */
export async function notifyMissedInboundCall(
  input: MissedCallNotifyInput,
  db: any | null,
  deps?: { send?: SendFn; env?: NodeJS.ProcessEnv; now?: Date },
): Promise<{ sent: boolean; reason: string }> {
  if (!input.callSid) return { sent: false, reason: 'no-sid' };
  const env = deps?.env ?? process.env;
  const now = input.now ?? deps?.now ?? new Date();
  const send = deps?.send ?? (async (message) => {
    const { sendEmail, textToHtml } = await import('../messaging/email.ts');
    return sendEmail({ ...message, html: message.html ?? textToHtml(message.text || '') });
  });

  let row: CallRow | null = null;
  if (db) {
    try {
      const loaded = await db.from('inbound_call_recordings').select('call_sid, caller_number, tracking_number, source, started_at, processing_error').eq('call_sid', input.callSid).maybeSingle();
      row = loaded?.data ?? null;
    } catch (error) {
      console.error('[missed-alert] lookup failed', error instanceof Error ? error.message : error);
    }
  }
  if (hasAlertMarker(row?.processing_error)) return { sent: false, reason: 'already' };

  const who: AnsweredBy = input.who || 'missed';
  const previous = row?.processing_error ?? null;
  const claimedMarker = row ? withAlert(previous) : null;
  if (db && row && claimedMarker) {
    try {
      const claimed = await claimProcessingError(db, input.callSid, previous, claimedMarker, now);
      if (claimed === 'error') return { sent: false, reason: 'claim-failed' };
      if (claimed === 'lost') return { sent: false, reason: 'already' };
    } catch (error) {
      console.error('[call-alert] claim failed', error instanceof Error ? error.message : error);
      return { sent: false, reason: 'claim-failed' };
    }
  }

  const startedAt = input.startedAt || row?.started_at || null;
  const when = startedAt && Number.isFinite(Date.parse(startedAt)) ? new Date(startedAt) : now;
  const durationSeconds = who === 'missed'
    ? (input.ringSeconds != null
      ? input.ringSeconds
      : ringSecondsForAlert({ phase: input.phase, startedAt, now, noticePlayed: input.noticePlayed }))
    : (input.durationSeconds ?? 0);
  const copy = inboundAlertCopy({
    callSid: input.callSid,
    caller: input.caller || row?.caller_number,
    called: input.called || row?.tracking_number,
    source: input.source || row?.source,
    when,
    who,
    durationSeconds,
    summary: input.summary,
    outcome: input.outcome,
  }, env);

  let any = false;
  for (const to of missedAlertRecipients()) {
    try {
      const result = await send({ to, subject: copy.subject, text: copy.text });
      if (result?.success) any = true;
      else console.error(`[call-alert] email to ${to} failed`, result?.error || 'not sent');
    } catch (error) {
      console.error(`[call-alert] email to ${to} failed`, error instanceof Error ? error.message : error);
    }
  }

  if (!any && db && row && claimedMarker) {
    try {
      await db.from('inbound_call_recordings').update({ processing_error: previous, updated_at: new Date().toISOString() })
        .eq('call_sid', input.callSid).eq('processing_error', claimedMarker);
    } catch (error) {
      console.error('[call-alert] could not release claim', error instanceof Error ? error.message : error);
    }
    return { sent: false, reason: 'email-failed' };
  }
  return { sent: any, reason: any ? 'sent' : 'email-failed' };
}

async function claimProcessingError(db: any, callSid: string, previous: string | null, next: string, now: Date): Promise<'ok' | 'lost' | 'error'> {
  let query = db.from('inbound_call_recordings').update({ processing_error: next, updated_at: now.toISOString() }).eq('call_sid', callSid);
  query = previous == null ? query.is('processing_error', null) : query.eq('processing_error', previous);
  const claimed = await query.select('call_sid');
  if (claimed?.error) {
    console.error('[call-alert] claim failed', claimed.error.message);
    return 'error';
  }
  return claimed?.data?.length ? 'ok' : 'lost';
}

/** True when this leg is the one that picked up (answered event, or a completed leg with talk time). */
export function legCallbackCounts(params: Record<string, string>): boolean {
  const status = (params.CallStatus || '').toLowerCase();
  if (status === 'in-progress' || status === 'answered') return true;
  if (status !== 'completed') return false;
  const dur = parseInt(params.CallDuration || params.Duration || '0', 10);
  return Number.isFinite(dur) && dur > 0;
}

/** Remember who answered. A later recording note must not erase this. */
export async function recordAnsweredParty(db: any, callSid: string, party: 'shop' | 'mike'): Promise<'recorded' | 'already' | 'missing'> {
  const loaded = await db.from('inbound_call_recordings').select('call_sid, processing_error').eq('call_sid', callSid).maybeSingle();
  const row = loaded?.data;
  if (!row) return 'missing';
  if (partyFromProcessing(row.processing_error) || hasAlertMarker(row.processing_error)) return 'already';
  const next = withParty(row.processing_error, party);
  const result = await claimProcessingError(db, callSid, row.processing_error ?? null, next, new Date());
  return result === 'ok' ? 'recorded' : 'already';
}

/** Inbound start vs Mike's report. Long enough for a call where the office flag is saved near the end. */
const MIKE_MATCH_MS = 20 * 60 * 1000;

export type InboundMatchRow = {
  call_sid: string;
  caller_number: string | null;
  tracking_number: string | null;
  source: string | null;
  started_at: string | null;
  processing_error: string | null;
  answered: boolean | null;
  dial_status: string | null;
  duration_seconds: number | null;
};

function phoneKey(value: string | null | undefined): string {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function isMikeInboundRow(row: InboundMatchRow): boolean {
  const party = partyFromProcessing(row.processing_error);
  if (party === 'shop') return false;
  if (party === 'mike') return true;
  const dial = (row.dial_status || '').toLowerCase();
  return row.answered === true || dial === 'completed' || dial === 'answered';
}

function mikeMatchRows(rows: InboundMatchRow[], input: { phone: string; startedAtMs: number }, field: 'caller_number' | 'tracking_number'): InboundMatchRow[] {
  const phone = phoneKey(input.phone);
  return rows.filter((row) => {
    if (!phone || phoneKey(row[field]) !== phone) return false;
    const started = Date.parse(row.started_at || '');
    if (!Number.isFinite(started) || Math.abs(started - input.startedAtMs) > MIKE_MATCH_MS) return false;
    return isMikeInboundRow(row);
  }).sort((a, b) => Date.parse(b.started_at || '') - Date.parse(a.started_at || ''));
}

/**
 * The inbound row this Mike report belongs to.
 * Vapi usually sees the tracking number as the caller, because the dial does not
 * replace caller ID. Match the human first, then the line.
 */
export function pickInboundForMike(rows: InboundMatchRow[], input: { phone: string; startedAtMs: number }): { action: 'own' } | { action: 'skip'; callSid: string } | { action: 'merge'; row: InboundMatchRow } {
  const matches = mikeMatchRows(rows, input, 'caller_number');
  const row = (matches.length ? matches : mikeMatchRows(rows, input, 'tracking_number'))[0];
  if (!row) return { action: 'own' };
  if (hasAlertMarker(row.processing_error)) return { action: 'skip', callSid: row.call_sid };
  return { action: 'merge', row };
}

export type MikeEmail = { subject: string; text: string };

/** Mike's end-of-call report, with the inbound facts in front. One email, not two. */
export function mergeMikeCallEmail(built: MikeEmail, facts: string): MikeEmail {
  return { subject: built.subject, text: `${facts}\n\n${built.text}` };
}

/**
 * Send Mike's office email. When this Vapi call is an inbound leg, claim that row and
 * send the report once. A second delivery (Mike's email and this one) does not both go out.
 */
export async function deliverMikeCallEmail(
  db: any | null,
  input: { phone: string; startedAtMs: number; built: MikeEmail; talkSeconds?: number | null; inboundOnly?: boolean },
  deps?: { send?: SendFn; env?: NodeJS.ProcessEnv; rows?: InboundMatchRow[] },
): Promise<{ sent: boolean; reason: 'merged' | 'own' | 'already' | 'email-failed' | 'claim-failed' }> {
  const env = deps?.env ?? process.env;
  const send = deps?.send ?? (async (message) => {
    const { sendEmail, textToHtml } = await import('../messaging/email.ts');
    return sendEmail({ ...message, html: message.html ?? textToHtml(message.text || '') });
  });
  let rows = deps?.rows;
  if (!rows && db) {
    try {
      const since = new Date(input.startedAtMs - MIKE_MATCH_MS).toISOString();
      const until = new Date(input.startedAtMs + 60_000).toISOString();
      const loaded = await db.from('inbound_call_recordings')
        .select('call_sid, caller_number, tracking_number, source, started_at, processing_error, answered, dial_status, duration_seconds')
        .gte('started_at', since).lte('started_at', until).limit(20);
      rows = loaded?.data ?? [];
    } catch (error) {
      console.error('[call-alert] mike match failed', error instanceof Error ? error.message : error);
      rows = [];
    }
  }
  const picked = pickInboundForMike(rows || [], { phone: input.phone, startedAtMs: input.startedAtMs });
  if (picked.action === 'skip') return { sent: false, reason: 'already' };
  if (picked.action === 'own' && input.inboundOnly) return { sent: false, reason: 'own' };

  let email = input.built;
  let claimed: string | null = null;
  let previous: string | null = null;
  if (picked.action === 'merge') {
    let row = picked.row;
    if (db) {
      // The recording callback and the answer callback write the same column. If they
      // land between the read and the claim, try again with their value instead of
      // treating the report as already emailed.
      let settled: 'ok' | 'already' | 'error' | 'lost' = 'lost';
      for (let attempt = 0; attempt < 4; attempt++) {
        const loaded = await db.from('inbound_call_recordings')
          .select('call_sid, caller_number, tracking_number, source, started_at, processing_error, duration_seconds')
          .eq('call_sid', row.call_sid).maybeSingle();
        if (loaded?.data) row = { ...row, ...loaded.data };
        if (hasAlertMarker(row.processing_error)) { settled = 'already'; break; }
        previous = row.processing_error ?? null;
        claimed = withAlert(previous);
        const result = await claimProcessingError(db, row.call_sid, previous, claimed, new Date());
        if (result === 'ok') { settled = 'ok'; break; }
        if (result === 'error') { settled = 'error'; break; }
      }
      if (settled === 'error') return { sent: false, reason: 'claim-failed' };
      if (settled !== 'ok') return { sent: false, reason: 'already' };
    }
    const started = Date.parse(row.started_at || '');
    const talk = row.duration_seconds != null && row.duration_seconds > 0
      ? row.duration_seconds
      : (input.talkSeconds ?? 0);
    email = mergeMikeCallEmail(input.built, inboundFactBlock({
      callSid: row.call_sid,
      caller: row.caller_number,
      called: row.tracking_number,
      source: row.source,
      when: Number.isFinite(started) ? new Date(started) : new Date(input.startedAtMs),
      who: 'mike',
      durationSeconds: talk,
    }, env));
  }

  let any = false;
  for (const to of missedAlertRecipients()) {
    try {
      const result = await send({ to, subject: email.subject, text: email.text });
      if (result?.success) any = true;
      else console.error(`[call-alert] email to ${to} failed`, result?.error || 'not sent');
    } catch (error) {
      console.error(`[call-alert] email to ${to} failed`, error instanceof Error ? error.message : error);
    }
  }
  if (!any && db && picked.action === 'merge' && claimed) {
    try {
      await db.from('inbound_call_recordings').update({ processing_error: previous, updated_at: new Date().toISOString() })
        .eq('call_sid', picked.row.call_sid).eq('processing_error', claimed);
    } catch (error) {
      console.error('[call-alert] could not release claim', error instanceof Error ? error.message : error);
    }
    return { sent: false, reason: 'email-failed' };
  }
  return { sent: any, reason: any ? (picked.action === 'merge' ? 'merged' : 'own') : 'email-failed' };
}

const SWEEP_MAX_MS = 3 * 60 * 60 * 1000;
/**
 * Mike's report is the email that has his summary. The recording callback and the
 * answer callback write the same row at the end of the call. A 10-minute sweep
 * claimed that row first and sent a copy with no summary. Wait long enough for
 * the report to win, including a retry after that race.
 */
export const SWEEP_MIKE_WAIT_MS = 45 * 60 * 1000;
const SWEEP_RETRY_MS = 2 * 60 * 1000;

/** Backup send for a call whose immediate email failed, or whose Mike report never arrived. */
export function sweepInboundEmail(row: {
  processing_error: string | null;
  dial_status: string | null;
  answered: boolean | null;
  updated_at?: string | null;
  started_at?: string | null;
}, nowMs: number): AnsweredBy | null {
  if (hasAlertMarker(row.processing_error)) return null;
  const updated = Date.parse(row.updated_at || row.started_at || '');
  if (!Number.isFinite(updated)) return null;
  const age = nowMs - updated;
  if (age < 0 || age > SWEEP_MAX_MS) return null;
  const dial = (row.dial_status || '').toLowerCase();
  if (!dial) return null;
  const party = partyFromProcessing(row.processing_error);
  const answered = row.answered === true || ANSWERED.has(dial);
  if (answered && party === 'mike') return age >= SWEEP_MIKE_WAIT_MS ? 'mike' : null;
  if (answered && party === 'shop') return age >= SWEEP_RETRY_MS ? 'shop' : null;
  // Leg token missing. This is what the answer callback / recording race leaves behind
  // on a Mike call. Do not claim it as a shop email while his report can still send.
  if (answered) return age >= SWEEP_MIKE_WAIT_MS ? 'shop' : null;
  return age >= SWEEP_RETRY_MS ? 'missed' : null;
}

/**
 * Merge a recording note onto the claim and the answered-party token.
 * Compare-and-swap so a Mike report that claims the row during this write is kept.
 * Callers whose client has no `update` (unit-test fakes) fall back to one upsert.
 */
export async function commitProcessingNote(db: any, callSid: string, note: string | null, nowIso: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const latest = await db.from('inbound_call_recordings').select('processing_error').eq('call_sid', callSid).maybeSingle();
    const current = latest?.data?.processing_error ?? null;
    const next = mergeProcessingError(current, note);
    if ((next ?? null) === (current ?? null)) return;
    const table = db.from('inbound_call_recordings');
    if (typeof table.update !== 'function') {
      await table.upsert({ call_sid: callSid, processing_error: next, updated_at: nowIso }, { onConflict: 'call_sid' });
      return;
    }
    let query = table.update({ processing_error: next, updated_at: nowIso }).eq('call_sid', callSid);
    query = current == null ? query.is('processing_error', null) : query.eq('processing_error', current);
    const wrote = await query.select('call_sid');
    if (wrote?.error) return;
    if (wrote?.data?.length) return;
  }
}
