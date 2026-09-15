/**
 * Durable Jobber OAuth token store.
 *
 * Jobber rotates refresh tokens. Memory + process.env do not survive a
 * cold lambda, so the next isolate would replay the stale Vercel
 * JOBBER_REFRESH_TOKEN and get HTTP 401.
 *
 * Tokens are stored in the existing Supabase `settings` row keyed
 * `jobber_oauth`, encrypted with AES-256-GCM. Never log token values.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { JobberTokenSet } from './auth.ts';

export const JOBBER_OAUTH_SETTINGS_KEY = 'jobber_oauth';

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

function trimEnv(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value || null;
}

export function isJobberSecretSettingsKey(key: string | null | undefined): boolean {
  return key === JOBBER_OAUTH_SETTINGS_KEY;
}

export function jobberTokenEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const material =
    trimEnv(env, 'JOBBER_TOKEN_ENCRYPTION_KEY') || trimEnv(env, 'JOBBER_CLIENT_SECRET');
  if (!material) return null;
  return createHash('sha256').update(material).digest();
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

  const key = jobberTokenEncryptionKey(env);
  if (!key) return null;

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

export function createSupabaseJobberTokenStore(
  env: NodeJS.ProcessEnv = process.env
): JobberDurableTokenStore | null {
  const url = trimEnv(env, 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey =
    trimEnv(env, 'SUPABASE_SERVICE_KEY') || trimEnv(env, 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url || url === 'your-supabase-url' || !serviceKey) return null;
  if (!jobberTokenEncryptionKey(env)) return null;

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
      if (error || !data?.value) return null;
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
        throw new Error('Jobber durable token persist failed');
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

export async function loadDurableJobberTokens(
  deps: JobberTokenStoreDeps = {}
): Promise<JobberTokenSet | null> {
  const store = resolveJobberDurableStore(deps);
  if (!store) return null;
  try {
    return await store.load();
  } catch {
    console.error('[jobber-auth] durable token load failed');
    return null;
  }
}

/**
 * Await the upsert so a serverless isolate does not freeze mid-write.
 * Failures never throw to the request — they only log a generic line.
 */
export async function persistJobberTokensDurable(
  tokens: JobberTokenSet,
  deps: JobberTokenStoreDeps = {}
): Promise<void> {
  const store = resolveJobberDurableStore(deps);
  if (!store) return;
  try {
    await store.save(tokens);
  } catch {
    console.error('[jobber-auth] durable token persist failed');
  }
}
