import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { persistJobberTokens, resetJobberAuthCache, type JobberTokenSet } from './auth.ts';
import {
  JOBBER_DURABLE_STORE_NOT_CONFIGURED,
  JOBBER_DURABLE_TOKEN_LOAD_FAILED,
  JOBBER_DURABLE_TOKEN_PERSIST_FAILED,
  JOBBER_ENCRYPTION_KEY_REQUIRED,
  JOBBER_OAUTH_SETTINGS_KEY,
  JOBBER_TOKEN_ENCRYPTION_KEY_ENV,
  assertJobberDurableStoreConfigured,
  createSupabaseJobberTokenStore,
  decryptJobberTokenEnvelope,
  diagnoseJobberDurableStore,
  encryptJobberTokenEnvelope,
  getJobberDurableStoreConfig,
  isJobberSecretSettingsKey,
  isMissingSettingsRelationError,
  loadDurableJobberTokens,
  persistJobberTokensDurable,
  tokensFromSettingsLoadResult,
} from './token-store.ts';

const NOW_MS = Date.parse('2026-09-15T16:00:00.000Z');

const SAMPLE_TOKENS: JobberTokenSet = {
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  expiresAtMs: NOW_MS + 3600 * 1000,
};

const ENCRYPT_ENV = {
  JOBBER_CLIENT_SECRET: 'client-secret',
} as NodeJS.ProcessEnv;

afterEach(() => {
  resetJobberAuthCache();
});

describe('jobber_oauth settings key', () => {
  it('is the dedicated settings row and is treated as secret', () => {
    assert.equal(JOBBER_OAUTH_SETTINGS_KEY, 'jobber_oauth');
    assert.equal(isJobberSecretSettingsKey('jobber_oauth'), true);
    assert.equal(isJobberSecretSettingsKey('company'), false);
  });
});

describe('encryptJobberTokenEnvelope', () => {
  it('round-trips tokens without leaving plaintext in the envelope', () => {
    const envelope = encryptJobberTokenEnvelope(SAMPLE_TOKENS, ENCRYPT_ENV);
    assert.equal(envelope.v, 1);
    assert.equal(envelope.alg, 'aes-256-gcm');
    assert.equal(JSON.stringify(envelope).includes('access-2'), false);
    assert.equal(JSON.stringify(envelope).includes('refresh-2'), false);

    const decoded = decryptJobberTokenEnvelope(envelope, ENCRYPT_ENV);
    assert.deepEqual(decoded, SAMPLE_TOKENS);
  });

  it('prefers JOBBER_TOKEN_ENCRYPTION_KEY and can still read a client-secret envelope', () => {
    const legacy = encryptJobberTokenEnvelope(SAMPLE_TOKENS, ENCRYPT_ENV);
    const decoded = decryptJobberTokenEnvelope(legacy, {
      JOBBER_TOKEN_ENCRYPTION_KEY: 'dedicated-key',
      JOBBER_CLIENT_SECRET: 'client-secret',
    });
    assert.deepEqual(decoded, SAMPLE_TOKENS);

    const next = encryptJobberTokenEnvelope(SAMPLE_TOKENS, {
      JOBBER_TOKEN_ENCRYPTION_KEY: 'dedicated-key',
      JOBBER_CLIENT_SECRET: 'client-secret',
    });
    assert.deepEqual(
      decryptJobberTokenEnvelope(next, { JOBBER_TOKEN_ENCRYPTION_KEY: 'dedicated-key' }),
      SAMPLE_TOKENS
    );
    assert.equal(
      decryptJobberTokenEnvelope(next, { JOBBER_CLIENT_SECRET: 'client-secret' }),
      null
    );
  });

  it('returns null for a different encryption key and never throws the ciphertext', () => {
    const envelope = encryptJobberTokenEnvelope(SAMPLE_TOKENS, ENCRYPT_ENV);
    const decoded = decryptJobberTokenEnvelope(envelope, {
      JOBBER_CLIENT_SECRET: 'other-secret',
    });
    assert.equal(decoded, null);
  });
});

describe('persistJobberTokens + durable store', () => {
  it('writes memory/env immediately and the durable store after refresh persist', async () => {
    const env = {
      JOBBER_ACCESS_TOKEN: 'stale-access',
      JOBBER_REFRESH_TOKEN: 'refresh-1',
    } as NodeJS.ProcessEnv;
    let saved: JobberTokenSet | null = null;

    persistJobberTokens(SAMPLE_TOKENS, env);
    assert.equal(env.JOBBER_ACCESS_TOKEN, 'access-2');
    assert.equal(env.JOBBER_REFRESH_TOKEN, 'refresh-2');

    await persistJobberTokensDurable(SAMPLE_TOKENS, {
      env,
      durableStore: {
        async load() {
          return saved;
        },
        async save(tokens) {
          saved = tokens;
        },
      },
    });

    assert.deepEqual(saved, SAMPLE_TOKENS);
  });

  it('throws a generic persist error and never echoes secrets', async () => {
    await assert.rejects(
      () =>
        persistJobberTokensDurable(SAMPLE_TOKENS, {
          durableStore: {
            async load() {
              return null;
            },
            async save() {
              throw new Error('db down: refresh-2-should-not-leak');
            },
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, JOBBER_DURABLE_TOKEN_PERSIST_FAILED);
        assert.equal(error.message.includes('refresh-2'), false);
        assert.equal(error.message.includes('should-not-leak'), false);
        return true;
      }
    );
  });
});

describe('Production durable store config', () => {
  it('is not ready without JOBBER_TOKEN_ENCRYPTION_KEY even if client secret exists', () => {
    const env = {
      VERCEL_ENV: 'production',
      JOBBER_CLIENT_SECRET: 'client-secret',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'service-key',
    } as NodeJS.ProcessEnv;

    const config = getJobberDurableStoreConfig(env);
    assert.equal(config.encryptionKeyConfigured, false);
    assert.equal(config.encryptionKeySource, 'JOBBER_CLIENT_SECRET');
    assert.equal(config.supabaseConfigured, true);
    assert.equal(config.ready, false);
    assert.equal(createSupabaseJobberTokenStore(env), null);
    assert.throws(() => assertJobberDurableStoreConfigured({ env }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, JOBBER_ENCRYPTION_KEY_REQUIRED);
      return true;
    });
  });

  it('is ready when the dedicated key and Supabase service env are present', () => {
    const env = {
      VERCEL_ENV: 'production',
      JOBBER_TOKEN_ENCRYPTION_KEY: 'dedicated-key',
      JOBBER_CLIENT_SECRET: 'client-secret',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'service-key',
    } as NodeJS.ProcessEnv;

    const config = getJobberDurableStoreConfig(env);
    assert.equal(config.ready, true);
    assert.equal(config.encryptionKeyConfigured, true);
    assert.equal(config.encryptionKeySource, JOBBER_TOKEN_ENCRYPTION_KEY_ENV);
    assert.doesNotThrow(() => assertJobberDurableStoreConfigured({ env }));
  });

  it('throws a generic store error when Production has a key but no Supabase', () => {
    const env = {
      VERCEL_ENV: 'production',
      JOBBER_TOKEN_ENCRYPTION_KEY: 'dedicated-key',
    } as NodeJS.ProcessEnv;

    assert.throws(() => assertJobberDurableStoreConfigured({ env }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, JOBBER_DURABLE_STORE_NOT_CONFIGURED);
      return true;
    });
  });
});

describe('isMissingSettingsRelationError', () => {
  it('detects PostgREST missing-table / schema-not-found codes and messages', () => {
    assert.equal(
      isMissingSettingsRelationError({
        code: 'PGRST205',
        message: "Could not find the table 'public.settings' in the schema cache",
      }),
      true
    );
    assert.equal(
      isMissingSettingsRelationError({
        code: '42P01',
        message: 'relation "public.settings" does not exist',
      }),
      true
    );
    assert.equal(isMissingSettingsRelationError({ code: 'PGRST106' }), true);
    assert.equal(
      isMissingSettingsRelationError({
        message: "Could not find the table 'public.settings' in the schema cache",
      }),
      true
    );
  });

  it('does not treat auth, permission, or unrelated schema errors as missing', () => {
    assert.equal(isMissingSettingsRelationError(null), false);
    assert.equal(
      isMissingSettingsRelationError({ code: 'PGRST301', message: 'JWT expired' }),
      false
    );
    assert.equal(
      isMissingSettingsRelationError({ code: '42501', message: 'permission denied for table settings' }),
      false
    );
    assert.equal(
      isMissingSettingsRelationError({
        code: 'PGRST204',
        message: "Could not find the 'value' column of 'settings' in the schema cache",
      }),
      false
    );
    assert.equal(
      isMissingSettingsRelationError({ code: '57014', message: 'canceling statement due to statement timeout' }),
      false
    );
  });
});

describe('tokensFromSettingsLoadResult', () => {
  it('returns null when the settings relation is missing', () => {
    assert.equal(
      tokensFromSettingsLoadResult({
        error: {
          code: 'PGRST205',
          message: "Could not find the table 'public.settings' in the schema cache",
        },
      }),
      null
    );
  });

  it('returns null for an empty row and decrypts a valid envelope', () => {
    assert.equal(tokensFromSettingsLoadResult({ data: null }), null);
    assert.equal(tokensFromSettingsLoadResult({ data: { value: null } }), null);

    const envelope = encryptJobberTokenEnvelope(SAMPLE_TOKENS, ENCRYPT_ENV);
    assert.deepEqual(tokensFromSettingsLoadResult({ data: { value: envelope } }, ENCRYPT_ENV), SAMPLE_TOKENS);
  });

  it('returns null for auth/network fetch errors without echoing secrets', () => {
    assert.equal(
      tokensFromSettingsLoadResult({
        error: { code: 'PGRST301', message: 'JWT expired secret-must-not-leak' },
      }),
      null
    );
    assert.equal(
      tokensFromSettingsLoadResult({
        error: { code: '401', message: 'Invalid API key secret-must-not-leak' },
      }),
      null
    );
  });

  it('throws a generic load error for an undecryptable existing row', () => {
    const envelope = encryptJobberTokenEnvelope(SAMPLE_TOKENS, ENCRYPT_ENV);
    assert.throws(
      () =>
        tokensFromSettingsLoadResult(
          { data: { value: envelope } },
          { JOBBER_CLIENT_SECRET: 'other-secret' }
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, JOBBER_DURABLE_TOKEN_LOAD_FAILED);
        assert.equal(error.message.includes('access-2'), false);
        return true;
      }
    );
  });
});

describe('loadDurableJobberTokens', () => {
  const productionEnv = {
    VERCEL_ENV: 'production',
    JOBBER_TOKEN_ENCRYPTION_KEY: 'dedicated-key',
    JOBBER_ACCESS_TOKEN: 'stale-access',
    JOBBER_REFRESH_TOKEN: 'refresh-1',
  } as NodeJS.ProcessEnv;

  it('returns null in Production when the settings table is missing', async () => {
    const tokens = await loadDurableJobberTokens({
      env: productionEnv,
      durableStore: {
        async load() {
          throw Object.assign(
            new Error("Could not find the table 'public.settings' in the schema cache"),
            { code: 'PGRST205' }
          );
        },
        async save() {
          throw new Error('save should not run during load');
        },
      },
    });
    assert.equal(tokens, null);
  });

  it('returns null in Production on 401 / network load failures so env bootstrap can run', async () => {
    const tokens = await loadDurableJobberTokens({
      env: productionEnv,
      durableStore: {
        async load() {
          throw new Error('Invalid API key refresh-1-must-not-leak');
        },
        async save() {
          throw new Error('save should not run during load');
        },
      },
    });
    assert.equal(tokens, null);

    const network = await loadDurableJobberTokens({
      env: productionEnv,
      durableStore: {
        async load() {
          throw new Error('fetch failed');
        },
        async save() {},
      },
    });
    assert.equal(network, null);
  });

  it('still throws a generic persist error after a successful refresh rotation', async () => {
    await assert.rejects(
      () =>
        persistJobberTokensDurable(SAMPLE_TOKENS, {
          env: productionEnv,
          durableStore: {
            async load() {
              return null;
            },
            async save() {
              throw new Error('Invalid API key refresh-2-must-not-leak');
            },
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, JOBBER_DURABLE_TOKEN_PERSIST_FAILED);
        assert.equal(error.message.includes('refresh-2'), false);
        assert.equal(error.message.includes('must-not-leak'), false);
        return true;
      }
    );
  });

  it('returns stored tokens when load succeeds', async () => {
    const tokens = await loadDurableJobberTokens({
      env: productionEnv,
      durableStore: {
        async load() {
          return SAMPLE_TOKENS;
        },
        async save() {},
      },
    });
    assert.deepEqual(tokens, SAMPLE_TOKENS);
  });
});

describe('diagnoseJobberDurableStore', () => {
  it('reports missing key + supabase without leaking secrets', async () => {
    const diagnosis = await diagnoseJobberDurableStore({
      env: {
        JOBBER_CLIENT_SECRET: 'client-secret-must-not-leak',
        JOBBER_REFRESH_TOKEN: 'refresh-1-must-not-leak',
      },
    });

    assert.equal(diagnosis.ready, false);
    assert.equal(diagnosis.encryptionKeyConfigured, false);
    assert.equal(diagnosis.supabaseConfigured, false);
    assert.equal(diagnosis.reachable, null);
    assert.equal(diagnosis.hasStoredTokens, null);
    assert.equal(diagnosis.source, 'env_bootstrap');
    assert.equal(JSON.stringify(diagnosis).includes('must-not-leak'), false);
  });

  it('reports a decryptable injected store as supabase-backed', async () => {
    const diagnosis = await diagnoseJobberDurableStore({
      env: {
        JOBBER_TOKEN_ENCRYPTION_KEY: 'dedicated-key',
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_KEY: 'service-key',
      },
      durableStore: {
        async load() {
          return SAMPLE_TOKENS;
        },
        async save() {},
      },
    });

    assert.equal(diagnosis.ready, true);
    assert.equal(diagnosis.encryptionKeyConfigured, true);
    assert.equal(diagnosis.source, 'supabase');
    assert.equal(JSON.stringify(diagnosis).includes('access-2'), false);
    assert.equal(JSON.stringify(diagnosis).includes('refresh-2'), false);
    assert.equal(JSON.stringify(diagnosis).includes('dedicated-key'), false);
    assert.equal(JSON.stringify(diagnosis).includes('service-key'), false);
  });
});
