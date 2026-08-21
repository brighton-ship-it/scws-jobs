/**
 * booking_requests.source values that the live intake path actually sends
 * (this app + scwellservice.com forms). Keep in sync with
 * booking_requests_source_check in supabase/migrations.
 */
export const BOOKING_SOURCES = [
  'website',
  'embed',
  'manual',
  'phone',
  'google_ads',
  'cost-calculator',
  'other',
] as const;

export type BookingSource = (typeof BOOKING_SOURCES)[number];

const ALLOWED = new Set<string>(BOOKING_SOURCES);

/** Same channel, different punctuation than the canonical allowlist value. */
const ALIASES: Record<string, BookingSource> = {
  googleads: 'google_ads',
  'google-ads': 'google_ads',
  'google ads': 'google_ads',
  cost_calculator: 'cost-calculator',
};

export interface NormalizedBookingSource {
  source: BookingSource;
  /** Present when the incoming value was not an allowed source and was remapped. */
  original: string | null;
}

/**
 * Prefer saving the lead over rejecting. Known sources pass through;
 * anything else (new UTM, typo, future landing page) becomes `other`.
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
    return { source: aliased, original: null };
  }

  return { source: 'other', original };
}

export function appendSourceToNotes(
  notes: string | null | undefined,
  originalSource: string
): string {
  const tag = `[source: ${originalSource}]`;
  const existing = notes?.trim();
  return existing ? `${tag} ${existing}` : tag;
}
