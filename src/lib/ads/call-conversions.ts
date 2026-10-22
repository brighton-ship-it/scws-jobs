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
 * Value for a won job from an Ads call, from THIS job only (never client-wide totals):
 * issued invoice pre-tax, else the job's own approved quote subtotal. With neither,
 * the row is HELD (no booking placeholder is ever uploaded: UPLOAD_CALLS cannot be restated).
 * After the 90-day lookback from the call start the row expires.
 */
export type CallValueDecision =
  | { kind: 'send'; value: number; source: 'invoice_pretax' | 'approved_quote' }
  | { kind: 'hold' }
  | { kind: 'expired' };

export const CALL_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export function callValueDecision(
  input: { ownInvoiceUsd?: number | null; ownQuoteUsd?: number | null; callStartedAt?: string | null },
  now = Date.now()
): CallValueDecision {
  const start = Date.parse(input.callStartedAt ?? '');
  // Keep a day of margin inside Google's 90-day window.
  if (Number.isFinite(start) && now - start > CALL_LOOKBACK_MS - 24 * 60 * 60 * 1000) return { kind: 'expired' };
  if (input.ownInvoiceUsd && input.ownInvoiceUsd > 0) return { kind: 'send', value: input.ownInvoiceUsd, source: 'invoice_pretax' };
  if (input.ownQuoteUsd && input.ownQuoteUsd > 0) return { kind: 'send', value: input.ownQuoteUsd, source: 'approved_quote' };
  return { kind: 'hold' };
}
