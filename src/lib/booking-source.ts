/**
 * booking_requests.source is the intake CHANNEL (website form, embed,
 * office manual, phone) — not marketing attribution.
 *
 * Live Production CHECK booking_requests_source_check still matches
 * supabase/migrations/20260205_receptionist_calls.sql:
 *   website | embed | manual | phone
 *
 * A later repo migration (20260821) added google_ads / cost-calculator /
 * other, but Production is still rejecting those values (POST /api/booking
 * 500 on 2026-09-21). Do not insert them.
 *
 * Ads attribution stays on click-id columns (gclid/gbraid/wbraid/
 * ga_client_id/ga_session_id) and, when the site sends them, UTM text
 * on the notes field. Keep this list in sync with the live CHECK.
 */
export const BOOKING_SOURCES = [
  'website',
  'embed',
  'manual',
  'phone',
] as const;

export type BookingSource = (typeof BOOKING_SOURCES)[number];

const ALLOWED = new Set<string>(BOOKING_SOURCES);

/**
 * Same intake channel, different label than the live CHECK.
 * Marketing-site Ads values (lead_source=google_ads) map to website.
 */
const ALIASES: Record<string, BookingSource> = {
  google_ads: 'website',
  googleads: 'website',
  'google-ads': 'website',
  'google ads': 'website',
  googleadwords: 'website',
  google_adwords: 'website',
  adwords: 'website',
  ads: 'website',
  cpc: 'website',
  ppc: 'website',
  paid_search: 'website',
  bing_ads: 'website',
  bingads: 'website',
  microsoft_ads: 'website',
  facebook_ads: 'website',
  meta_ads: 'website',
  website_form: 'website',
  form: 'website',
  'cost-calculator': 'website',
  cost_calculator: 'website',
  costcalculator: 'website',
};

export interface NormalizedBookingSource {
  source: BookingSource;
  /** Present when the incoming value was remapped (Ads alias, unknown UTM, etc.). */
  original: string | null;
}

export interface BookingUtms {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
}

const UTM_MAX = 200;

/**
 * Prefer `source` (this app + some forms), then `lead_source`
 * (scwellservice.com js/utm-tracking.js).
 */
export function inboundBookingSource(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  if (hasText(record.source)) return record.source;
  if (hasText(record.lead_source)) return record.lead_source;
  return undefined;
}

/** Marketing-site Ads label to keep on notes when `source` is already a channel. */
export function inboundLeadSourceLabel(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const value = (body as Record<string, unknown>).lead_source;
  if (!hasText(value)) return null;
  return String(value).trim();
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function cleanUtm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/[\r\n]+/g, ' ');
  if (!trimmed || trimmed.length > UTM_MAX) return null;
  return trimmed;
}

export function extractBookingUtms(body: unknown): BookingUtms {
  const record =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  return {
    utm_source: cleanUtm(record.utm_source),
    utm_medium: cleanUtm(record.utm_medium),
    utm_campaign: cleanUtm(record.utm_campaign),
    utm_term: cleanUtm(record.utm_term),
    utm_content: cleanUtm(record.utm_content),
  };
}

export function hasAnyUtm(utms: BookingUtms): boolean {
  return Boolean(
    utms.utm_source ||
      utms.utm_medium ||
      utms.utm_campaign ||
      utms.utm_term ||
      utms.utm_content
  );
}

/**
 * Map inbound labels onto the live CHECK. Known channels pass through;
 * Ads aliases and anything else become `website` so the insert cannot 500.
 */
export function normalizeBookingSource(raw: unknown): NormalizedBookingSource {
  if (raw == null) {
    return { source: 'website', original: null };
  }

  const original = String(raw).trim();
  if (!original) {
    return { source: 'website', original: null };
  }

  const key = original.toLowerCase();
  if (ALLOWED.has(key)) {
    return { source: key as BookingSource, original: null };
  }

  const aliased = ALIASES[key];
  if (aliased) {
    return { source: aliased, original };
  }

  return { source: 'website', original };
}

export function appendSourceToNotes(
  notes: string | null | undefined,
  originalSource: string
): string {
  const tag = `[source: ${originalSource}]`;
  const existing = notes?.trim();
  return existing ? `${tag} ${existing}` : tag;
}

export function formatUtmNotesTag(utms: BookingUtms): string | null {
  const bits = [
    utms.utm_source && `utm_source=${utms.utm_source}`,
    utms.utm_medium && `utm_medium=${utms.utm_medium}`,
    utms.utm_campaign && `utm_campaign=${utms.utm_campaign}`,
    utms.utm_term && `utm_term=${utms.utm_term}`,
    utms.utm_content && `utm_content=${utms.utm_content}`,
  ].filter(Boolean);
  return bits.length ? `[${bits.join(' ')}]` : null;
}

/** Prefix notes with remapped source and any inbound UTM fields. */
export function appendAttributionToNotes(
  notes: string | null | undefined,
  originalSource: string | null,
  utms: BookingUtms
): string | null {
  const tags: string[] = [];
  if (originalSource) tags.push(`[source: ${originalSource}]`);
  const utmTag = formatUtmNotesTag(utms);
  if (utmTag) tags.push(utmTag);

  const existing = notes?.trim() || '';
  if (!tags.length) return existing || null;
  return existing ? `${tags.join(' ')} ${existing}` : tags.join(' ');
}
