/**
 * Won jobs that came from a Google Ads call (no gclid) are credited back through
 * UploadCallConversions: caller id (E.164) + the call's start time from call_view.
 * Data Manager events with only a hashed phone never matched these callers, because
 * they never clicked through to the website.
 */
import type { ClickConversion } from './offline-conversion.ts';
import { formatAdsDateTime } from './offline-conversion.ts';

export interface CallInfo {
  callerPhone: string | null | undefined;
  callStartedAt: string | null | undefined;
}

export interface CallConversion {
  caller_id: string;
  call_start_date_time: string;
  conversion_action: string;
  conversion_date_time: string;
  conversion_value: number;
  currency_code: 'USD';
}

export function e164(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

/** Null when the call is unknown, or the job was booked before the call started. */
export function toCallConversion(action: string, click: ClickConversion, call: CallInfo | undefined): CallConversion | null {
  const caller = e164(call?.callerPhone);
  const start = Date.parse(call?.callStartedAt ?? '');
  if (!caller || !Number.isFinite(start)) return null;
  const booked = Date.parse(click.conversion_date_time.replace(' ', 'T'));
  // Google rejects conversions before the call (CONVERSION_PRECEDES_CALL). Keep at least 1 minute after.
  const convAt = Number.isFinite(booked) && booked > start ? booked : start + 60_000;
  return {
    caller_id: caller,
    call_start_date_time: formatAdsDateTime(new Date(start).toISOString()),
    conversion_action: action,
    conversion_date_time: formatAdsDateTime(new Date(convAt).toISOString()),
    conversion_value: click.conversion_value,
    currency_code: 'USD',
  };
}

/** Calls under 6 hours old cannot be imported yet; the next run picks them up. */
export function callTooRecent(call: CallInfo | undefined, now = Date.now()): boolean {
  const start = Date.parse(call?.callStartedAt ?? '');
  return Number.isFinite(start) && now - start < 6 * 60 * 60 * 1000;
}

/** One-time: ads_call rows sent only to Data Manager (never landed) are re-sent as call conversions. */
export function needsCallResend(row: { status: string; payload?: unknown }): boolean {
  if (row.status !== 'uploaded') return false;
  const p = row.payload as { call_upload?: unknown } | null | undefined;
  return !(p && typeof p === 'object' && p.call_upload === true);
}

/**
 * Ledger status for a call upload Google will reject again if we resend the
 * same caller and start time. Stored on ads_offline_conversions.status (text,
 * no new column).
 */
export const CALL_UPLOAD_TERMINAL_STATUS = 'rejected_terminal' as const;

/**
 * ConversionUploadError codes that are a property of this call or click.
 * A later cron run sends the same caller id and start time, so these cannot
 * succeed on retry. Left off on purpose (still status=error, retried):
 * TOO_RECENT_CALL / TOO_RECENT_EVENT (wait 6h), CONVERSION_PRECEDES_CALL
 * (timestamp fix), UNPARSEABLE_GCLID / UNPARSEABLE_CALLERS_PHONE_NUMBER
 * (identifier fix), and account/setup codes (terms, auth, wrong customer).
 */
export const TERMINAL_CALL_UPLOAD_ERRORS = [
  'CONVERSION_NOT_COMPLIANT_WITH_ATT_POLICY',
  'EXPIRED_CALL',
  'EXPIRED_EVENT',
  'CONVERSION_TRACKING_NOT_ENABLED_AT_CALL_TIME',
  'CONVERSION_TRACKING_NOT_ENABLED_AT_IMPRESSION_TIME',
  'CALL_NOT_FOUND',
  'EVENT_NOT_FOUND',
  'CLICK_NOT_FOUND',
  'CALL_CONVERSION_ALREADY_EXISTS',
  'CLICK_CONVERSION_ALREADY_EXISTS',
  'ORDER_ID_ALREADY_IN_USE',
] as const;

function containsUploadCode(text: string, code: string): boolean {
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(code, from);
    if (at < 0) return false;
    const before = at > 0 ? text.charAt(at - 1) : '';
    const after = at + code.length < text.length ? text.charAt(at + code.length) : '';
    const word = (ch: string) => ch !== '' && /[A-Za-z0-9_]/.test(ch);
    if (!word(before) && !word(after)) return true;
    from = at + code.length;
  }
  return false;
}

/** The permanent code inside a Google upload error, or null if this failure can be retried. */
export function terminalCallUploadCode(error: string | null | undefined): string | null {
  if (!error) return null;
  for (const code of TERMINAL_CALL_UPLOAD_ERRORS) {
    if (containsUploadCode(error, code)) return code;
  }
  return null;
}

export function isTerminalCallUploadError(error: string | null | undefined): boolean {
  return terminalCallUploadCode(error) != null;
}

export type CallSendSkip = {
  action: 'skip';
  status: 'not_sent' | typeof CALL_UPLOAD_TERMINAL_STATUS;
  reason: string;
  /** Ledger row is still status=error and should be rewritten to rejected_terminal. */
  promoteTerminal: boolean;
};

/**
 * Whether this call candidate is uploaded tonight.
 * Already-uploaded and permanently rejected rows are skipped. The caller logs
 * every skip so a counted quote candidate cannot disappear without a reason.
 */
export function callSendDisposition(input: {
  status?: string | null;
  error?: string | null;
  resend?: boolean;
}): { action: 'upload' } | CallSendSkip {
  const code = terminalCallUploadCode(input.error);
  if (input.status === CALL_UPLOAD_TERMINAL_STATUS || (input.status === 'error' && code)) {
    return {
      action: 'skip',
      status: CALL_UPLOAD_TERMINAL_STATUS,
      reason: code ?? 'REJECTED_TERMINAL',
      promoteTerminal: input.status !== CALL_UPLOAD_TERMINAL_STATUS,
    };
  }
  if (input.status === 'uploaded' && !input.resend) {
    return { action: 'skip', status: 'not_sent', reason: 'ALREADY_UPLOADED', promoteTerminal: false };
  }
  return { action: 'upload' };
}

export interface CallLedgerRow {
  jobber_job_id: string;
  status: string;
  error?: string | null;
  payload?: unknown;
}

/**
 * Split call candidates that already have a value into upload vs do-not-upload.
 * Duplicate job ids count once for upload; the extra copy is a logged skip.
 */
export function partitionCallUploads<T extends { jobberJobId: string }>(
  candidates: T[],
  existing: CallLedgerRow[]
): { upload: T[]; skipped: Array<{ candidate: T } & CallSendSkip> } {
  const byId = new Map(existing.map((row) => [row.jobber_job_id, row]));
  const upload: T[] = [];
  const skipped: Array<{ candidate: T } & CallSendSkip> = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.jobberJobId)) {
      skipped.push({
        candidate,
        action: 'skip',
        status: 'not_sent',
        reason: 'DUPLICATE_JOB',
        promoteTerminal: false,
      });
      continue;
    }
    seen.add(candidate.jobberJobId);
    const prior = byId.get(candidate.jobberJobId);
    const disposition = callSendDisposition({
      status: prior?.status,
      error: prior?.error,
      resend: prior ? needsCallResend(prior) : false,
    });
    if (disposition.action === 'skip') skipped.push({ candidate, ...disposition });
    else upload.push(candidate);
  }
  return { upload, skipped };
}

/** Last 4 digits of a phone for logs. Never the full number. */
export function last4(phone: string | null | undefined): string {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : 'none';
}

/** One log line per call-conversion row: job, caller last 4, call start, result/error code. */
export function callRowLogLine(row: {
  jobberJobId: string;
  callerPhone: string | null | undefined;
  callStartedAt: string | null | undefined;
  status: string;
  error?: string | null;
  valueUsd?: number | null;
  valueSource?: string | null;
}): string {
  const code = row.error ? (row.error.split(':')[0] || row.error).trim().slice(0, 80) : 'none';
  return `[ads_offline] call row job=${row.jobberJobId} caller=*${last4(row.callerPhone)} start=${row.callStartedAt ?? 'none'} status=${row.status} value=${row.valueUsd ?? 'none'} source=${row.valueSource ?? 'none'} error=${code}`;
}

export interface AdsCallRow {
  caller_phone: string | null;
  campaign_name: string | null;
  started_at: string | null;
  started_at_utc?: boolean | null;
  call_source?: string | null;
  call_view_resource?: string | null;
}

/**
 * Calls that may be credited as Ads call conversions.
 * - Only Google forwarding-number calls from the ad/call asset (call_source AD, or legacy null).
 *   LANDING_PAGE calls are website calls, already counted by the site's click conversion
 *   (and the site's Twilio 331-2502 swap number is never in ads_calls).
 * - started_at: legacy rows stored the Pacific wall clock as UTC. A row not flagged
 *   started_at_utc and not in the repair ledger is shifted here (in memory) with `repair`.
 */
export function usableAdsCalls(
  rows: AdsCallRow[],
  input: {
    hasUtcColumn: boolean;
    repairedLedger: ReadonlySet<string>;
    repair: (s: string) => string | null;
    /** False when the started_at_utc select failed: never shift (risk of double shift). */
    allowShift?: boolean;
  }
): {
  calls: Array<{ phone: string | null; campaign: string | null; startedAt: string | null }>;
  droppedLandingPage: number;
  unknownSource: number;
  shifted: number;
} {
  let droppedLandingPage = 0;
  let unknownSource = 0;
  let shifted = 0;
  const calls: Array<{ phone: string | null; campaign: string | null; startedAt: string | null }> = [];
  for (const r of rows) {
    const src = (r.call_source ?? '').trim().toUpperCase();
    if (src === 'LANDING_PAGE') {
      droppedLandingPage += 1;
      continue;
    }
    // UNKNOWN / UNSPECIFIED / legacy null: counted separately and still sent as ad calls.
    if (src !== 'AD') unknownSource += 1;
    let startedAt = r.started_at;
    const correct =
      (input.hasUtcColumn && r.started_at_utc === true) ||
      (r.call_view_resource ? input.repairedLedger.has(r.call_view_resource) : false);
    if (startedAt && !correct && input.allowShift !== false) {
      const fixed = input.repair(startedAt);
      if (fixed && fixed !== new Date(startedAt).toISOString()) shifted += 1;
      startedAt = fixed ?? startedAt;
    }
    calls.push({ phone: r.caller_phone, campaign: r.campaign_name, startedAt });
  }
  return { calls, droppedLandingPage, unknownSource, shifted };
}

/**
 * Value for a won job from an Ads call, from THIS job only (never client-wide totals).
 * - Issued invoice on this job: send its pre-tax amount.
 * - No invoice and 5 days have passed since the later of call start / booking: send this
 *   job's own approved quote subtotal.
 * - Otherwise HOLD (waiting for the invoice, or no quote yet). The booking placeholder is
 *   never sent: UPLOAD_CALLS cannot be restated. Expires 89 days after the call.
 */
export type CallValueDecision =
  | { kind: 'send'; value: number; source: 'invoice_pretax' | 'approved_quote'; after5d: boolean }
  | { kind: 'hold'; reason: 'waiting_invoice' | 'no_invoice_or_quote' }
  | { kind: 'expired' };

export const CALL_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
export const INVOICE_WAIT_MS = 5 * 24 * 60 * 60 * 1000;

export function callValueDecision(
  input: {
    ownInvoiceUsd?: number | null;
    ownQuoteUsd?: number | null;
    callStartedAt?: string | null;
    conversionAt?: string | null;
  },
  now = Date.now()
): CallValueDecision {
  const start = Date.parse(input.callStartedAt ?? '');
  if (Number.isFinite(start) && now - start > CALL_LOOKBACK_MS - 24 * 60 * 60 * 1000) return { kind: 'expired' };
  if (input.ownInvoiceUsd && input.ownInvoiceUsd > 0)
    return { kind: 'send', value: input.ownInvoiceUsd, source: 'invoice_pretax', after5d: false };
  const booked = Date.parse(input.conversionAt ?? '');
  const from = Math.max(Number.isFinite(start) ? start : -Infinity, Number.isFinite(booked) ? booked : -Infinity);
  const waited = Number.isFinite(from) && now - from >= INVOICE_WAIT_MS;
  if (!waited) return { kind: 'hold', reason: 'waiting_invoice' };
  if (input.ownQuoteUsd && input.ownQuoteUsd > 0)
    return { kind: 'send', value: input.ownQuoteUsd, source: 'approved_quote', after5d: true };
  return { kind: 'hold', reason: 'no_invoice_or_quote' };
}
