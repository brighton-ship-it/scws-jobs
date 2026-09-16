/**
 * Durable Jobber OAuth token store.
 *
 * Jobber rotates refresh tokens. Memory + process.env do not survive a
 * cold lambda, so the next isolate would replay the stale Vercel
 * JOBBER_REFRESH_TOKEN and get HTTP 401.
 *
 * Tokens are stored in the existing Supabase `settings` row keyed
 * `jobber_oauth`, encrypted with AES-256-GCM. Production requires
 * JOBBER_TOKEN_ENCRYPTION_KEY — missing key is a loud config error,
 * not a silent env-only fallback. Never log token values.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { JobberTokenSet } from './auth.ts';

export const JOBBER_OAUTH_SETTINGS_KEY = 'jobber_oauth';
export const JOBBER_TOKEN_ENCRYPTION_KEY_ENV = 'JOBBER_TOKEN_ENCRYPTION_KEY';

export const JOBBER_ENCRYPTION_KEY_REQUIRED =
  'JOBBER_TOKEN_ENCRYPTION_KEY is not set in Production. Generate one with: openssl rand -hex 32. Set it on Vercel project scws-jobs (Production) and redeploy. Do not commit the value.';

export const JOBBER_DURABLE_STORE_NOT_CONFIGURED =
  'Jobber durable token store is not configured in Production (need JOBBER_TOKEN_ENCRYPTION_KEY, NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SERVICE_KEY)';

export const JOBBER_DURABLE_TOKEN_LOAD_FAILED = 'Jobber durable token load failed';
export const JOBBER_DURABLE_TOKEN_PERSIST_FAILED = 'Jobber durable token persist failed';

export type JobberDurableTokenStore = {
  load(): Promise<JobberTokenSet | null>;
  save(tokens: JobberTokenSet): Promise<void>;
};

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

export type JobberDurableStoreDiagnosis = {
  ready: boolean;
  encryptionKeyConfigured: boolean;
  encryptionKeySource: JobberEncryptionKeySource;
  supabaseConfigured: boolean;
  reachable: boolean | null;
  storedRow: boolean | null;
  hasStoredTokens: boolean | null;
  source: 'supabase' | 'env_bootstrap' | 'unconfigured';
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

export function createSupabaseJobberTokenStore(
  env: NodeJS.ProcessEnv = process.env
): JobberDurableTokenStore | null {
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

  return {
    async load() {
      const client = await getClient();
      const { data, error } = await client
        .from('settings')
        .select('value')
        .eq('key', JOBBER_OAUTH_SETTINGS_KEY)
        .maybeSingle();
      if (error) {
        throw new Error(JOBBER_DURABLE_TOKEN_LOAD_FAILED);
      }
      if (!data?.value) return null;
      return decryptJobberTokenEnvelope(data.value, env);
    },
    async save(tokens) {
      const client = await getClient();
      const value = encryptJobberTokenEnvelope(tokens, env);
      const { error } = await client.from('settings').upsert(
        {
          key: JOBBER_OAUTH_SETTINGS_KEY,
          value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
      if (error) {
        throw new Error(JOBBER_DURABLE_TOKEN_PERSIST_FAILED);
      }
    },
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

export async function loadDurableJobberTokens(
  deps: JobberTokenStoreDeps = {}
): Promise<JobberTokenSet | null> {
  const env = deps.env ?? process.env;
  const store = resolveJobberDurableStore(deps);
  if (!store) return null;
  try {
    return await store.load();
  } catch {
    console.error('[jobber-auth] durable token load failed');
    if (isJobberProductionRuntime(env) && deps.durableStore !== null) {
      throw new Error(JOBBER_DURABLE_TOKEN_LOAD_FAILED);
    }
    return null;
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
}> {
  const url = supabaseUrl(env);
  const serviceKey = supabaseServiceKey(env);
  if (!url || !serviceKey) {
    return { reachable: false, storedRow: null };
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    const { data, error } = await client
      .from('settings')
      .select('key')
      .eq('key', JOBBER_OAUTH_SETTINGS_KEY)
      .maybeSingle();
    if (error) return { reachable: false, storedRow: null };
    return { reachable: true, storedRow: Boolean(data?.key) };
  } catch {
    return { reachable: false, storedRow: null };
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

/**
 * Secret-free diagnostic: key present, Supabase reachable, encrypted row
 * decryptable. Never includes token or key values.
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

  if (deps.durableStore) {
    try {
      const tokens = await deps.durableStore.load();
      hasStoredTokens = Boolean(tokens);
      storedRow = hasStoredTokens;
      reachable = true;
    } catch {
      hasStoredTokens = false;
      reachable = false;
    }
  } else if (config.supabaseConfigured) {
    const probe = await probeSupabaseJobberOauth(env);
    reachable = probe.reachable;
    storedRow = probe.storedRow;
    if (probe.reachable) {
      const store = resolveJobberDurableStore(deps);
      if (store) {
        try {
          hasStoredTokens = Boolean(await store.load());
        } catch {
          hasStoredTokens = false;
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
  };
}
