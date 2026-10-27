import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AI_RECEPTIONIST } from './config.ts';
import { handleShopAmd, recordShopAmd, shopAmdDecision, shopLegRecordsAnswer } from './shop-amd.ts';
import { buildAfterHoursAiTwiml, buildAiHandoffTwiml, buildInboundTwiml } from './twiml.ts';

const PARENT = `CA${'a'.repeat(32)}`;
const CHILD = `CA${'b'.repeat(32)}`;
const ENV = {
  TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'test-token',
  NEXT_PUBLIC_APP_URL: 'https://scws-jobs.vercel.app',
} as NodeJS.ProcessEnv;

function memoryDb(processing: string | null = null) {
  const state = {
    row: { call_sid: PARENT, processing_error: processing as string | null },
  };
  const db = {
    from() {
      return {
        select() {
          return { eq() { return { maybeSingle: async () => ({ data: state.row ? { ...state.row } : null, error: null }) }; } };
        },
        update(patch: Record<string, unknown>) {
          const filters: Array<(row: Record<string, unknown>) => boolean> = [];
          const apply = () => {
            if (!state.row || filters.some((filter) => !filter(state.row as Record<string, unknown>))) return { data: [], error: null };
            Object.assign(state.row, patch);
            return { data: [{ call_sid: PARENT }], error: null };
          };
          const api: any = {
            eq(col: string, val: string) { filters.push((row) => row[col] === val); return api; },
            is(col: string, val: null) { filters.push((row) => row[col] == null); return api; },
            select: async () => apply(),
            then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
              return Promise.resolve(apply()).then(resolve, reject);
            },
          };
          return api;
        },
      };
    },
  };
  return { db, state };
}

function fakeFetch(results: Array<{ status: number; body?: string }>) {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') });
    const next = results.shift() ?? { status: 200, body: '' };
    return { ok: next.status >= 200 && next.status < 300, status: next.status, text: async () => next.body ?? '' };
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('shop answering-machine decision', () => {
  it('keeps a person and rolls a machine, fax, or unknown', () => {
    assert.deepEqual(shopAmdDecision('human'), { action: 'keep', kind: 'human' });
    assert.deepEqual(shopAmdDecision('machine_start'), { action: 'roll', kind: 'machine' });
    assert.deepEqual(shopAmdDecision('machine_end_beep'), { action: 'roll', kind: 'machine' });
    assert.deepEqual(shopAmdDecision('machine_end_silence'), { action: 'roll', kind: 'machine' });
    assert.deepEqual(shopAmdDecision('fax'), { action: 'roll', kind: 'machine' });
    assert.deepEqual(shopAmdDecision('unknown'), { action: 'roll', kind: 'machine' });
    assert.deepEqual(shopAmdDecision(''), { action: 'ignore', kind: null });
    assert.deepEqual(shopAmdDecision('something-else'), { action: 'ignore', kind: null });
  });

  it('does not treat a shop in-progress event as a person, and skips a machine leg', () => {
    assert.equal(shopLegRecordsAnswer({ party: 'shop', params: { CallStatus: 'in-progress' } }), false);
    assert.equal(shopLegRecordsAnswer({ party: 'shop', params: { CallStatus: 'answered' } }), false);
    assert.equal(shopLegRecordsAnswer({ party: 'shop', params: { CallStatus: 'completed', CallDuration: '208' }, processingError: 'amd:machine' }), false);
    assert.equal(shopLegRecordsAnswer({ party: 'shop', params: { CallStatus: 'completed', CallDuration: '95' } }), true);
    assert.equal(shopLegRecordsAnswer({ party: 'shop', params: { CallStatus: 'completed', CallDuration: '95' }, processingError: 'amd:human' }), true);
    assert.equal(shopLegRecordsAnswer({ party: 'mike', params: { CallStatus: 'in-progress' } }), true);
    assert.equal(shopLegRecordsAnswer({ party: 'mike', params: { CallStatus: 'completed', CallDuration: '40' } }), true);
  });
});

describe('AMD callback', () => {
  it('keeps a human marker when await-mike wins the first write', async () => {
    const state = { call_sid: PARENT, processing_error: null as string | null };
    let raced = false;
    const db = {
      from() {
        return {
          select() {
            return { eq() { return { maybeSingle: async () => ({ data: { ...state }, error: null }) }; } };
          },
          update(patch: { processing_error: string }) {
            const filters: Array<(row: typeof state) => boolean> = [];
            const api: any = {
              eq(col: string, val: string) { filters.push((row) => (row as Record<string, unknown>)[col] === val); return api; },
              is(col: string, val: null) { filters.push((row) => (row as Record<string, unknown>)[col] == null); return api; },
              select: async () => {
                if (!raced && state.processing_error == null) {
                  raced = true;
                  state.processing_error = 'await-mike';
                  return { data: [], error: null };
                }
                if (filters.some((filter) => !filter(state))) return { data: [], error: null };
                state.processing_error = patch.processing_error;
                return { data: [{ call_sid: PARENT }], error: null };
              },
            };
            return api;
          },
        };
      },
    };
    const recorded = await recordShopAmd(db, PARENT, 'human');
    assert.equal(recorded.status, 'recorded');
    assert.equal(recorded.kind, 'human');
    assert.equal(state.processing_error, 'await-mike|amd:human');
  });

  it('writes the shop leg when a human result is already stored without it', async () => {
    const { db, state } = memoryDb('amd:human');
    const { fetchImpl, calls } = fakeFetch([]);
    const result = await handleShopAmd({
      answeredBy: 'human', parentCallSid: PARENT, childCallSid: CHILD, db, env: ENV, fetchImpl,
    });
    assert.equal(result.action, 'keep');
    assert.equal(result.httpStatus, 200);
    assert.equal(calls.length, 0);
    assert.equal(state.row.processing_error, 'amd:human|leg:shop');
  });

  it('records a human and does not change the live call', async () => {
    const { db, state } = memoryDb();
    const { fetchImpl, calls } = fakeFetch([]);
    const result = await handleShopAmd({
      answeredBy: 'human', parentCallSid: PARENT, childCallSid: CHILD, db, env: ENV, fetchImpl,
    });
    assert.equal(result.action, 'keep');
    assert.equal(result.httpStatus, 200);
    assert.equal(calls.length, 0);
    assert.equal(state.row.processing_error, 'amd:human|leg:shop');
  });

  it('hangs up the shop leg on machine, fax, or unknown, and a retry does not dial Mike itself', async () => {
    for (const answeredBy of ['machine_start', 'fax', 'unknown']) {
      const { db, state } = memoryDb();
      const { fetchImpl, calls } = fakeFetch([{ status: 200 }, { status: 400, body: 'Call is not in-progress. Cannot redirect' }]);
      const first = await handleShopAmd({
        answeredBy, parentCallSid: PARENT, childCallSid: CHILD, db, env: ENV, fetchImpl,
      });
      const second = await handleShopAmd({
        answeredBy, parentCallSid: PARENT, childCallSid: CHILD, db, env: ENV, fetchImpl,
      });
      assert.equal(first.action, 'roll', answeredBy);
      assert.equal(first.httpStatus, 200, answeredBy);
      assert.equal(second.httpStatus, 200, answeredBy);
      assert.equal(calls.length, 2, answeredBy);
      assert.match(calls[0].url, new RegExp(`/Calls/${CHILD}\\.json$`), answeredBy);
      assert.doesNotMatch(calls[0].url, new RegExp(`/Calls/${PARENT}\\.json$`), answeredBy);
      assert.match(calls[0].body, /Hangup/, answeredBy);
      assert.equal(calls[0].body.includes(AI_RECEPTIONIST), false, answeredBy);
      assert.equal(state.row.processing_error, 'amd:machine', answeredBy);
    }
  });

  it('does not hang up once a person has already been recorded', async () => {
    const { db, state } = memoryDb();
    const { fetchImpl, calls } = fakeFetch([]);
    await handleShopAmd({ answeredBy: 'human', parentCallSid: PARENT, childCallSid: CHILD, db, env: ENV, fetchImpl });
    const late = await handleShopAmd({
      answeredBy: 'machine_start', parentCallSid: PARENT, childCallSid: CHILD, db, env: ENV, fetchImpl,
    });
    assert.equal(late.action, 'keep');
    assert.equal(calls.length, 0);
    assert.equal(state.row.processing_error, 'amd:human|leg:shop');
  });

  it('drops the marker and asks Twilio to retry when the hangup fails', async () => {
    const { db, state } = memoryDb();
    const { fetchImpl } = fakeFetch([{ status: 500, body: 'down' }]);
    const result = await handleShopAmd({
      answeredBy: 'machine_start', parentCallSid: PARENT, childCallSid: CHILD, db, env: ENV, fetchImpl,
    });
    assert.equal(result.httpStatus, 500);
    assert.equal(state.row.processing_error, null);
  });

  it('ignores an empty result so a later machine callback can still roll', async () => {
    const { db, state } = memoryDb();
    const { fetchImpl, calls } = fakeFetch([{ status: 200 }]);
    const ignored = await handleShopAmd({
      answeredBy: '', parentCallSid: PARENT, childCallSid: CHILD, db, env: ENV, fetchImpl,
    });
    const rolled = await handleShopAmd({
      answeredBy: 'machine_start', parentCallSid: PARENT, childCallSid: CHILD, db, env: ENV, fetchImpl,
    });
    assert.equal(ignored.action, 'ignored');
    assert.equal(rolled.action, 'roll');
    assert.equal(calls.length, 1);
    assert.equal(state.row.processing_error, 'amd:machine');
  });

  it('without a call row, redirects the parent to Mike and does not hang up a human', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200 }]);
    const missing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    const rolled = await handleShopAmd({
      answeredBy: 'machine_start', parentCallSid: PARENT, childCallSid: CHILD, db: missing, env: ENV, fetchImpl,
    });
    assert.equal(rolled.httpStatus, 200);
    assert.match(calls[0].url, new RegExp(`/Calls/${PARENT}\\.json$`));
    const twiml = new URLSearchParams(calls[0].body).get('Twiml') ?? '';
    assert.match(twiml, /17604915348/);
    assert.match(twiml, /rolled=1/);
    assert.match(twiml, /leg=mike/);
    assert.doesNotMatch(twiml, /<Hangup/);
    const human = await handleShopAmd({
      answeredBy: 'human', parentCallSid: PARENT, childCallSid: CHILD, db: null, env: ENV, fetchImpl,
    });
    assert.equal(human.action, 'keep');
    assert.equal(calls.length, 1);
  });
});

describe('AMD is only on the shop number in front of Mike', () => {
  it('screens the shop leg and not Mike, after hours, or the handoff', () => {
    const inbound = buildInboundTwiml({
      shopNumbers: ['+17602763468'],
      nextNumber: AI_RECEPTIONIST,
      baseUrl: 'https://scws-jobs.vercel.app',
      timeout: 10,
    });
    assert.match(inbound, /<Number[^>]*machineDetection="Enable"[^>]*>\+17602763468<\/Number>/);
    assert.match(inbound, /<Number statusCallback="[^"]*party=mike"[^>]*>\+17604915348<\/Number>/);
    const afterHours = buildAfterHoursAiTwiml({ aiNumber: AI_RECEPTIONIST, baseUrl: 'https://scws-jobs.vercel.app', actionQuery: '?afterhours=1' });
    const handoff = buildAiHandoffTwiml(AI_RECEPTIONIST, 'https://scws-jobs.vercel.app', '?rolled=1&leg=mike');
    assert.doesNotMatch(afterHours, /machineDetection/);
    assert.doesNotMatch(handoff, /machineDetection/);
  });
});
