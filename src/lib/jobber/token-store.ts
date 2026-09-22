/**
 * Durable Jobber OAuth token store.
 *
 * Jobber rotates refresh tokens. Memory + process.env do not survive a
 * cold lambda, so the next isolate would replay the stale Vercel
 * JOBBER_REFRESH_TOKEN and get HTTP 401.
 *
 * Tokens are stored in Supabase `settings.key = jobber_oauth`, encrypted
 * with AES-256-GCM. That row is the only place a refresh may write.
 * Production requires JOBBER_TOKEN_ENCRYPTION_KEY. A failed durable load
 * (missing table, bad service key, network, decrypt) throws. It must not
 * fall through to an env refresh — that is the race that keeps killing
 * the shared refresh token. Env tokens seed the row only when a successful
 * read proves the row is empty. Never log token values.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { JobberTokenSet } from './auth.ts';
import {
  applyJobberRefreshCommit,
  canClaimJobberRefresh,
  newJobberRefreshOwner,
  padLeaseMillis,
  parseLeaseMillis,
  type JobberAuthSource,
  type JobberCommitResult,
  type JobberLockedTokenStore,
  type JobberOAuthRecord,
  type JobberRefreshClaim,
  type JobberRefreshCommit,
} from './token-lock.ts';

export const JOBBER_OAUTH_SETTINGS_KEY = 'jobber_oauth';
export const JOBBER_TOKEN_ENCRYPTION_KEY_ENV = 'JOBBER_TOKEN_ENCRYPTION_KEY';

export const JOBBER_ENCRYPTION_KEY_REQUIRED =
  'JOBBER_TOKEN_ENCRYPTION_KEY is not set in Production. Generate one with: openssl rand -hex 32. Set it on Vercel project scws-jobs (Production) and redeploy. Do not commit the value.';

export const JOBBER_DURABLE_STORE_NOT_CONFIGURED =
  'Jobber durable token store is not configured in Production (need JOBBER_TOKEN_ENCRYPTION_KEY, NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SERVICE_KEY)';

export const JOBBER_DURABLE_TOKEN_LOAD_FAILED = 'Jobber durable token load failed';
export const JOBBER_DURABLE_TOKEN_PERSIST_FAILED = 'Jobber durable token persist failed';
export const JOBBER_SETTINGS_TABLE_MISSING =
  'Jobber durable token load failed: public.settings is missing. Apply supabase/migrations/20260922_jobber_oauth_single_writer.sql in the Supabase SQL Editor. Env tokens were not refreshed.';
export const JOBBER_OAUTH_LOCK_SQL =
  'supabase/migrations/20260922_jobber_oauth_single_writer.sql';

export type JobberDurableLoadReason = 'missing_table' | 'unreachable' | 'decrypt_failed';

export class JobberDurableLoadError extends Error {
  readonly reason: JobberDurableLoadReason;

  constructor(reason: JobberDurableLoadReason, message: string) {
    super(message);
    this.name = 'JobberDurableLoadError';
    this.reason = reason;
  }
}

const MISSING_SETTINGS_TABLE_MESSAGE =
  /Could not find the table ['"]?(?:public\.)?settings['"]?/i;
const MISSING_SETTINGS_RELATION_MESSAGE =
  /relation ['"]?(?:public\.)?settings['"]? does not exist/i;

export type JobberDurableTokenStore = {
  load(): Promise<JobberTokenSet | null>;
  save(tokens: JobberTokenSet): Promise<void>;
};

export type { JobberLockedTokenStore, JobberOAuthRecord, JobberAuthSource };

export type JobberTokenEnvelope = {
  v: 1;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
};

export type JobberTokenStoreDeps = {
  env?: NodeJS.ProcessEnv;
  durableStore?: JobberDurableTokenStore | null;
};

export type JobberEncryptionKeySource =
  | typeof JOBBER_TOKEN_ENCRYPTION_KEY_ENV
  | 'JOBBER_CLIENT_SECRET'
  | null;

export type JobberSettingsTableState = 'present' | 'missing' | 'unknown';

export type JobberDurableStoreDiagnosis = {
  ready: boolean;
  encryptionKeyConfigured: boolean;
  encryptionKeySource: JobberEncryptionKeySource;
  supabaseConfigured: boolean;
  reachable: boolean | null;
  storedRow: boolean | null;
  hasStoredTokens: boolean | null;
  source: 'supabase' | 'env_bootstrap' | 'unconfigured';
  authMode: 'durable' | 'env_bootstrap' | 'unconfigured';
  expiresAt: string | null;
  settingsTable: JobberSettingsTableState;
  lockReady: boolean | null;
  loadError: string | null;
};

function trimEnv(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value || null;
}

function hashKeyMaterial(material: string): Buffer {
  return createHash('sha256').update(material).digest();
}

function supabaseUrl(env: NodeJS.ProcessEnv): string | null {
  const url = trimEnv(env, 'NEXT_PUBLIC_SUPABASE_URL');
  if (!url || url === 'your-supabase-url') return null;
  return url;
}

function supabaseServiceKey(env: NodeJS.ProcessEnv): string | null {
  return trimEnv(env, 'SUPABASE_SERVICE_KEY') || trimEnv(env, 'SUPABASE_SERVICE_ROLE_KEY');
}

export function isJobberSecretSettingsKey(key: string | null | undefined): boolean {
  return key === JOBBER_OAUTH_SETTINGS_KEY;
}

export function isJobberProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === 'production';
}

export function hasDedicatedJobberTokenEncryptionKey(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(trimEnv(env, JOBBER_TOKEN_ENCRYPTION_KEY_ENV));
}

export function jobberEncryptionKeySource(
  env: NodeJS.ProcessEnv = process.env
): JobberEncryptionKeySource {
  if (hasDedicatedJobberTokenEncryptionKey(env)) return JOBBER_TOKEN_ENCRYPTION_KEY_ENV;
  if (trimEnv(env, 'JOBBER_CLIENT_SECRET')) return 'JOBBER_CLIENT_SECRET';
  return null;
}

function encryptionMaterials(env: NodeJS.ProcessEnv): string[] {
  const dedicated = trimEnv(env, JOBBER_TOKEN_ENCRYPTION_KEY_ENV);
  const clientSecret = trimEnv(env, 'JOBBER_CLIENT_SECRET');
  const materials: string[] = [];
  if (dedicated) materials.push(dedicated);
  if (clientSecret && clientSecret !== dedicated) materials.push(clientSecret);
  return materials;
}

export function jobberTokenEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const material = encryptionMaterials(env)[0];
  if (!material) return null;
  return hashKeyMaterial(material);
}

export function encryptJobberTokenEnvelope(
  tokens: JobberTokenSet,
  env: NodeJS.ProcessEnv = process.env
): JobberTokenEnvelope {
  const key = jobberTokenEncryptionKey(env);
  if (!key) {
    throw new Error('Jobber token encryption key is not configured');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAtMs: tokens.expiresAtMs,
  });
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decryptWithKey(envelope: JobberTokenEnvelope, key: Buffer): JobberTokenSet | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(plaintext) as Partial<JobberTokenSet>;
    if (
      typeof parsed.accessToken !== 'string' ||
      !parsed.accessToken.trim() ||
      typeof parsed.refreshToken !== 'string' ||
      !parsed.refreshToken.trim() ||
      typeof parsed.expiresAtMs !== 'number' ||
      !Number.isFinite(parsed.expiresAtMs)
    ) {
      return null;
    }
    return {
      accessToken: parsed.accessToken.trim(),
      refreshToken: parsed.refreshToken.trim(),
      expiresAtMs: parsed.expiresAtMs,
    };
  } catch {
    return null;
  }
}

/**
 * PostgREST / Postgres errors that mean `public.settings` is not in the
 * schema (migration not applied). Treat as no stored tokens so Production
 * can still bootstrap from JOBBER_* env vars.
 *
 * Do not treat auth, RLS, missing-column, or decrypt failures as missing.
 */
export function isMissingSettingsRelationError(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  const code = (error.code ?? '').toString();
  if (code === 'PGRST205' || code === 'PGRST106' || code === '42P01') {
    return true;
  }
  const message = error.message ?? '';
  return (
    MISSING_SETTINGS_TABLE_MESSAGE.test(message) ||
    MISSING_SETTINGS_RELATION_MESSAGE.test(message)
  );
}

export function asDurableLoadError(error: unknown): JobberDurableLoadError {
  if (error instanceof JobberDurableLoadError) return error;
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  const message = error instanceof Error ? error.message : '';
  if (isMissingSettingsRelationError({ code, message })) {
    return new JobberDurableLoadError('missing_table', JOBBER_SETTINGS_TABLE_MISSING);
  }
  return new JobberDurableLoadError('unreachable', JOBBER_DURABLE_TOKEN_LOAD_FAILED);
}

export function isMissingJobberLockRpc(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  const code = (error.code ?? '').toString();
  if (code === 'PGRST202' || code === '42883') return true;
  const message = error.message ?? '';
  return /Could not find the function/i.test(message) && /jobber_oauth_(claim|commit|release|lock_status)/i.test(message);
}

/**
 * A settings read error is a durable-load failure. Only a successful
 * response with no row means "empty, env may seed once".
 * An existing row that cannot be decrypted still throws.
 */
export function tokensFromSettingsLoadResult(
  result: {
    data?: { value?: unknown } | null;
    error?: { code?: string | null; message?: string | null } | null;
  },
  env: NodeJS.ProcessEnv = process.env
): JobberTokenSet | null {
  if (result.error) {
    throw asDurableLoadError(result.error);
  }
  if (!result.data?.value) return null;
  return recordFromStoredJobberValue(result.data.value, env).tokens;
}

export function recordFromStoredJobberValue(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env
): JobberOAuthRecord {
  if (!value || typeof value !== 'object') {
    throw new JobberDurableLoadError('decrypt_failed', JOBBER_DURABLE_TOKEN_LOAD_FAILED);
  }
  const raw = value as Record<string, unknown>;
  const generation =
    typeof raw.generation === 'number' && Number.isFinite(raw.generation)
      ? raw.generation
      : typeof raw.generation === 'string' && /^[0-9]+$/.test(raw.generation)
        ? Number(raw.generation)
        : 0;
  const refreshFingerprint =
    typeof raw.refreshFingerprint === 'string' && raw.refreshFingerprint
      ? raw.refreshFingerprint
      : null;
  const leaseOwner = typeof raw.leaseOwner === 'string' && raw.leaseOwner ? raw.leaseOwner : null;
  const leaseUntilMs = parseLeaseMillis(raw.leaseUntil);
  const seededFrom: JobberAuthSource | null =
    raw.seededFrom === 'durable' || raw.seededFrom === 'env_bootstrap' ? raw.seededFrom : null;
  const bootstrap = raw.bootstrap === true;
  const hasCiphertext = raw.v === 1 && typeof raw.data === 'string' && raw.data.length > 0;

  let tokens: JobberTokenSet | null = null;
  if (!bootstrap && hasCiphertext) {
    tokens = decryptJobberTokenEnvelope(value, env);
    if (!tokens) {
      throw new JobberDurableLoadError('decrypt_failed', JOBBER_DURABLE_TOKEN_LOAD_FAILED);
    }
  }

  return {
    tokens,
    generation,
    refreshFingerprint,
    leaseOwner,
    leaseUntilMs,
    seededFrom: tokens ? seededFrom ?? 'durable' : seededFrom,
  };
}

export function buildCommittedJobberValue(
  tokens: JobberTokenSet,
  commit: Pick<JobberRefreshCommit, 'expectedGeneration' | 'seededFrom'>,
  env: NodeJS.ProcessEnv = process.env
): Record<string, unknown> {
  const next = applyJobberRefreshCommit(
    {
      tokens: null,
      generation: commit.expectedGeneration,
      refreshFingerprint: null,
      leaseOwner: null,
      leaseUntilMs: null,
      seededFrom: null,
    },
    {
      owner: 'commit',
      expectedGeneration: commit.expectedGeneration,
      expectedFingerprint: null,
      tokens,
      seededFrom: commit.seededFrom,
    }
  );
  return {
    ...encryptJobberTokenEnvelope(tokens, env),
    generation: next.generation,
    refreshFingerprint: next.refreshFingerprint,
    leaseOwner: null,
    leaseUntil: null,
    seededFrom: commit.seededFrom,
    expiresAt: new Date(tokens.expiresAtMs).toISOString(),
    bootstrap: false,
  };
}

export function decryptJobberTokenEnvelope(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env
): JobberTokenSet | null {
  if (!value || typeof value !== 'object') return null;
  const envelope = value as Partial<JobberTokenEnvelope>;
  if (
    envelope.v !== 1 ||
    envelope.alg !== 'aes-256-gcm' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.tag !== 'string' ||
    typeof envelope.data !== 'string'
  ) {
    return null;
  }

  const materials = encryptionMaterials(env);
  if (!materials.length) return null;

  for (const material of materials) {
    const decoded = decryptWithKey(envelope as JobberTokenEnvelope, hashKeyMaterial(material));
    if (decoded) return decoded;
  }
  return null;
}

type SettingsError = { code?: string | null; message?: string | null } | null;

function generationIsStored(raw: Record<string, unknown>): boolean {
  return (
    typeof raw.generation === 'number' ||
    (typeof raw.generation === 'string' && /^[0-9]+$/.test(raw.generation))
  );
}

export function createSupabaseJobberTokenStore(
  env: NodeJS.ProcessEnv = process.env
): JobberLockedTokenStore | null {
  const url = supabaseUrl(env);
  const serviceKey = supabaseServiceKey(env);
  if (!url || !serviceKey) return null;
  if (!jobberTokenEncryptionKey(env)) return null;
  if (isJobberProductionRuntime(env) && !hasDedicatedJobberTokenEncryptionKey(env)) {
    return null;
  }

  const getClient = async () => {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  };

  async function readRow(): Promise<Record<string, unknown> | null> {
    const client = await getClient();
    const result = await client
      .from('settings')
      .select('value')
      .eq('key', JOBBER_OAUTH_SETTINGS_KEY)
      .maybeSingle();
    if (result.error) throw asDurableLoadError(result.error);
    if (!result.data?.value || typeof result.data.value !== 'object') return null;
    return result.data.value as Record<string, unknown>;
  }

  async function loadRecord(): Promise<JobberOAuthRecord | null> {
    const value = await readRow();
    if (!value) return null;
    return recordFromStoredJobberValue(value, env);
  }

  async function tryClaim(claim: JobberRefreshClaim): Promise<{
    acquired: boolean;
    record: JobberOAuthRecord | null;
  }> {
    const client = await getClient();
    const rpc = await client.rpc('jobber_oauth_claim', {
      p_owner: claim.owner,
      p_expected_generation: claim.expectedGeneration,
      p_expected_fingerprint: claim.expectedFingerprint,
      p_now_ms: claim.nowMs,
      p_lease_until: padLeaseMillis(claim.leaseUntilMs),
    });
    if (!rpc.error) {
      const body = (rpc.data ?? {}) as { acquired?: boolean; value?: unknown };
      if (!body.acquired) {
        const latest = await loadRecord();
        return { acquired: false, record: latest };
      }
      const record = body.value ? recordFromStoredJobberValue(body.value, env) : await loadRecord();
      if (record?.leaseOwner && record.leaseOwner !== claim.owner) {
        return { acquired: false, record };
      }
      return { acquired: true, record };
    }
    if (!isMissingJobberLockRpc(rpc.error)) {
      throw asDurableLoadError(rpc.error);
    }
    return claimWithRowCompareAndSwap(claim);
  }

  async function claimWithRowCompareAndSwap(claim: JobberRefreshClaim): Promise<{
    acquired: boolean;
    record: JobberOAuthRecord | null;
  }> {
    const currentValue = await readRow();
    const current = currentValue ? recordFromStoredJobberValue(currentValue, env) : null;
    if (!canClaimJobberRefresh(current, claim)) {
      return { acquired: false, record: current };
    }

    const client = await getClient();
    if (!currentValue) {
      const placeholder = {
        bootstrap: true,
        generation: 0,
        leaseOwner: claim.owner,
        leaseUntil: padLeaseMillis(claim.leaseUntilMs),
        seededFrom: null,
        expiresAt: null,
      };
      const inserted = await client
        .from('settings')
        .insert({
          key: JOBBER_OAUTH_SETTINGS_KEY,
          value: placeholder,
          updated_at: new Date(claim.nowMs).toISOString(),
        })
        .select('value')
        .maybeSingle();
      if (inserted.error) {
        if ((inserted.error.code ?? '') === '23505') {
          return { acquired: false, record: await loadRecord() };
        }
        throw asDurableLoadError(inserted.error);
      }
      return {
        acquired: true,
        record: recordFromStoredJobberValue(placeholder, env),
      };
    }

    const nextValue: Record<string, unknown> = {
      ...currentValue,
      generation: current?.generation ?? 0,
      leaseOwner: claim.owner,
      leaseUntil: padLeaseMillis(claim.leaseUntilMs),
    };
    let update = client
      .from('settings')
      .update({
        value: nextValue,
        updated_at: new Date(claim.nowMs).toISOString(),
      })
      .eq('key', JOBBER_OAUTH_SETTINGS_KEY);

    update = generationIsStored(currentValue)
      ? update.eq('value->>generation', String(current?.generation ?? 0))
      : update.is('value->>generation', null);

    update =
      current?.refreshFingerprint
        ? update.eq('value->>refreshFingerprint', current.refreshFingerprint)
        : update.is('value->>refreshFingerprint', null);

    const nowPad = padLeaseMillis(claim.nowMs);
    const { data, error } = await update
      .or(
        `value->>leaseUntil.is.null,value->>leaseUntil.lt.${nowPad},value->>leaseOwner.eq.${claim.owner}`
      )
      .select('value')
      .maybeSingle();
    if (error) {
      if ((error as SettingsError)?.code === 'PGRST116') {
        return { acquired: false, record: await loadRecord() };
      }
      throw asDurableLoadError(error);
    }
    if (!data?.value) return { acquired: false, record: await loadRecord() };
    const record = recordFromStoredJobberValue(data.value, env);
    if (record.leaseOwner !== claim.owner) return { acquired: false, record };
    return { acquired: true, record };
  }

  async function commit(commitClaim: JobberRefreshCommit): Promise<JobberCommitResult> {
    const client = await getClient();
    const nextValue = buildCommittedJobberValue(commitClaim.tokens, commitClaim, env);
    const rpc = await client.rpc('jobber_oauth_commit', {
      p_owner: commitClaim.owner,
      p_expected_generation: commitClaim.expectedGeneration,
      p_expected_fingerprint: commitClaim.expectedFingerprint,
      p_value: nextValue,
    });
    if (!rpc.error) {
      const body = (rpc.data ?? {}) as { committed?: boolean; value?: unknown };
      if (!body.committed) {
        const latest = body.value
          ? recordFromStoredJobberValue(body.value, env)
          : await loadRecord();
        return { committed: false, record: latest };
      }
      return { committed: true, record: recordFromStoredJobberValue(nextValue, env) };
    }
    if (!isMissingJobberLockRpc(rpc.error)) {
      throw new Error(JOBBER_DURABLE_TOKEN_PERSIST_FAILED);
    }

    let update = client
      .from('settings')
      .update({
        value: nextValue,
        updated_at: new Date().toISOString(),
      })
      .eq('key', JOBBER_OAUTH_SETTINGS_KEY)
      .eq('value->>leaseOwner', commitClaim.owner)
      .eq('value->>generation', String(commitClaim.expectedGeneration));
    update =
      commitClaim.expectedFingerprint
        ? update.eq('value->>refreshFingerprint', commitClaim.expectedFingerprint)
        : update.is('value->>refreshFingerprint', null);
    const { data, error } = await update.select('value').maybeSingle();
    if (error || !data?.value) {
      if (error && !isMissingSettingsRelationError(error) && (error as SettingsError)?.code !== 'PGRST116') {
        throw new Error(JOBBER_DURABLE_TOKEN_PERSIST_FAILED);
      }
      return { committed: false, record: await loadRecord().catch(() => null) };
    }
    return { committed: true, record: recordFromStoredJobberValue(data.value, env) };
  }

  async function release(owner: string): Promise<void> {
    const client = await getClient();
    const rpc = await client.rpc('jobber_oauth_release', { p_owner: owner });
    if (!rpc.error || isMissingJobberLockRpc(rpc.error)) {
      if (!rpc.error) return;
      const current = await readRow().catch(() => null);
      if (!current || current.leaseOwner !== owner) return;
      const next = { ...current };
      delete next.leaseOwner;
      delete next.leaseUntil;
      await client
        .from('settings')
        .update({ value: next, updated_at: new Date().toISOString() })
        .eq('key', JOBBER_OAUTH_SETTINGS_KEY)
        .eq('value->>leaseOwner', owner);
      return;
    }
  }

  async function save(tokens: JobberTokenSet): Promise<void> {
    const owner = newJobberRefreshOwner();
    const nowMs = Date.now();
    const current = await loadRecord();
    const claim: JobberRefreshClaim = {
      owner,
      expectedGeneration: current?.generation ?? 0,
      expectedFingerprint: current?.refreshFingerprint ?? null,
      nowMs,
      leaseUntilMs: nowMs + 20_000,
    };
    const claimed = await tryClaim(claim);
    if (!claimed.acquired || !claimed.record) {
      throw new Error(JOBBER_DURABLE_TOKEN_PERSIST_FAILED);
    }
    const committed = await commit({
      owner,
      expectedGeneration: claimed.record.generation,
      expectedFingerprint: claimed.record.refreshFingerprint,
      tokens,
      seededFrom: current?.tokens ? 'durable' : 'env_bootstrap',
    });
    if (!committed.committed) throw new Error(JOBBER_DURABLE_TOKEN_PERSIST_FAILED);
  }

  return {
    async load() {
      const record = await loadRecord();
      return record?.tokens ?? null;
    },
    save,
    loadRecord,
    tryClaim,
    commit,
    release,
  };
}

export function resolveJobberDurableStore(
  deps: JobberTokenStoreDeps = {}
): JobberDurableTokenStore | null {
  if (deps.durableStore === null) return null;
  if (deps.durableStore) return deps.durableStore;
  return createSupabaseJobberTokenStore(deps.env ?? process.env);
}

export function assertJobberDurableStoreConfigured(deps: JobberTokenStoreDeps = {}): void {
  if (deps.durableStore === null || deps.durableStore) return;
  const env = deps.env ?? process.env;
  if (!isJobberProductionRuntime(env)) return;
  if (!hasDedicatedJobberTokenEncryptionKey(env)) {
    console.error(`[jobber-auth] ${JOBBER_ENCRYPTION_KEY_REQUIRED}`);
    throw new Error(JOBBER_ENCRYPTION_KEY_REQUIRED);
  }
  if (!createSupabaseJobberTokenStore(env)) {
    console.error(`[jobber-auth] ${JOBBER_DURABLE_STORE_NOT_CONFIGURED}`);
    throw new Error(JOBBER_DURABLE_STORE_NOT_CONFIGURED);
  }
}

/**
 * Durable read. A configured store that fails throws JobberDurableLoadError.
 * Callers must not treat that as an empty row and refresh env tokens.
 * Null means the store is not configured, or the row is genuinely absent.
 */
export async function loadDurableJobberTokens(
  deps: JobberTokenStoreDeps = {}
): Promise<JobberTokenSet | null> {
  const store = resolveJobberDurableStore(deps);
  if (!store) return null;
  try {
    return await store.load();
  } catch (error) {
    const loadError = asDurableLoadError(error);
    console.error(`[jobber-auth] durable token load failed reason=${loadError.reason}`);
    throw loadError;
  }
}

/**
 * Await the upsert so a serverless isolate does not freeze mid-write.
 * Production persist failures throw (generic, no secrets) so a rotated
 * refresh token is never returned without a durable write.
 */
export async function persistJobberTokensDurable(
  tokens: JobberTokenSet,
  deps: JobberTokenStoreDeps = {}
): Promise<void> {
  const env = deps.env ?? process.env;
  const store = resolveJobberDurableStore(deps);
  if (!store) {
    if (deps.durableStore === null) return;
    if (isJobberProductionRuntime(env)) {
      assertJobberDurableStoreConfigured(deps);
    }
    console.error(
      '[jobber-auth] durable token store is not configured; rotated refresh will not survive a cold start'
    );
    return;
  }
  try {
    await store.save(tokens);
  } catch {
    console.error('[jobber-auth] durable token persist failed');
    throw new Error(JOBBER_DURABLE_TOKEN_PERSIST_FAILED);
  }
}

async function probeSupabaseJobberOauth(env: NodeJS.ProcessEnv): Promise<{
  reachable: boolean;
  storedRow: boolean | null;
  settingsTable: JobberSettingsTableState;
  lockReady: boolean | null;
  loadError: string | null;
  expiresAt: string | null;
  hasCiphertext: boolean | null;
  seededFrom: JobberAuthSource | null;
}> {
  const empty = {
    reachable: false,
    storedRow: null,
    settingsTable: 'unknown' as JobberSettingsTableState,
    lockReady: null,
    loadError: null,
    expiresAt: null,
    hasCiphertext: null,
    seededFrom: null,
  };
  const url = supabaseUrl(env);
  const serviceKey = supabaseServiceKey(env);
  if (!url || !serviceKey) return empty;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    const status = await client.rpc('jobber_oauth_lock_status');
    if (!status.error && status.data && typeof status.data === 'object') {
      const body = status.data as {
        stored_row?: boolean;
        expires_at?: string | null;
        seeded_from?: string | null;
        has_ciphertext?: boolean;
      };
      const seededFrom =
        body.seeded_from === 'durable' || body.seeded_from === 'env_bootstrap'
          ? body.seeded_from
          : null;
      return {
        reachable: true,
        storedRow: Boolean(body.stored_row),
        settingsTable: 'present',
        lockReady: true,
        loadError: null,
        expiresAt: typeof body.expires_at === 'string' ? body.expires_at : null,
        hasCiphertext: Boolean(body.has_ciphertext),
        seededFrom,
      };
    }

    const lockMissing = isMissingJobberLockRpc(status.error);
    const { data, error } = await client
      .from('settings')
      .select('key')
      .eq('key', JOBBER_OAUTH_SETTINGS_KEY)
      .maybeSingle();
    if (error) {
      if (isMissingSettingsRelationError(error)) {
        return {
          ...empty,
          reachable: true,
          storedRow: null,
          settingsTable: 'missing',
          lockReady: false,
          loadError: JOBBER_SETTINGS_TABLE_MISSING,
        };
      }
      return {
        ...empty,
        reachable: false,
        settingsTable: 'unknown',
        lockReady: lockMissing ? false : null,
        loadError: JOBBER_DURABLE_TOKEN_LOAD_FAILED,
      };
    }
    return {
      reachable: true,
      storedRow: Boolean(data?.key),
      settingsTable: 'present',
      lockReady: lockMissing ? false : null,
      loadError: null,
      expiresAt: null,
      hasCiphertext: null,
      seededFrom: null,
    };
  } catch {
    return empty;
  }
}

export function getJobberDurableStoreConfig(
  env: NodeJS.ProcessEnv = process.env
): Pick<
  JobberDurableStoreDiagnosis,
  'ready' | 'encryptionKeyConfigured' | 'encryptionKeySource' | 'supabaseConfigured'
> {
  const encryptionKeyConfigured = hasDedicatedJobberTokenEncryptionKey(env);
  return {
    ready: encryptionKeyConfigured && Boolean(supabaseUrl(env) && supabaseServiceKey(env)),
    encryptionKeyConfigured,
    encryptionKeySource: jobberEncryptionKeySource(env),
    supabaseConfigured: Boolean(supabaseUrl(env) && supabaseServiceKey(env)),
  };
}

function diagnosisAuthMode(
  hasStoredTokens: boolean | null,
  envBootstrap: boolean
): JobberDurableStoreDiagnosis['authMode'] {
  if (hasStoredTokens) return 'durable';
  if (envBootstrap) return 'env_bootstrap';
  return 'unconfigured';
}

/**
 * Secret-free diagnostic: key present, Supabase reachable, whether the
 * settings table and single-writer lock are present, and token expiry.
 * Never includes token or key values.
 */
export async function diagnoseJobberDurableStore(
  deps: JobberTokenStoreDeps = {}
): Promise<JobberDurableStoreDiagnosis> {
  const env = deps.env ?? process.env;
  const config = getJobberDurableStoreConfig(env);
  const envBootstrap = Boolean(trimEnv(env, 'JOBBER_REFRESH_TOKEN'));

  let reachable: boolean | null = null;
  let storedRow: boolean | null = null;
  let hasStoredTokens: boolean | null = null;
  let settingsTable: JobberSettingsTableState = 'unknown';
  let lockReady: boolean | null = null;
  let loadError: string | null = null;
  let expiresAt: string | null = null;

  if (deps.durableStore) {
    try {
      const tokens = await deps.durableStore.load();
      hasStoredTokens = Boolean(tokens);
      storedRow = hasStoredTokens;
      reachable = true;
      settingsTable = 'present';
      lockReady = true;
      expiresAt =
        tokens && Number.isFinite(tokens.expiresAtMs)
          ? new Date(tokens.expiresAtMs).toISOString()
          : null;
    } catch (error) {
      const parsed = asDurableLoadError(error);
      hasStoredTokens = null;
      reachable = parsed.reason === 'missing_table' ? true : false;
      settingsTable = parsed.reason === 'missing_table' ? 'missing' : 'unknown';
      lockReady = false;
      loadError = parsed.message;
    }
  } else if (config.supabaseConfigured) {
    const probe = await probeSupabaseJobberOauth(env);
    reachable = probe.reachable;
    storedRow = probe.storedRow;
    settingsTable = probe.settingsTable;
    lockReady = probe.lockReady;
    loadError = probe.loadError;
    expiresAt = probe.expiresAt;
    if (probe.hasCiphertext != null) {
      hasStoredTokens = probe.hasCiphertext;
    } else if (probe.reachable && probe.settingsTable === 'present') {
      const store = resolveJobberDurableStore(deps);
      if (store) {
        try {
          const tokens = await store.load();
          hasStoredTokens = Boolean(tokens);
          if (tokens) expiresAt = new Date(tokens.expiresAtMs).toISOString();
        } catch (error) {
          const parsed = asDurableLoadError(error);
          hasStoredTokens = null;
          loadError = parsed.message;
          if (parsed.reason === 'missing_table') settingsTable = 'missing';
        }
      }
    }
  }

  const source: JobberDurableStoreDiagnosis['source'] = hasStoredTokens
    ? 'supabase'
    : envBootstrap
      ? 'env_bootstrap'
      : 'unconfigured';

  return {
    ...config,
    reachable,
    storedRow,
    hasStoredTokens,
    source,
    authMode: diagnosisAuthMode(hasStoredTokens, envBootstrap),
    expiresAt,
    settingsTable,
    lockReady,
    loadError,
  };
}
