/**
 * Single-writer lock for Jobber refresh-token rotation.
 *
 * Jobber invalidates the previous refresh token on every successful
 * refresh. Two callers that both exchange the same refresh token, or a
 * caller that writes an older pair after a newer one, strand the account
 * on HTTP 401.
 *
 * The production store claims a short lease and compare-and-swaps the
 * generation + refresh fingerprint before anyone calls Jobber. This module
 * is the pure decision logic those stores share, plus an in-memory CAS
 * store used by tests.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { JobberTokenSet } from './auth.ts';

export const JOBBER_REFRESH_LEASE_MS = 20_000;
export const JOBBER_REFRESH_LOCK_ATTEMPTS = 5;

export type JobberAuthSource = 'durable' | 'env_bootstrap';

export type JobberOAuthRecord = {
  tokens: JobberTokenSet | null;
  generation: number;
  refreshFingerprint: string | null;
  leaseOwner: string | null;
  leaseUntilMs: number | null;
  seededFrom: JobberAuthSource | null;
};

export type JobberRefreshClaim = {
  owner: string;
  expectedGeneration: number;
  expectedFingerprint: string | null;
  nowMs: number;
  leaseUntilMs: number;
};

export type JobberRefreshCommit = {
  owner: string;
  expectedGeneration: number;
  expectedFingerprint: string | null;
  tokens: JobberTokenSet;
  seededFrom: JobberAuthSource;
};

export type JobberClaimResult = {
  acquired: boolean;
  record: JobberOAuthRecord | null;
};

export type JobberCommitResult = {
  committed: boolean;
  record: JobberOAuthRecord | null;
};

export type JobberLockedTokenStore = {
  load(): Promise<JobberTokenSet | null>;
  save(tokens: JobberTokenSet): Promise<void>;
  loadRecord(): Promise<JobberOAuthRecord | null>;
  tryClaim(claim: JobberRefreshClaim): Promise<JobberClaimResult>;
  commit(commit: JobberRefreshCommit): Promise<JobberCommitResult>;
  release(owner: string): Promise<void>;
};

export function fingerprintRefreshToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

export function newJobberRefreshOwner(): string {
  return randomUUID();
}

export function padLeaseMillis(ms: number): string {
  return String(Math.trunc(ms)).padStart(16, '0');
}

export function parseLeaseMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function emptyJobberOAuthRecord(): JobberOAuthRecord {
  return {
    tokens: null,
    generation: 0,
    refreshFingerprint: null,
    leaseOwner: null,
    leaseUntilMs: null,
    seededFrom: null,
  };
}

export function isJobberRefreshLeaseHeld(
  record: JobberOAuthRecord,
  nowMs: number,
  owner?: string
): boolean {
  if (!record.leaseOwner || record.leaseUntilMs == null) return false;
  if (!Number.isFinite(record.leaseUntilMs) || record.leaseUntilMs <= nowMs) return false;
  if (owner && record.leaseOwner === owner) return false;
  return true;
}

/**
 * Missing row and an unlocked generation-0 placeholder are the env
 * bootstrap claim. A held lease or a generation/fingerprint mismatch
 * loses. Callers must still persist the winner with the database WHERE
 * clause; this predicate is the in-process mirror of that clause.
 */
export function canClaimJobberRefresh(
  record: JobberOAuthRecord | null,
  claim: Pick<JobberRefreshClaim, 'owner' | 'expectedGeneration' | 'expectedFingerprint' | 'nowMs'>
): boolean {
  if (!record) {
    return claim.expectedGeneration === 0 && claim.expectedFingerprint === null;
  }
  if (isJobberRefreshLeaseHeld(record, claim.nowMs, claim.owner)) return false;
  if (record.generation !== claim.expectedGeneration) return false;
  if (record.refreshFingerprint !== claim.expectedFingerprint) return false;
  return true;
}

export function applyJobberRefreshClaim(
  record: JobberOAuthRecord | null,
  claim: JobberRefreshClaim
): JobberOAuthRecord {
  const base = record ?? emptyJobberOAuthRecord();
  return {
    tokens: base.tokens ? { ...base.tokens } : null,
    generation: base.generation,
    refreshFingerprint: base.refreshFingerprint,
    leaseOwner: claim.owner,
    leaseUntilMs: claim.leaseUntilMs,
    seededFrom: base.seededFrom,
  };
}

export function canCommitJobberRefresh(
  record: JobberOAuthRecord | null,
  commit: Pick<JobberRefreshCommit, 'owner' | 'expectedGeneration' | 'expectedFingerprint'>
): boolean {
  if (!record) return false;
  if (record.leaseOwner !== commit.owner) return false;
  if (record.generation !== commit.expectedGeneration) return false;
  if (record.refreshFingerprint !== commit.expectedFingerprint) return false;
  return true;
}

export function applyJobberRefreshCommit(
  record: JobberOAuthRecord,
  commit: JobberRefreshCommit
): JobberOAuthRecord {
  return {
    tokens: { ...commit.tokens },
    generation: record.generation + 1,
    refreshFingerprint: fingerprintRefreshToken(commit.tokens.refreshToken),
    leaseOwner: null,
    leaseUntilMs: null,
    seededFrom: commit.seededFrom,
  };
}

function cloneRecord(record: JobberOAuthRecord | null): JobberOAuthRecord | null {
  if (!record) return null;
  return {
    ...record,
    tokens: record.tokens ? { ...record.tokens } : null,
  };
}

export function createMemoryCasJobberTokenStore(
  initial: JobberOAuthRecord | null = null
): JobberLockedTokenStore & { snapshot(): JobberOAuthRecord | null } {
  let record = cloneRecord(initial);
  let chain: Promise<unknown> = Promise.resolve();

  function atomic<T>(fn: () => T): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  return {
    snapshot() {
      return cloneRecord(record);
    },
    async load() {
      return cloneRecord(record)?.tokens ?? null;
    },
    async save(tokens) {
      await atomic(() => {
        const base = record ?? emptyJobberOAuthRecord();
        record = applyJobberRefreshCommit(
          { ...base, leaseOwner: base.leaseOwner, generation: base.generation },
          {
            owner: base.leaseOwner || 'save',
            expectedGeneration: base.generation,
            expectedFingerprint: base.refreshFingerprint,
            tokens,
            seededFrom: base.seededFrom ?? 'durable',
          }
        );
      });
    },
    async loadRecord() {
      return cloneRecord(record);
    },
    async tryClaim(claim) {
      return atomic(() => {
        if (!canClaimJobberRefresh(record, claim)) {
          return { acquired: false, record: cloneRecord(record) };
        }
        record = applyJobberRefreshClaim(record, claim);
        return { acquired: true, record: cloneRecord(record) };
      });
    },
    async commit(commit) {
      return atomic(() => {
        if (!canCommitJobberRefresh(record, commit)) {
          return { committed: false, record: cloneRecord(record) };
        }
        record = applyJobberRefreshCommit(record, commit);
        return { committed: true, record: cloneRecord(record) };
      });
    },
    async release(owner) {
      await atomic(() => {
        if (record?.leaseOwner === owner) {
          record = { ...record, leaseOwner: null, leaseUntilMs: null };
        }
      });
    },
  };
}

type SimpleJobberTokenStore = {
  load(): Promise<JobberTokenSet | null>;
  save(tokens: JobberTokenSet): Promise<void>;
};

const simpleStoreWrappers = new WeakMap<object, JobberLockedTokenStore>();

export function isLockedJobberTokenStore(
  store: SimpleJobberTokenStore
): store is JobberLockedTokenStore {
  return (
    typeof (store as JobberLockedTokenStore).loadRecord === 'function' &&
    typeof (store as JobberLockedTokenStore).tryClaim === 'function' &&
    typeof (store as JobberLockedTokenStore).commit === 'function' &&
    typeof (store as JobberLockedTokenStore).release === 'function'
  );
}

/**
 * Adapts a load/save store (tests, or a process-local double) so two
 * callers in this isolate share one lease. Cross-isolate safety is the
 * Supabase advisory lock in the SQL migration; this wrapper is the same
 * predicate for stores that do not implement it.
 */
export function wrapJobberTokenStore(inner: SimpleJobberTokenStore): JobberLockedTokenStore {
  if (isLockedJobberTokenStore(inner)) return inner;
  const cached = simpleStoreWrappers.get(inner);
  if (cached) return cached;

  let lease: {
    owner: string;
    untilMs: number;
    generation: number;
    fingerprint: string | null;
  } | null = null;
  let generation = 0;
  let knownFingerprint: string | null | undefined;
  let chain: Promise<unknown> = Promise.resolve();

  function atomic<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function snapshot(nowMs: number): Promise<JobberOAuthRecord | null> {
    const loaded = await inner.load();
    const tokens = loaded ? { ...loaded } : null;
    const fingerprint = tokens ? fingerprintRefreshToken(tokens.refreshToken) : null;
    if (fingerprint !== knownFingerprint) {
      knownFingerprint = fingerprint;
      generation = tokens ? 1 : 0;
      lease = null;
    }
    if (lease && lease.fingerprint !== fingerprint) lease = null;
    if (!tokens && !lease) return null;
    const leaseVisible = lease;
    return {
      tokens,
      generation: tokens ? generation || 1 : 0,
      refreshFingerprint: fingerprint,
      leaseOwner: leaseVisible?.owner ?? null,
      leaseUntilMs: leaseVisible?.untilMs ?? null,
      seededFrom: tokens ? 'durable' : null,
    };
  }

  const wrapped: JobberLockedTokenStore = {
    load: () => inner.load(),
    save: (tokens) => inner.save(tokens),
    loadRecord: () => atomic(() => snapshot(Date.now())),
    async tryClaim(claim) {
      return atomic(async () => {
        const current = await snapshot(claim.nowMs);
        if (!canClaimJobberRefresh(current, claim)) {
          return { acquired: false, record: current };
        }
        generation = current?.generation ?? 0;
        knownFingerprint = current?.refreshFingerprint ?? null;
        lease = {
          owner: claim.owner,
          untilMs: claim.leaseUntilMs,
          generation,
          fingerprint: knownFingerprint,
        };
        return { acquired: true, record: applyJobberRefreshClaim(current, claim) };
      });
    },
    async commit(commit) {
      return atomic(async () => {
        const current = await snapshot(Date.now());
        const held =
          current &&
          lease?.owner === commit.owner &&
          lease.fingerprint === (current.refreshFingerprint ?? null)
            ? {
                ...current,
                leaseOwner: lease.owner,
                leaseUntilMs: lease.untilMs,
                generation: lease.generation,
              }
            : current;
        if (!canCommitJobberRefresh(held, commit)) {
          return { committed: false, record: current };
        }
        await inner.save(commit.tokens);
        const next = applyJobberRefreshCommit(held, commit);
        generation = next.generation;
        knownFingerprint = next.refreshFingerprint;
        lease = null;
        return { committed: true, record: next };
      });
    },
    async release(owner) {
      await atomic(async () => {
        if (lease?.owner === owner) lease = null;
      });
    },
  };

  simpleStoreWrappers.set(inner, wrapped);
  return wrapped;
}
