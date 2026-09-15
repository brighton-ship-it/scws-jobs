/**
 * Jobber OAuth access-token refresh.
 *
 * Access tokens expire in ~3600s. Jobber rotates refresh tokens, so a
 * successful refresh must persist both tokens somewhere that survives a
 * cold lambda (Supabase settings key `jobber_oauth`). Memory + process.env
 * alone still help a warm isolate.
 *
 * Refresh only when a known access token is near expiry, or after GraphQL
 * HTTP 401. Do not refresh on every cold start — that burns the rotated
 * refresh token and leaves the next isolate with a stale Vercel env value.
 *
 * Never log token or secret values.
 */

import {
  loadDurableJobberTokens,
  persistJobberTokensDurable,
  type JobberDurableTokenStore,
} from './token-store.ts';

export const JOBBER_OAUTH_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';
export const JOBBER_TOKEN_EXPIRY_SKEW_MS = 60_000;
export const DEFAULT_JOBBER_ACCESS_EXPIRES_IN_SEC = 3600;

export type JobberOAuthCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export type JobberTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
};

export type JobberAuthDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  durableStore?: JobberDurableTokenStore | null;
};

type MemoryState = {
  tokens: JobberTokenSet | null;
  refreshInFlight: Promise<JobberTokenSet> | null;
};

const memory: MemoryState = {
  tokens: null,
  refreshInFlight: null,
};

function trimEnv(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value || null;
}

export function resetJobberAuthCache(): void {
  memory.tokens = null;
  memory.refreshInFlight = null;
}

export function getCachedJobberTokens(): JobberTokenSet | null {
  return memory.tokens;
}

export function persistJobberTokens(
  tokens: JobberTokenSet,
  env: NodeJS.ProcessEnv = process.env
): void {
  memory.tokens = tokens;
  env.JOBBER_ACCESS_TOKEN = tokens.accessToken;
  env.JOBBER_REFRESH_TOKEN = tokens.refreshToken;
}

export function getJobberOAuthCredentials(
  env: NodeJS.ProcessEnv = process.env
): JobberOAuthCredentials | null {
  const clientId = trimEnv(env, 'JOBBER_CLIENT_ID');
  const clientSecret = trimEnv(env, 'JOBBER_CLIENT_SECRET');
  const refreshToken = memory.tokens?.refreshToken?.trim() || trimEnv(env, 'JOBBER_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }
  return { clientId, clientSecret, refreshToken };
}

export function isJobberAccessTokenFresh(
  tokens: JobberTokenSet | null = memory.tokens,
  nowMs: number = Date.now()
): boolean {
  return Boolean(tokens && tokens.expiresAtMs - JOBBER_TOKEN_EXPIRY_SKEW_MS > nowMs);
}

export function parseJobberTokenResponse(
  json: unknown,
  options?: { nowMs?: number; previousRefreshToken?: string }
): JobberTokenSet {
  if (!json || typeof json !== 'object') {
    throw new Error('Jobber OAuth token refresh returned invalid JSON');
  }

  const data = json as Record<string, unknown>;
  if (typeof data.access_token !== 'string' || !data.access_token.trim()) {
    throw new Error('Jobber OAuth token refresh returned no access_token');
  }

  const rotated =
    typeof data.refresh_token === 'string' ? data.refresh_token.trim() : '';
  const refreshToken = rotated || options?.previousRefreshToken?.trim() || '';
  if (!refreshToken) {
    throw new Error('Jobber OAuth token refresh returned no refresh_token');
  }

  const nowMs = options?.nowMs ?? Date.now();
  const rawExpires = data.expires_in;
  const expiresInSec =
    typeof rawExpires === 'number' && rawExpires > 0
      ? rawExpires
      : typeof rawExpires === 'string' && Number(rawExpires) > 0
        ? Number(rawExpires)
        : DEFAULT_JOBBER_ACCESS_EXPIRES_IN_SEC;

  return {
    accessToken: data.access_token.trim(),
    refreshToken,
    expiresAtMs: nowMs + expiresInSec * 1000,
  };
}

async function exchangeRefreshToken(
  credentials: JobberOAuthCredentials,
  fetchImpl: typeof fetch,
  nowMs: number
): Promise<{ ok: true; tokens: JobberTokenSet } | { ok: false; status: number }> {
  const response = await fetchImpl(JOBBER_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
    }),
  });

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  return {
    ok: true,
    tokens: parseJobberTokenResponse(json, {
      nowMs,
      previousRefreshToken: credentials.refreshToken,
    }),
  };
}

export async function refreshJobberTokens(
  deps: JobberAuthDeps = {}
): Promise<JobberTokenSet> {
  if (memory.refreshInFlight) {
    return memory.refreshInFlight;
  }

  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowMs = deps.nowMs ?? Date.now();
  const credentials = getJobberOAuthCredentials(env);
  if (!credentials) {
    throw new Error(
      'Jobber OAuth refresh is not configured (need JOBBER_REFRESH_TOKEN, JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET)'
    );
  }

  const run = (async () => {
    let result = await exchangeRefreshToken(credentials, fetchImpl, nowMs);

    if (!result.ok) {
      const durable = await loadDurableJobberTokens(deps);
      if (durable?.refreshToken && durable.refreshToken !== credentials.refreshToken) {
        persistJobberTokens(durable, env);
        const retryCredentials = getJobberOAuthCredentials(env);
        if (retryCredentials) {
          result = await exchangeRefreshToken(retryCredentials, fetchImpl, nowMs);
        }
      }
    }

    if (!result.ok) {
      throw new Error(`Jobber OAuth token refresh failed (HTTP ${result.status})`);
    }

    persistJobberTokens(result.tokens, env);
    await persistJobberTokensDurable(result.tokens, deps);
    return result.tokens;
  })();

  memory.refreshInFlight = run;
  try {
    return await run;
  } finally {
    if (memory.refreshInFlight === run) {
      memory.refreshInFlight = null;
    }
  }
}

export async function getValidJobberAccessToken(
  deps: JobberAuthDeps & { token?: string | null; forceRefresh?: boolean } = {}
): Promise<string> {
  const explicit = deps.token?.trim();
  if (explicit && !deps.forceRefresh) {
    return explicit;
  }

  const env = deps.env ?? process.env;
  const nowMs = deps.nowMs ?? Date.now();

  if (!deps.forceRefresh && isJobberAccessTokenFresh(memory.tokens, nowMs)) {
    return memory.tokens!.accessToken;
  }

  if (!memory.tokens) {
    const durable = await loadDurableJobberTokens(deps);
    if (durable) {
      persistJobberTokens(durable, env);
      if (!deps.forceRefresh && isJobberAccessTokenFresh(durable, nowMs)) {
        return durable.accessToken;
      }
    }
  }

  const envToken = memory.tokens?.accessToken || trimEnv(env, 'JOBBER_ACCESS_TOKEN');
  const knownExpired = Boolean(memory.tokens && !isJobberAccessTokenFresh(memory.tokens, nowMs));

  if ((deps.forceRefresh || knownExpired || !envToken) && getJobberOAuthCredentials(env)) {
    const tokens = await refreshJobberTokens(deps);
    return tokens.accessToken;
  }

  if (envToken) return envToken;

  throw new Error('JOBBER_ACCESS_TOKEN is not set');
}
