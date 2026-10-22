/**
 * Instant office email when an inbound call is missed or abandoned and Mike never answers.
 * One email per call. Calls Mike (or the shop) answered do not email.
 * Mike's voice, greeting, and callback flag are not involved.
 */
import { formatPhoneDisplay, OFFICE_ALERT_EMAILS } from '../receptionist/office-callback.ts';
import { AI_RECEPTIONIST, PORTED_LINES, TRACKING_SOURCES, directToAi } from './config.ts';
import { finalStatusPatch, hangupSummary } from './final-status.ts';
import { RECORDING_NOTICE_SECONDS } from './ring-timeout.ts';

/** Claim token stored on the call row so a Twilio retry cannot send a second email. */
export const MISSED_ALERT_MARKER = 'missed-alert-sent';

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

export type MissedAlertCopyInput = {
  callSid: string;
  caller: string | null | undefined;
  called: string | null | undefined;
  source: string | null | undefined;
  when: Date;
  ringSeconds: number;
  phase: 'before_dial' | 'dial';
  callLengthSeconds?: number | null;
};

export function missedAlertCopy(input: MissedAlertCopyInput, env: NodeJS.ProcessEnv = process.env): { subject: string; text: string } {
  const caller = input.caller ? formatPhoneDisplay(input.caller) : 'Unknown caller';
  const line = lineLabel(input.called, input.source);
  const when = formatPacific(input.when);
  const link = callDashboardUrl(input.callSid, env);
  const lead = input.phase === 'before_dial'
    ? 'Caller hung up during the recording notice, before the shop phone rang. Mike never got the call.'
    : 'Nobody answered, and this call never reached Mike.';
  const length = input.phase === 'before_dial' && input.callLengthSeconds != null
    ? `Call length: ${secondsLabel(input.callLengthSeconds)}`
    : '';
  const text = [
    lead,
    '',
    `Caller: ${caller}`,
    `Line: ${line}`,
    `Time: ${when}`,
    `Ring duration: ${secondsLabel(input.ringSeconds)}`,
    length,
    '',
    `Dashboard: ${link}`,
  ].filter((line) => line !== '').join('\n');
  return { subject: `Missed call before Mike: ${caller}`, text };
}

const ANSWERED = new Set(['completed', 'answered']);

/**
 * What the <Dial action> should do.
 * handoff: caller is still here and Mike has not been dialed yet.
 * alert: the call is over and Mike did not answer. A canceled dial means the
 * caller already hung up, so TwiML returned from this request will not run.
 */
export function statusCallbackPlan(input: { dialStatus: string | null | undefined; canHandoff: boolean }): { handoff: boolean; alert: boolean } {
  const status = (input.dialStatus || '').trim().toLowerCase();
  if (ANSWERED.has(status)) return { handoff: false, alert: false };
  if (status === 'canceled' || status === 'cancelled') return { handoff: false, alert: true };
  if (input.canHandoff && (status === 'no-answer' || status === 'busy' || status === 'failed')) {
    return { handoff: true, alert: false };
  }
  return { handoff: false, alert: true };
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
  if (row?.processing_error === MISSED_ALERT_MARKER) return { sent: false, reason: 'already' };

  if (db && row) {
    try {
      const claimed = await db.from('inbound_call_recordings').update({ processing_error: MISSED_ALERT_MARKER, updated_at: now.toISOString() })
        .eq('call_sid', input.callSid).is('processing_error', null).select('call_sid');
      if (claimed?.error) {
        console.error('[missed-alert] claim failed', claimed.error.message);
        return { sent: false, reason: 'claim-failed' };
      }
      if (!claimed?.data?.length) return { sent: false, reason: 'already' };
    } catch (error) {
      console.error('[missed-alert] claim failed', error instanceof Error ? error.message : error);
      return { sent: false, reason: 'claim-failed' };
    }
  }

  const startedAt = input.startedAt || row?.started_at || null;
  const when = startedAt && Number.isFinite(Date.parse(startedAt)) ? new Date(startedAt) : now;
  const copy = missedAlertCopy({
    callSid: input.callSid,
    caller: input.caller || row?.caller_number,
    called: input.called || row?.tracking_number,
    source: input.source || row?.source,
    when,
    ringSeconds: input.ringSeconds != null
      ? input.ringSeconds
      : ringSecondsForAlert({ phase: input.phase, startedAt, now, noticePlayed: input.noticePlayed }),
    phase: input.phase,
    callLengthSeconds: input.callLengthSeconds,
  }, env);

  let any = false;
  for (const to of missedAlertRecipients()) {
    try {
      const result = await send({ to, subject: copy.subject, text: copy.text });
      if (result?.success) any = true;
      else console.error(`[missed-alert] email to ${to} failed`, result?.error || 'not sent');
    } catch (error) {
      console.error(`[missed-alert] email to ${to} failed`, error instanceof Error ? error.message : error);
    }
  }

  if (!any && db && row) {
    try {
      await db.from('inbound_call_recordings').update({ processing_error: null, updated_at: new Date().toISOString() })
        .eq('call_sid', input.callSid).eq('processing_error', MISSED_ALERT_MARKER);
    } catch (error) {
      console.error('[missed-alert] could not release claim', error instanceof Error ? error.message : error);
    }
    return { sent: false, reason: 'email-failed' };
  }
  return { sent: any, reason: any ? 'sent' : 'email-failed' };
}
