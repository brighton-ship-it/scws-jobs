/**
 * Pure builder for Google Ads offline click conversions (ConversionUploadService.UploadClickConversions)
 * for WON Jobber jobs. No network, no env, no cron wiring: callers decide when/if to upload.
 * Never invents click IDs: a conversion is only built when a stored gclid/gbraid/wbraid exists
 * or when hashed user identifiers are present (enhanced conversions for leads).
 */
import { createHash } from 'node:crypto';

export interface WonJobInput {
  jobberJobId: string;
  /** ISO timestamp the job was won/scheduled or invoice was paid. */
  conversionAt: string;
  /** Pre-tax invoice value in USD. Must be > 0. */
  valueUsd: number;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ClickConversion {
  conversion_action: string;
  conversion_date_time: string; // "yyyy-mm-dd hh:mm:ss+|-hh:mm"
  conversion_value: number;
  currency_code: 'USD';
  order_id: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  user_identifiers?: Array<{ hashed_email?: string; hashed_phone_number?: string }>;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function hashEmail(email?: string | null): string | null {
  const e = email?.trim().toLowerCase();
  return e && e.includes('@') ? sha(e) : null;
}

/** E.164 for US numbers, then sha256. */
export function hashPhoneE164(phone?: string | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  const n = d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : null;
  return n ? sha(n) : null;
}

/** Google Ads wants "yyyy-mm-dd hh:mm:ss+00:00". */
export function formatAdsDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('invalid conversionAt');
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+00:00`;
}

/** Returns null when there is nothing Google can match on, or no positive value. */
export function buildClickConversion(
  conversionActionResource: string,
  job: WonJobInput
): ClickConversion | null {
  if (!(job.valueUsd > 0)) return null;
  const gclid = job.gclid?.trim() || undefined;
  const gbraid = job.gbraid?.trim() || undefined;
  const wbraid = job.wbraid?.trim() || undefined;
  const ids: Array<{ hashed_email?: string; hashed_phone_number?: string }> = [];
  const he = hashEmail(job.email);
  const hp = hashPhoneE164(job.phone);
  if (he) ids.push({ hashed_email: he });
  if (hp) ids.push({ hashed_phone_number: hp });
  if (!gclid && !gbraid && !wbraid && ids.length === 0) return null;

  const c: ClickConversion = {
    conversion_action: conversionActionResource,
    conversion_date_time: formatAdsDateTime(job.conversionAt),
    conversion_value: Math.round(job.valueUsd * 100) / 100,
    currency_code: 'USD',
    order_id: job.jobberJobId, // dedupe key: one conversion per Jobber job
  };
  // Google accepts only one of gclid / gbraid / wbraid per row.
  if (gclid) c.gclid = gclid;
  else if (gbraid) c.gbraid = gbraid;
  else if (wbraid) c.wbraid = wbraid;
  if (ids.length) c.user_identifiers = ids;
  return c;
}
