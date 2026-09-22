import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { refreshLockedJobberTokens, resetJobberAuthCache } from './auth.ts';
import {
  canClaimJobberRefresh,
  canCommitJobberRefresh,
  createMemoryCasJobberTokenStore,
  fingerprintRefreshToken,
  type JobberOAuthRecord,
} from './token-lock.ts';

const NOW_MS = Date.parse('2026-09-22T20:00:00.000Z');

function record(partial: Partial<JobberOAuthRecord> = {}): JobberOAuthRecord {
  return {
    tokens: {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAtMs: NOW_MS - 1000,
    },
    generation: 2,
    refreshFingerprint: fingerprintRefreshToken('refresh-1'),
    leaseOwner: null,
    leaseUntilMs: null,
    seededFrom: 'durable',
    ...partial,
  };
}

describe('Jobber refresh compare-and-swap', () => {
  it('fingerprints the refresh token without echoing it', () => {
    const fingerprint = fingerprintRefreshToken('refresh-1');
    assert.equal(fingerprint.includes('refresh-1'), false);
    assert.equal(fingerprint, fingerprintRefreshToken('refresh-1'));
    assert.notEqual(fingerprint, fingerprintRefreshToken('refresh-2'));
  });

  it('lets only one owner claim a generation and rejects a stale commit', async () => {
    const store = createMemoryCasJobberTokenStore(record());
    const claim = {
      expectedGeneration: 2,
      expectedFingerprint: fingerprintRefreshToken('refresh-1'),
      nowMs: NOW_MS,
      leaseUntilMs: NOW_MS + 20_000,
    };
    const first = await store.tryClaim({ ...claim, owner: 'owner-a' });
    const second = await store.tryClaim({ ...claim, owner: 'owner-b' });
    assert.equal(first.acquired, true);
    assert.equal(second.acquired, false);
    assert.equal(canClaimJobberRefresh(first.record, { ...claim, owner: 'owner-b' }), false);

    const stale = await store.commit({
      owner: 'owner-b',
      expectedGeneration: 2,
      expectedFingerprint: fingerprintRefreshToken('refresh-1'),
      tokens: {
        accessToken: 'access-stale',
        refreshToken: 'refresh-stale',
        expiresAtMs: NOW_MS + 3600_000,
      },
      seededFrom: 'durable',
    });
    assert.equal(stale.committed, false);
    assert.equal(
      canCommitJobberRefresh(first.record, {
        owner: 'owner-b',
        expectedGeneration: 2,
        expectedFingerprint: fingerprintRefreshToken('refresh-1'),
      }),
      false
    );

    const winner = await store.commit({
      owner: 'owner-a',
      expectedGeneration: 2,
      expectedFingerprint: fingerprintRefreshToken('refresh-1'),
      tokens: {
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        expiresAtMs: NOW_MS + 3600_000,
      },
      seededFrom: 'durable',
    });
    assert.equal(winner.committed, true);
    assert.equal(winner.record?.generation, 3);
    assert.equal(winner.record?.refreshFingerprint, fingerprintRefreshToken('refresh-2'));
    assert.equal(store.snapshot()?.tokens?.refreshToken, 'refresh-2');
  });

  it('two cold starts exchange the refresh token once', async () => {
    resetJobberAuthCache();
    const initial = record();
    const store = createMemoryCasJobberTokenStore(initial);
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return new Response(
        JSON.stringify({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const env = {
      JOBBER_ACCESS_TOKEN: 'stale-env-access',
      JOBBER_REFRESH_TOKEN: 'stale-env-refresh',
      JOBBER_CLIENT_ID: 'client-id',
      JOBBER_CLIENT_SECRET: 'client-secret',
    } as NodeJS.ProcessEnv;

    const [first, second] = await Promise.all([
      refreshLockedJobberTokens({ env, fetchImpl, nowMs: NOW_MS, durableStore: store }),
      refreshLockedJobberTokens({ env, fetchImpl, nowMs: NOW_MS, durableStore: store }),
    ]);

    assert.equal(calls, 1);
    assert.equal(first.accessToken, 'access-2');
    assert.equal(second.accessToken, 'access-2');
    assert.equal(second.refreshToken, 'refresh-2');
    assert.equal(store.snapshot()?.tokens?.refreshToken, 'refresh-2');
    assert.equal(store.snapshot()?.generation, 3);
    resetJobberAuthCache();
  });
});

describe('jobber oauth single-writer SQL', () => {
  it('ships an idempotent settings migration with an advisory lock and RLS hide', () => {
    const sql = readFileSync(
      new URL('../../../supabase/migrations/20260922_jobber_oauth_single_writer.sql', import.meta.url),
      'utf8'
    );
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.settings/);
    assert.match(sql, /key <> 'jobber_oauth'/);
    assert.match(sql, /pg_advisory_xact_lock/);
    assert.match(sql, /jobber_oauth_claim/);
    assert.match(sql, /jobber_oauth_commit/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.jobber_oauth_claim/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.jobber_oauth_commit\(text, integer, text, jsonb\) TO service_role/);
    assert.equal(sql.includes('access_token'), false);
    assert.equal(sql.includes('refresh_token'), false);
  });
});
