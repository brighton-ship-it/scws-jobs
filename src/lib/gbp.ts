/**
 * Google Business Profile ratings helper.
 *
 * Uses OAuth refresh-token credentials (env only) and the GMB v4 reviews
 * aggregates endpoint. Review text / reviewer PII is never returned.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVIEWS_API = 'https://mybusiness.googleapis.com/v4';

export const GBP_REQUIRED_ENV = [
  'GBP_CLIENT_ID',
  'GBP_CLIENT_SECRET',
  'GBP_REFRESH_TOKEN',
] as const;

const DEFAULT_ACCOUNT = 'accounts/109987064359914956127';
const DEFAULT_RAMONA_LOCATION = 'locations/8959939212840285363';
const DEFAULT_ANZA_LOCATION = 'locations/17699062318199230566';
const DEFAULT_RAMONA_REVIEW_URL = 'https://g.page/r/CU9X_NG3TvP2EBM/review';

const MARKETING_ORIGINS = new Set([
  'https://scwellservice.com',
  'https://www.scwellservice.com',
]);

export type GbpShopKey = 'ramona' | 'anza';

export type GbpShopRating = {
  rating: number;
  count: number;
  url?: string;
};

export type GbpRatingsPayload = {
  ramona: GbpShopRating;
  anza: GbpShopRating;
  updated: string;
};

export type GbpCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;

function envTrim(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function resourceName(envName: string, prefix: string, fallback: string): string {
  const raw = envTrim(envName);
  if (!raw) return fallback;
  return raw.startsWith(prefix) ? raw : `${prefix}${raw}`;
}

export function getGbpCredentials(): GbpCredentials | null {
  const clientId = envTrim('GBP_CLIENT_ID');
  const clientSecret = envTrim('GBP_CLIENT_SECRET');
  const refreshToken = envTrim('GBP_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }
  return { clientId, clientSecret, refreshToken };
}

export function isGbpConfigured(): boolean {
  return getGbpCredentials() !== null;
}

export function getGbpAccountName(): string {
  return resourceName('GBP_ACCOUNT_ID', 'accounts/', DEFAULT_ACCOUNT);
}

export function getGbpShopConfig(): Record<
  GbpShopKey,
  { locationName: string; url?: string }
> {
  const ramonaUrl = envTrim('GBP_RAMONA_REVIEW_URL') ?? DEFAULT_RAMONA_REVIEW_URL;
  const anzaUrl = envTrim('GBP_ANZA_REVIEW_URL');

  return {
    ramona: {
      locationName: resourceName(
        'GBP_RAMONA_LOCATION_ID',
        'locations/',
        DEFAULT_RAMONA_LOCATION
      ),
      url: ramonaUrl,
    },
    anza: {
      locationName: resourceName(
        'GBP_ANZA_LOCATION_ID',
        'locations/',
        DEFAULT_ANZA_LOCATION
      ),
      ...(anzaUrl ? { url: anzaUrl } : {}),
    },
  };
}

export function isAllowedGbpOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (MARKETING_ORIGINS.has(origin)) return true;

  try {
    const url = new URL(origin);
    const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return localHost && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}

export function gbpCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  if (isAllowedGbpOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin!;
  }

  return headers;
}

export function parseGbpReviewAggregates(payload: unknown): {
  rating: number;
  count: number;
} {
  if (!payload || typeof payload !== 'object') {
    throw new Error('GBP reviews response was not an object');
  }

  const data = payload as Record<string, unknown>;
  const rating = data.averageRating;
  const count = data.totalReviewCount;

  if (typeof rating !== 'number' || !Number.isFinite(rating)) {
    throw new Error('GBP reviews response missing averageRating');
  }
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
    throw new Error('GBP reviews response missing totalReviewCount');
  }

  return { rating, count };
}

function reviewsUrl(accountName: string, locationName: string): string {
  const params = new URLSearchParams({
    pageSize: '1',
    fields: 'averageRating,totalReviewCount',
  });
  return `${REVIEWS_API}/${accountName}/${locationName}/reviews?${params.toString()}`;
}

async function refreshGbpAccessToken(
  credentials: GbpCredentials,
  fetchImpl: typeof fetch
): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs - 60_000 > now) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`GBP token refresh failed (${response.status})`);
  }

  const json = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };

  if (typeof json.access_token !== 'string' || !json.access_token) {
    throw new Error('GBP token refresh returned no access_token');
  }

  const expiresInSec =
    typeof json.expires_in === 'number' && json.expires_in > 0
      ? json.expires_in
      : 3600;

  tokenCache = {
    accessToken: json.access_token,
    expiresAtMs: now + expiresInSec * 1000,
  };

  return json.access_token;
}

async function fetchShopRating(
  accessToken: string,
  accountName: string,
  locationName: string,
  fetchImpl: typeof fetch
): Promise<{ rating: number; count: number }> {
  const response = await fetchImpl(reviewsUrl(accountName, locationName), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`GBP reviews fetch failed (${response.status})`);
  }

  return parseGbpReviewAggregates(await response.json());
}

export async function fetchGbpRatings(
  fetchImpl: typeof fetch = fetch
): Promise<GbpRatingsPayload> {
  const credentials = getGbpCredentials();
  if (!credentials) {
    throw new Error('gbp_unconfigured');
  }

  const accessToken = await refreshGbpAccessToken(credentials, fetchImpl);
  const accountName = getGbpAccountName();
  const shops = getGbpShopConfig();

  const [ramona, anza] = await Promise.all([
    fetchShopRating(accessToken, accountName, shops.ramona.locationName, fetchImpl),
    fetchShopRating(accessToken, accountName, shops.anza.locationName, fetchImpl),
  ]);

  const payload: GbpRatingsPayload = {
    ramona: {
      rating: ramona.rating,
      count: ramona.count,
      ...(shops.ramona.url ? { url: shops.ramona.url } : {}),
    },
    anza: {
      rating: anza.rating,
      count: anza.count,
      ...(shops.anza.url ? { url: shops.anza.url } : {}),
    },
    updated: new Date().toISOString(),
  };

  return payload;
}

export function resetGbpTokenCache(): void {
  tokenCache = null;
}

const SUCCESS_CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';
const ERROR_CACHE = 'no-store';

export type GbpHttpResult = {
  status: number;
  body: GbpRatingsPayload | { error: 'gbp_unconfigured' | 'gbp_unavailable' };
  headers: Record<string, string>;
};

export async function gbpRatingsHttp(
  request: Request,
  fetchImpl: typeof fetch = fetch
): Promise<GbpHttpResult> {
  const cors = gbpCorsHeaders(request);

  if (!isGbpConfigured()) {
    return {
      status: 503,
      body: { error: 'gbp_unconfigured' },
      headers: { ...cors, 'Cache-Control': ERROR_CACHE },
    };
  }

  try {
    const payload = await fetchGbpRatings(fetchImpl);
    return {
      status: 200,
      body: payload,
      headers: { ...cors, 'Cache-Control': SUCCESS_CACHE },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[gbp-ratings] unavailable:', message);
    return {
      status: 502,
      body: { error: 'gbp_unavailable' },
      headers: { ...cors, 'Cache-Control': ERROR_CACHE },
    };
  }
}
