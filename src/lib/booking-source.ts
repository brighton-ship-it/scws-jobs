/**
 * booking_requests.source values that the live intake path actually sends,
 * plus the original schema / receptionist values already in the check constraint.
 * Do not add speculative marketing channels here.
 */
export const BOOKING_SOURCES = [
  'website',
  'embed',
  'manual',
  'phone',
  'google_ads',
  'cost-calculator',
] as const;

export type BookingSource = (typeof BOOKING_SOURCES)[number];

const ALLOWED = new Set<string>(BOOKING_SOURCES);

/** Same verified channels, alternate spellings only. */
const ALIASES: Record<string, BookingSource> = {
  google_ads: 'google_ads',
  'google-ads': 'google_ads',
  googleads: 'google_ads',
  'cost-calculator': 'cost-calculator',
  cost_calculator: 'cost-calculator',
  costcalculator: 'cost-calculator',
};

export const DEFAULT_BOOKING_SOURCE: BookingSource = 'website';

function canonicalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s]+/g, '_');
}

/**
 * Map a POST body source onto a value the booking_requests check allows.
 * Unknown values fall back to website so a new UTM cannot 500 and drop the lead.
 */
export function normalizeBookingSource(raw: unknown): {
  source: BookingSource;
  original: string | null;
  remapped: boolean;
} {
  if (raw == null) {
    return { source: DEFAULT_BOOKING_SOURCE, original: null, remapped: false };
  }

  const original = String(raw).trim();
  if (!original) {
    return { source: DEFAULT_BOOKING_SOURCE, original: null, remapped: false };
  }

  const key = canonicalize(original);
  const hyphenKey = original.trim().toLowerCase().replace(/[\s]+/g, '-');

  const mapped =
    (ALLOWED.has(key) ? (key as BookingSource) : undefined) ||
    (ALLOWED.has(hyphenKey) ? (hyphenKey as BookingSource) : undefined) ||
    ALIASES[key] ||
    ALIASES[hyphenKey];

  if (mapped) {
    return { source: mapped, original, remapped: false };
  }

  return { source: DEFAULT_BOOKING_SOURCE, original, remapped: true };
}

/** Keep the raw channel on the request when we had to remap it. */
export function annotateRemappedSource(
  notes: string | null | undefined,
  original: string
): string {
  const tag = `[intake source: ${original}]`;
  const existing = notes?.trim() || '';
  return existing ? `${tag}\n${existing}` : tag;
}
