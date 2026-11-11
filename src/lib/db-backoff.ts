/**
 * Shared backoff for database reads.
 *
 * A stalled Supabase instance used to get every open dashboard tab and every
 * server isolate retrying full-table reads with no delay. Healthy call polling
 * stays on its normal interval. Failures stretch the wait, and after a few
 * failures the server circuit stops issuing the read until the window passes.
 */

export const CALL_POLL_MS = 30_000;
export const TV_POLL_MS = 60_000;
/** Jobber sales / metrics panels. The mirror itself refreshes hourly. */
export const JOBBER_POLL_MS = 5 * 60_000;
/** In-process cache for Jobber mirror reads. Data changes on the hourly sync. */
export const MIRROR_READ_TTL_MS = 10 * 60_000;

export const DB_BREAKER_THRESHOLD = 3;
export const DB_BREAKER_BASE_MS = 15_000;
export const DB_BREAKER_CAP_MS = 120_000;

export type BreakerState = {
  failures: number;
  openUntil: number;
};

export function initialBreaker(): BreakerState {
  return { failures: 0, openUntil: 0 };
}

/** Delay after `failures` consecutive errors. `failures <= 0` waits nothing. */
export function backoffDelayMs(failures: number, base = DB_BREAKER_BASE_MS, cap = DB_BREAKER_CAP_MS): number {
  if (failures <= 0) return 0;
  const shift = Math.min(failures - 1, 6);
  return Math.min(cap, base * 2 ** shift);
}

/**
 * Client poll wait. Zero failures keeps the healthy interval (call views stay
 * at 30s). Each failure doubles it, capped so a dead database is not polled
 * in a tight loop.
 */
export function pollDelayMs(failures: number, successMs: number, cap = 5 * 60_000): number {
  if (failures <= 0) return successMs;
  const shift = Math.min(failures, 4);
  return Math.min(cap, successMs * 2 ** shift);
}

export function breakerOpen(state: BreakerState, now: number): boolean {
  return state.openUntil > now;
}

export function noteSuccess(): BreakerState {
  return initialBreaker();
}

export function noteFailure(
  state: BreakerState,
  now: number,
  threshold = DB_BREAKER_THRESHOLD,
  base = DB_BREAKER_BASE_MS,
  cap = DB_BREAKER_CAP_MS,
): BreakerState {
  const failures = state.failures + 1;
  if (failures < threshold) return { failures, openUntil: 0 };
  return { failures, openUntil: now + backoffDelayMs(failures, base, cap) };
}

export type GuardedResult<T> = { ok: boolean; value: T };

/**
 * One slot per key: fresh values skip the loader, in-flight calls share one
 * promise, and an open circuit returns the last good value or `stale`.
 */
export function createGuardedCache<T>(options: {
  ttlMs: number;
  threshold?: number;
  baseMs?: number;
  capMs?: number;
}) {
  const slots = new Map<string, { at: number; value: T }>();
  const states = new Map<string, BreakerState>();
  const flights = new Map<string, Promise<T>>();
  const threshold = options.threshold ?? DB_BREAKER_THRESHOLD;
  const base = options.baseMs ?? DB_BREAKER_BASE_MS;
  const cap = options.capMs ?? DB_BREAKER_CAP_MS;

  return {
    async read(key: string, loader: () => Promise<GuardedResult<T>>, stale: T, now = Date.now()): Promise<T> {
      const hit = slots.get(key);
      if (hit && now - hit.at < options.ttlMs) return hit.value;
      const existing = flights.get(key);
      if (existing) return existing;
      const state = states.get(key) ?? initialBreaker();
      if (breakerOpen(state, now)) return hit?.value ?? stale;
      const run = (async () => {
        try {
          const result = await loader();
          if (!result.ok) {
            states.set(key, noteFailure(state, now, threshold, base, cap));
            return hit?.value ?? result.value;
          }
          states.set(key, noteSuccess());
          slots.set(key, { at: now, value: result.value });
          return result.value;
        } catch (error) {
          states.set(key, noteFailure(state, now, threshold, base, cap));
          if (hit) return hit.value;
          throw error;
        } finally {
          flights.delete(key);
        }
      })();
      flights.set(key, run);
      return run;
    },
  };
}
