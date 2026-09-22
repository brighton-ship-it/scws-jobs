/**
 * Jobber OAuth access-token refresh.
 *
 * Access tokens expire in ~3600s. Jobber rotates refresh tokens on every
 * successful use. The only writer is Supabase settings key `jobber_oauth`.
 * Env JOBBER_ACCESS_TOKEN / JOBBER_REFRESH_TOKEN may seed that row once,
 * after a successful read proves it is empty. They are never refreshed on
 * their own once a durable pair exists, and a failed durable read does not
 * fall through to env — that fall-through is what desynced the box file
 * and Vercel.
 *
 * Refreshes take a lease and compare-and-swap the generation before the
 * Jobber call, so two cold starts cannot exchange the same refresh token.
 * Memory + process.env are a warm-isolate cache only. They do not update
 * Vercel env vars. Never log token or secret values.
 */

import {
  JOBBER_REFRESH_LEASE_MS,
  JOBBER_REFRESH_LOCK_ATTEMPTS,
  isJobberRefreshLeaseHeld,
  newJobberRefreshOwner,
  wrapJobberTokenStore,
  type JobberAuthSource,
  type JobberLockedTokenStore,
  type JobberOAuthRecord,
} from './token-lock.ts';
import {
  JOBBER_DURABLE_TOKEN_PERSIST_FAILED,
  asDurableLoadError,
  assertJobberDurableStoreConfigured,
  persistJobberTokensDurable,
  resolveJobberDurableStore,
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
  /** Access token Jobber just rejected. Do not reuse it from the durable row. */
  rejectedAccessToken?: string | null;
  wait?: (ms: number) => Promise<void>;
};

export class JobberOAuthRefreshError extends Error {
  readonly httpStatus: number;

  constructor(httpStatus: number) {
    super(`Jobber OAuth token refresh failed (HTTP ${httpStatus})`);
    this.name = 'JobberOAuthRefreshError';
    this.httpStatus = httpStatus;
  }
}

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

/**
 * Warm-isolate cache. This does not update Vercel project env vars.
 * The refresh path reads the durable row, not this copy, once that row exists.
 */
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

function delay(deps: JobberAuthDeps, ms: number): Promise<void> {
  if (deps.wait) return deps.wait(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockedStore(deps: JobberAuthDeps): JobberLockedTokenStore | null {
  if (deps.durableStore === null) return null;
  const store = resolveJobberDurableStore(deps);
  if (!store) return null;
  return wrapJobberTokenStore(store);
}

export function canAttemptJobberRefresh(deps: JobberAuthDeps = {}): boolean {
  const env = deps.env ?? process.env;
  if (getJobberOAuthCredentials(env)) return true;
  return lockedStore(deps) != null;
}

function logAuth(source: JobberAuthSource | 'unconfigured', action: string, extra?: string): void {
  const suffix = extra ? ` ${extra}` : '';
  console.info(`[jobber-auth] auth_source=${source} action=${action}${suffix}`);
}

function notConfigured(): Error {
  return new Error(
    'Jobber OAuth refresh is not configured (need JOBBER_REFRESH_TOKEN, JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET)'
  );
}

async function refreshFromEnvOnly(deps: JobberAuthDeps): Promise<JobberTokenSet> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowMs = deps.nowMs ?? Date.now();
  const credentials = getJobberOAuthCredentials(env);
  if (!credentials) throw notConfigured();

  logAuth('env_bootstrap', 'refresh', 'durable=unconfigured');
  const result = await exchangeRefreshToken(credentials, fetchImpl, nowMs);
  if (!result.ok) {
    console.error(
      `[jobber-auth] auth_source=env_bootstrap action=refresh_failed http=${result.status}`
    );
    throw new JobberOAuthRefreshError(result.status);
  }
  persistJobberTokens(result.tokens, env);
  await persistJobberTokensDurable(result.tokens, deps);
  logAuth('env_bootstrap', 'persisted', 'durable=unconfigured');
  return result.tokens;
}

async function readLockedRecord(
  store: JobberLockedTokenStore
): Promise<JobberOAuthRecord | null> {
  try {
    return await store.loadRecord();
  } catch (error) {
    const loadError = asDurableLoadError(error);
    console.error(`[jobber-auth] durable token load failed reason=${loadError.reason}`);
    throw loadError;
  }
}

function reuseFreshDurable(
  record: JobberOAuthRecord | null,
  deps: JobberAuthDeps,
  nowMs: number
): JobberTokenSet | null {
  const rejected = deps.rejectedAccessToken?.trim() || null;
  if (!record?.tokens) return null;
  if (!isJobberAccessTokenFresh(record.tokens, nowMs)) return null;
  if (rejected && record.tokens.accessToken === rejected) return null;
  return record.tokens;
}

/**
 * Cross-isolate refresh. Does not coalesce with other callers in this
 * process; refreshJobberTokens adds that. Tests call this directly to
 * prove two isolates share one Jobber exchange.
 */
export async function refreshLockedJobberTokens(
  deps: JobberAuthDeps = {}
): Promise<JobberTokenSet> {
  assertJobberDurableStoreConfigured(deps);
  const store = lockedStore(deps);
  if (!store) return refreshFromEnvOnly(deps);

  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowMs = deps.nowMs ?? Date.now();

  for (let attempt = 0; attempt < JOBBER_REFRESH_LOCK_ATTEMPTS; attempt++) {
    const record = await readLockedRecord(store);
    const reusable = reuseFreshDurable(record, deps, nowMs);
    if (reusable) {
      persistJobberTokens(reusable, env);
      logAuth('durable', 'reuse');
      return reusable;
    }

    if (record && isJobberRefreshLeaseHeld(record, nowMs)) {
      await delay(deps, 25 * (attempt + 1));
      continue;
    }

    const owner = newJobberRefreshOwner();
    let claim: Awaited<ReturnType<JobberLockedTokenStore['tryClaim']>>;
    try {
      claim = await store.tryClaim({
        owner,
        expectedGeneration: record?.generation ?? 0,
        expectedFingerprint: record?.refreshFingerprint ?? null,
        nowMs,
        leaseUntilMs: nowMs + JOBBER_REFRESH_LEASE_MS,
      });
    } catch (error) {
      const loadError = asDurableLoadError(error);
      console.error(`[jobber-auth] durable token load failed reason=${loadError.reason}`);
      throw loadError;
    }

    if (!claim.acquired || !claim.record) {
      await delay(deps, 25 * (attempt + 1));
      continue;
    }

    const held = claim.record;
    const durableRefresh = held.tokens?.refreshToken?.trim() || '';
    const source: JobberAuthSource = durableRefresh ? 'durable' : 'env_bootstrap';
    const refreshToken = durableRefresh || trimEnv(env, 'JOBBER_REFRESH_TOKEN');
    const clientId = trimEnv(env, 'JOBBER_CLIENT_ID');
    const clientSecret = trimEnv(env, 'JOBBER_CLIENT_SECRET');
    if (!refreshToken || !clientId || !clientSecret) {
      await store.release(owner);
      throw notConfigured();
    }

    logAuth(source, 'refresh');
    let result: Awaited<ReturnType<typeof exchangeRefreshToken>>;
    try {
      result = await exchangeRefreshToken(
        { clientId, clientSecret, refreshToken },
        fetchImpl,
        nowMs
      );
    } catch (error) {
      await store.release(owner);
      throw error;
    }

    if (!result.ok) {
      await store.release(owner);
      const latest = await readLockedRecord(store);
      const moved =
        Boolean(latest?.refreshFingerprint) &&
        latest?.refreshFingerprint !== held.refreshFingerprint;
      const latestReusable = moved ? reuseFreshDurable(latest, deps, nowMs) : null;
      if (latestReusable) {
        persistJobberTokens(latestReusable, env);
        logAuth('durable', 'reuse');
        return latestReusable;
      }
      if (moved && latest?.tokens && latest.tokens.refreshToken !== refreshToken) {
        continue;
      }
      console.error(
        `[jobber-auth] auth_source=${source} action=refresh_failed http=${result.status}`
      );
      throw new JobberOAuthRefreshError(result.status);
    }

    try {
      const committed = await store.commit({
        owner,
        expectedGeneration: held.generation,
        expectedFingerprint: held.refreshFingerprint,
        tokens: result.tokens,
        seededFrom: source,
      });
      if (!committed.committed) {
        logAuth(source, 'commit_lost');
        const latestReusable = reuseFreshDurable(committed.record, deps, nowMs);
        if (latestReusable) {
          persistJobberTokens(latestReusable, env);
          logAuth('durable', 'reuse');
          return latestReusable;
        }
        continue;
      }
    } catch (error) {
      console.error('[jobber-auth] durable token persist failed');
      if (error instanceof Error && error.message === JOBBER_DURABLE_TOKEN_PERSIST_FAILED) {
        throw error;
      }
      throw new Error(JOBBER_DURABLE_TOKEN_PERSIST_FAILED);
    }

    persistJobberTokens(result.tokens, env);
    logAuth(source, 'persisted');
    return result.tokens;
  }

  throw new Error('Jobber OAuth refresh lock was not acquired');
}

export async function refreshJobberTokens(
  deps: JobberAuthDeps = {}
): Promise<JobberTokenSet> {
  if (memory.refreshInFlight) {
    return memory.refreshInFlight;
  }

  const run = refreshLockedJobberTokens(deps);
  memory.refreshInFlight = run;
  try {
    return await run;
  } finally {
    if (memory.refreshInFlight === run) {
      memory.refreshInFlight = null;
    }
  }
}

async function accessTokenFromEnvOnly(
  deps: JobberAuthDeps & { forceRefresh?: boolean }
): Promise<string> {
  const env = deps.env ?? process.env;
  const nowMs = deps.nowMs ?? Date.now();
  const envToken = memory.tokens?.accessToken || trimEnv(env, 'JOBBER_ACCESS_TOKEN');
  const knownExpired = Boolean(memory.tokens && !isJobberAccessTokenFresh(memory.tokens, nowMs));

  if ((deps.forceRefresh || knownExpired || !envToken) && getJobberOAuthCredentials(env)) {
    const tokens = await refreshJobberTokens(deps);
    return tokens.accessToken;
  }

  if (envToken) return envToken;
  throw new Error('JOBBER_ACCESS_TOKEN is not set');
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

  if (deps.durableStore !== null) {
    assertJobberDurableStoreConfigured(deps);
  }

  const store = lockedStore(deps);
  if (!store) {
    return accessTokenFromEnvOnly(deps);
  }

  const record = await readLockedRecord(store);
  if (record?.tokens && !deps.forceRefresh && isJobberAccessTokenFresh(record.tokens, nowMs)) {
    const cold = !memory.tokens;
    persistJobberTokens(record.tokens, env);
    if (cold) logAuth('durable', 'use_stored');
    return record.tokens.accessToken;
  }

  const canRefresh = Boolean(record?.tokens?.refreshToken || getJobberOAuthCredentials(env));
  if (canRefresh && (deps.forceRefresh || record?.tokens || !trimEnv(env, 'JOBBER_ACCESS_TOKEN') || !record?.tokens)) {
    if (!record?.tokens && trimEnv(env, 'JOBBER_ACCESS_TOKEN') && getJobberOAuthCredentials(env)) {
      const tokens = await refreshJobberTokens(deps);
      return tokens.accessToken;
    }
    if (record?.tokens || !trimEnv(env, 'JOBBER_ACCESS_TOKEN')) {
      const tokens = await refreshJobberTokens(deps);
      return tokens.accessToken;
    }
  }

  const envToken = trimEnv(env, 'JOBBER_ACCESS_TOKEN');
  if (!record?.tokens && envToken) {
    logAuth('env_bootstrap', 'use_env_access');
    return envToken;
  }

  throw new Error('JOBBER_ACCESS_TOKEN is not set');
}
