import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CALL_POLL_MS,
  DB_BREAKER_BASE_MS,
  DB_BREAKER_THRESHOLD,
  JOBBER_POLL_MS,
  TV_POLL_MS,
  backoffDelayMs,
  breakerOpen,
  createGuardedCache,
  initialBreaker,
  noteFailure,
  noteSuccess,
  pollDelayMs,
} from './db-backoff.ts';

test('healthy call polling stays fast and Jobber panels wait longer', () => {
  assert.equal(CALL_POLL_MS, 30_000);
  assert.equal(TV_POLL_MS, 60_000);
  assert.equal(JOBBER_POLL_MS, 5 * 60_000);
  assert.ok(JOBBER_POLL_MS > CALL_POLL_MS);
  assert.equal(pollDelayMs(0, CALL_POLL_MS), CALL_POLL_MS);
  assert.equal(pollDelayMs(0, TV_POLL_MS), TV_POLL_MS);
});

test('failed polls back off instead of retrying on the healthy interval', () => {
  assert.equal(pollDelayMs(1, CALL_POLL_MS), 60_000);
  assert.equal(pollDelayMs(2, CALL_POLL_MS), 120_000);
  assert.equal(pollDelayMs(3, CALL_POLL_MS), 240_000);
  assert.equal(pollDelayMs(8, CALL_POLL_MS), 5 * 60_000);
  assert.equal(pollDelayMs(-1, CALL_POLL_MS), CALL_POLL_MS);
});

test('server reads open a circuit after repeated failures and then allow one retry', () => {
  assert.equal(backoffDelayMs(0), 0);
  assert.equal(backoffDelayMs(1), DB_BREAKER_BASE_MS);
  assert.equal(backoffDelayMs(3), 60_000);
  assert.equal(backoffDelayMs(10), 120_000);

  let state = initialBreaker();
  const t0 = 1_000_000;
  state = noteFailure(state, t0);
  state = noteFailure(state, t0);
  assert.equal(state.failures, 2);
  assert.equal(breakerOpen(state, t0), false);

  state = noteFailure(state, t0);
  assert.equal(state.failures, DB_BREAKER_THRESHOLD);
  assert.equal(breakerOpen(state, t0 + 1), true);
  assert.equal(breakerOpen(state, state.openUntil), false);

  state = noteSuccess();
  assert.deepEqual(state, { failures: 0, openUntil: 0 });
  assert.equal(breakerOpen(state, t0), false);
});

test('guarded cache serves fresh data, shares no work while open, and keeps keys apart', async () => {
  const cache = createGuardedCache<{ n: number }>({ ttlMs: 10_000, threshold: 3, baseMs: 1_000, capMs: 8_000 });
  let calls = 0;
  const loader = (n: number, ok = true) => async () => {
    calls += 1;
    return { ok, value: { n } };
  };

  assert.deepEqual(await cache.read('a', loader(1), { n: -1 }, 0), { n: 1 });
  assert.deepEqual(await cache.read('a', loader(2), { n: -1 }, 5_000), { n: 1 });
  assert.equal(calls, 1);

  assert.deepEqual(await cache.read('b', loader(7), { n: -1 }, 5_000), { n: 7 });
  assert.equal(calls, 2);

  calls = 0;
  assert.deepEqual(await cache.read('a', loader(3, false), { n: -1 }, 20_000), { n: 1 });
  assert.deepEqual(await cache.read('a', loader(4, false), { n: -1 }, 20_000), { n: 1 });
  assert.deepEqual(await cache.read('a', loader(5, false), { n: -1 }, 20_000), { n: 1 });
  assert.equal(calls, 3);
  calls = 0;
  assert.deepEqual(await cache.read('a', loader(9), { n: -1 }, 20_500), { n: 1 });
  assert.equal(calls, 0);

  assert.deepEqual(await cache.read('a', loader(6), { n: -1 }, 30_000), { n: 6 });
  assert.equal(calls, 1);
});

test('a thrown read keeps the last good value and does not call through an open circuit', async () => {
  const cache = createGuardedCache<string>({ ttlMs: 1, threshold: 1, baseMs: 5_000, capMs: 5_000 });
  let calls = 0;
  const fail = async () => { calls += 1; throw new Error('down'); };
  assert.equal(await cache.read('k', async () => ({ ok: true, value: 'good' }), 'empty', 0), 'good');
  assert.equal(await cache.read('k', fail, 'empty', 10), 'good');
  assert.equal(calls, 1);
  assert.equal(await cache.read('k', fail, 'empty', 20), 'good');
  assert.equal(calls, 1);
});

test('a thrown read with nothing cached propagates', async () => {
  const cache = createGuardedCache<string>({ ttlMs: 1, threshold: 2, baseMs: 5_000, capMs: 5_000 });
  await assert.rejects(cache.read('k', async () => { throw new Error('down'); }, 'empty', 0), /down/);
});

test('read-path index migration is concurrent and left for Brighton to apply', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261111_read_path_indexes.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_phone/i);
  assert.match(sql, /ON public\.customers \(phone\)/i);
  assert.match(sql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_created/i);
  assert.match(sql, /ON public\.notifications \(user_id, created_at DESC\)/i);
  assert.doesNotMatch(sql, /\bBEGIN\b/i);
  assert.doesNotMatch(sql, /\bCOMMIT\b/i);
  const reader = readFileSync(new URL('./jobber-mirror/read.ts', import.meta.url), 'utf8');
  assert.match(reader, /export const MIRROR_STALE_MS = 3 \* 60 \* 60_000/);
});
