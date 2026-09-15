import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { persistJobberTokens, resetJobberAuthCache, type JobberTokenSet } from './auth.ts';
import {
  JOBBER_OAUTH_SETTINGS_KEY,
  decryptJobberTokenEnvelope,
  encryptJobberTokenEnvelope,
  isJobberSecretSettingsKey,
  persistJobberTokensDurable,
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

  it('does not throw or echo secrets when durable persist fails', async () => {
    await persistJobberTokensDurable(SAMPLE_TOKENS, {
      durableStore: {
        async load() {
          return null;
        },
        async save() {
          throw new Error('db down: refresh-2-should-not-leak');
        },
      },
    });
  });
});
