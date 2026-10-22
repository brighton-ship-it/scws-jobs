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
