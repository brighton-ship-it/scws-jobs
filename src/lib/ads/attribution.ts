/**
 * First-party Google Ads attribution.
 *
 * The marketing site keeps click ids in sessionStorage today, so a visit that
 * does not land on the form loses the gclid. This cookie lasts 90 days on the
 * page's own host. A later page with no click id must not wipe a stored one.
 * A new click id replaces the old one.
 *
 * The browser script is public/ads-attribution.js. Keep the cookie name,
 * max-age, and field list in sync with that file.
 */

export const ADS_ATTRIBUTION_COOKIE = 'scws_ads';
export const ADS_ATTRIBUTION_MAX_AGE_SEC = 90 * 24 * 60 * 60;

export const ADS_ATTRIBUTION_FIELDS = [
  'gclid',
  'gbraid',
  'wbraid',
  'ga_client_id',
  'ga_session_id',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

export type AdsAttributionField = (typeof ADS_ATTRIBUTION_FIELDS)[number];

export interface AdsAttribution {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  ga_client_id: string | null;
  ga_session_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  captured_at: string | null;
}

const CLICK_FIELDS = ['gclid', 'gbraid', 'wbraid'] as const;
const MAX_LEN = 256;

export const EMPTY_ADS_ATTRIBUTION: AdsAttribution = {
  gclid: null,
  gbraid: null,
  wbraid: null,
  ga_client_id: null,
  ga_session_id: null,
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_term: null,
  utm_content: null,
  captured_at: null,
};

export function cleanAttributionValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/[\r\n]+/g, ' ');
  if (!trimmed || trimmed.length > MAX_LEN) return null;
  return trimmed;
}

/** GA4 `_ga` cookie → Measurement Protocol client_id (`1234567890.1234567890`). */
export function gaClientIdFromCookie(gaCookie: string | null | undefined): string | null {
  const raw = cleanAttributionValue(gaCookie);
  if (!raw) return null;
  const match = raw.match(/(\d+\.\d+)\s*$/);
  if (!match) return null;
  return match[1].length <= 64 ? match[1] : null;
}

/** GA4 `_ga_<container>` cookie → session id. */
export function gaSessionIdFromCookie(cookie: string | null | undefined): string | null {
  const raw = cleanAttributionValue(cookie);
  if (!raw) return null;
  const gs2 = raw.match(/s(\d{6,})/);
  if (gs2) return gs2[1];
  const gs1 = raw.match(/^GS\d+\.\d+\.(\d+)/);
  if (gs1) return gs1[1];
  return null;
}

export function emptyToNullAttribution(value: AdsAttribution): AdsAttribution | null {
  const hasField = ADS_ATTRIBUTION_FIELDS.some((field) => value[field]);
  return hasField ? value : null;
}

export function attributionFromRecord(record: Record<string, unknown> | null | undefined): AdsAttribution {
  const source = record ?? {};
  const next: AdsAttribution = { ...EMPTY_ADS_ATTRIBUTION };
  for (const field of ADS_ATTRIBUTION_FIELDS) {
    const aliases =
      field === 'ga_client_id'
        ? [field, 'gaClientId']
        : field === 'ga_session_id'
          ? [field, 'gaSessionId']
          : field === 'utm_campaign'
            ? [field, 'campaign']
            : field === 'utm_term'
              ? [field, 'keyword']
              : [field];
    for (const key of aliases) {
      const cleaned = cleanAttributionValue(source[key]);
      if (cleaned) {
        next[field] = cleaned;
        break;
      }
    }
  }
  next.captured_at = cleanAttributionValue(source.captured_at);
  return next;
}

export function mergeAttribution(
  stored: AdsAttribution | null | undefined,
  incoming: Partial<AdsAttribution> | null | undefined,
  now: Date = new Date()
): AdsAttribution {
  const base = stored ? { ...stored } : { ...EMPTY_ADS_ATTRIBUTION };
  const next: AdsAttribution = { ...base };
  const inc = incoming ?? {};
  let clickChanged = false;

  for (const field of ADS_ATTRIBUTION_FIELDS) {
    const value = cleanAttributionValue(inc[field] ?? undefined);
    if (!value) continue;
    if ((CLICK_FIELDS as readonly string[]).includes(field) && value !== base[field]) {
      clickChanged = true;
    }
    next[field] = value;
  }

  if (clickChanged || (!next.captured_at && CLICK_FIELDS.some((field) => next[field]))) {
    next.captured_at = now.toISOString();
  } else {
    next.captured_at = base.captured_at;
  }

  return next;
}

export function serializeAttributionCookie(value: AdsAttribution): string {
  const params = new URLSearchParams();
  for (const field of ADS_ATTRIBUTION_FIELDS) {
    const cleaned = value[field];
    if (cleaned) params.set(field, cleaned);
  }
  if (value.captured_at) params.set('captured_at', value.captured_at);
  return params.toString();
}

export function parseAttributionCookie(raw: string | null | undefined): AdsAttribution | null {
  if (!raw) return null;
  let text = raw.trim();
  if (!text) return null;
  if (text.includes('%') && !text.includes('&') && !text.startsWith('{')) {
    try {
      text = decodeURIComponent(text);
    } catch {
      return null;
    }
  }
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return emptyToNullAttribution(attributionFromRecord(parsed));
    } catch {
      return null;
    }
  }
  const params = new URLSearchParams(text);
  const record: Record<string, unknown> = {};
  params.forEach((value, key) => {
    record[key] = value;
  });
  return emptyToNullAttribution(attributionFromRecord(record));
}

export function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string
): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export function gaSessionCookieValue(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq);
    if (!name.startsWith('_ga_')) continue;
    const value = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export function attributionFromCookieHeader(
  cookieHeader: string | null | undefined,
  now: Date = new Date()
): AdsAttribution | null {
  const stored = parseAttributionCookie(readCookieValue(cookieHeader, ADS_ATTRIBUTION_COOKIE));
  const gaClient = gaClientIdFromCookie(readCookieValue(cookieHeader, '_ga'));
  const gaSession = gaSessionIdFromCookie(gaSessionCookieValue(cookieHeader));
  const merged = mergeAttribution(
    stored,
    { ga_client_id: gaClient, ga_session_id: gaSession },
    now
  );
  return emptyToNullAttribution(merged);
}

export function attributionCookieAssignment(
  value: AdsAttribution,
  options?: { secure?: boolean }
): string {
  const encoded = encodeURIComponent(serializeAttributionCookie(value));
  const parts = [
    `${ADS_ATTRIBUTION_COOKIE}=${encoded}`,
    `Max-Age=${ADS_ATTRIBUTION_MAX_AGE_SEC}`,
    'Path=/',
    'SameSite=Lax',
  ];
  if (options?.secure) parts.push('Secure');
  return parts.join('; ');
}

const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paid_search', 'paidsearch']);

export function isPaidSearchMedium(medium: string | null | undefined): boolean {
  const value = medium?.trim().toLowerCase();
  return Boolean(value && PAID_MEDIUMS.has(value));
}

const GOOGLE_ADS_LABELS = new Set([
  'google_ads',
  'googleads',
  'google-ads',
  'google ads',
  'adwords',
  'google_adwords',
  'googleadwords',
  'cpc',
  'ppc',
]);

export function isGoogleAdsLabel(value: string | null | undefined): boolean {
  const key = value?.trim().toLowerCase();
  return Boolean(key && GOOGLE_ADS_LABELS.has(key));
}

export function isGoogleAdsTouch(input: {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  utm_medium?: string | null;
  leadSourceLabel?: string | null;
}): boolean {
  if (cleanAttributionValue(input.gclid || undefined)) return true;
  if (cleanAttributionValue(input.gbraid || undefined)) return true;
  if (cleanAttributionValue(input.wbraid || undefined)) return true;
  if (isPaidSearchMedium(input.utm_medium)) return true;
  return isGoogleAdsLabel(input.leadSourceLabel);
}

/** Campaign is utm_campaign. Keyword is utm_term. */
export function campaignAndKeyword(value: Pick<AdsAttribution, 'utm_campaign' | 'utm_term'>): {
  campaign: string | null;
  keyword: string | null;
} {
  return {
    campaign: value.utm_campaign,
    keyword: value.utm_term,
  };
}
