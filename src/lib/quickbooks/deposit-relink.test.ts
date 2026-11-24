import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relinkRequestId, runRelinkDeposit } from './deposit-relink.ts';
import type { QboAuditEntry } from './durable-write.ts';

const env = {
  QBO_WRITES_ENABLED: 'true',
  QBO_WRITE_REALM_ID: '2222222222222222',
  QBO_PRODUCTION_REALM_ID: '9130349321543166',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const deposit = {
  Deposit: {
    Id: '9',
    SyncToken: '2',
    Line: [{ Id: '1', Amount: 100, DepositLineDetail: { AccountRef: { value: '35', name: '4010 Sales' } } }],
  },
};

test('relink preview does not call QuickBooks', async () => {
  const result = await runRelinkDeposit(
    { depositId: '9', amount: 100, salesAccountId: '35', invoiceId: '99', customerId: '15', txnDate: '2026-10-02', batchId: 'oct-2026' },
    { fetchImpl: async () => { throw new Error('preview posted'); } }
  );
  assert.equal(result.dryRun, true);
  assert.equal(result.wrote, false);
  assert.equal((result.payment as { TotalAmt: number }).TotalAmt, 100);
  assert.equal((result.deposit as { totalUnchanged: boolean }).totalUnchanged, true);
});

test('relink confirm creates the payment and replaces the sales line without changing the total', async () => {
  const posted: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const result = await runRelinkDeposit(
    {
      confirm: true,
      batchId: 'oct-2026',
      depositId: '9',
      amount: 100,
      salesAccountId: '35',
      invoiceId: '99',
      customerId: '15',
      txnDate: '2026-10-02',
    },
    {
      env,
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      audit: async () => {},
      fetchImpl: async (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
        posted.push({ url: String(url), body });
        if (!init?.body) return json(deposit);
        if (String(url).includes('/payment')) {
          return json({ Payment: { Id: '50', SyncToken: '0', TotalAmt: 100, CustomerRef: { value: '15' }, Line: [{ Amount: 100, LinkedTxn: [{ TxnId: '99', TxnType: 'Invoice' }] }] } });
        }
        return json({ Deposit: { ...(body as Record<string, unknown>), SyncToken: '3' } });
      },
    }
  );
  assert.equal(result.wrote, true);
  assert.equal(result.paymentId, '50');
  const update = posted.find((call) => call.body && String(call.url).includes('/deposit') && !String(call.url).includes('/deposit/'));
  const lines = update?.body?.Line as Array<{ Amount: number; LinkedTxn?: Array<{ TxnId: string }>; DepositLineDetail?: unknown }>;
  assert.equal(lines.length, 1);
  assert.equal(lines[0].Amount, 100);
  assert.equal(lines[0].LinkedTxn?.[0].TxnId, '50');
  assert.equal(lines[0].DepositLineDetail, undefined);
  assert.equal(posted.some((call) => call.url.includes('/payment')), true);
});

/** A live-ish QuickBooks double: one deposit with two 4010 lines, payments keyed by Intuit requestid. */
function fakeQbo(options: { replayPayments?: boolean; replayDeposits?: boolean; driftDepositAfterFirstRead?: boolean } = {}) {
  const state = {
    deposit: {
      Id: '38114',
      SyncToken: '2',
      Line: [
        { Id: '3', Amount: 1083.05, DepositLineDetail: { AccountRef: { value: '35' } } },
        { Id: '4', Amount: 258.19, DepositLineDetail: { AccountRef: { value: '35' } } },
        { Id: '5', Amount: 500, DepositLineDetail: { AccountRef: { value: '40' } } },
      ] as Array<Record<string, unknown>>,
    },
    nextPaymentId: 39200,
    byRequest: new Map<string, unknown>(),
    requestIds: [] as Array<{ path: string; requestId: string }>,
    posts: [] as string[],
    depositReads: 0,
  };
  const fetchImpl = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const requestId = url.searchParams.get('requestid') || '';
    if (!init?.body) {
      state.depositReads += 1;
      if (options.driftDepositAfterFirstRead && state.depositReads > 1) {
        return json({ Deposit: { ...state.deposit, Line: state.deposit.Line.filter((line) => line.Id !== '3') } });
      }
      return json({ Deposit: structuredClone(state.deposit) });
    }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const path = url.pathname.endsWith('/payment') ? 'payment' : 'deposit';
    state.requestIds.push({ path, requestId });
    state.posts.push(path);
    const replay = path === 'payment' ? options.replayPayments : options.replayDeposits;
    if (replay && state.byRequest.size > 0 && Array.from(state.byRequest.keys()).some((key) => key.startsWith(path))) {
      const first = Array.from(state.byRequest.entries()).find(([key]) => key.startsWith(path));
      return json(first?.[1]);
    }
    if (state.byRequest.has(`${path}:${requestId}`)) return json(state.byRequest.get(`${path}:${requestId}`));
    let response: unknown;
    if (path === 'payment') {
      response = { Payment: { ...body, Id: String(state.nextPaymentId++), SyncToken: '0' } };
    } else {
      state.deposit = { ...(body as typeof state.deposit), SyncToken: String(Number(state.deposit.SyncToken) + 1) };
      response = { Deposit: structuredClone(state.deposit) };
    }
    state.byRequest.set(`${path}:${requestId}`, response);
    return json(response);
  };
  return { state, fetchImpl };
}

function relinkDeps(fetchImpl: (input: unknown, init?: RequestInit) => Promise<Response>, audit: QboAuditEntry[] = []) {
  return {
    env,
    productionRealmId: '9130349321543166',
    accessToken: 'tok',
    audit: async (entry: QboAuditEntry) => { audit.push(entry); },
    fetchImpl: fetchImpl as typeof fetch,
  };
}

const relinkA = { confirm: true, batchId: 'relink-older-02', depositId: '38114', lineId: '3', amount: 1083.05, invoiceId: '35369', customerId: '21', txnDate: '2026-10-23' };
const relinkB = { confirm: true, batchId: 'relink-older-02', depositId: '38114', lineId: '4', amount: 258.19, invoiceId: '35968', customerId: '12810', txnDate: '2026-10-23' };

test('two relinks on one deposit in one batch use different payment and deposit request ids', async () => {
  const qbo = fakeQbo();
  const audit: QboAuditEntry[] = [];
  const first = await runRelinkDeposit(relinkA, relinkDeps(qbo.fetchImpl, audit));
  const second = await runRelinkDeposit(relinkB, relinkDeps(qbo.fetchImpl, audit));
  assert.equal(first.wrote, true);
  assert.equal(second.wrote, true);
  assert.notEqual(first.paymentId, second.paymentId);
  const payKeys = qbo.state.requestIds.filter((item) => item.path === 'payment').map((item) => item.requestId);
  const depKeys = qbo.state.requestIds.filter((item) => item.path === 'deposit').map((item) => item.requestId);
  assert.equal(payKeys.length, 2);
  assert.equal(depKeys.length, 2);
  assert.notEqual(payKeys[0], payKeys[1]);
  assert.notEqual(depKeys[0], depKeys[1]);
  for (const key of [...payKeys, ...depKeys]) assert.match(key, /^[A-Za-z0-9_-]{8,50}$/);
  assert.match(payKeys[0], /^relpay-38114-L3-/);
  assert.match(payKeys[1], /^relpay-38114-L4-/);
  // The deposit total is unchanged and both payments are linked.
  const total = qbo.state.deposit.Line.reduce((sum, line) => sum + Math.round(Number(line.Amount) * 100), 0);
  assert.equal(total, 108305 + 25819 + 50000);
  const linked = qbo.state.deposit.Line.flatMap((line) => ((line.LinkedTxn as Array<{ TxnId: string }>) || []).map((item) => item.TxnId));
  assert.deepEqual(linked.sort(), [String(first.paymentId), String(second.paymentId)].sort());
  assert.equal(qbo.state.deposit.SyncToken, '4');
  assert.deepEqual(audit.map((entry) => entry.status), ['pending', 'ok', 'pending', 'ok', 'pending', 'ok', 'pending', 'ok']);
});

test('relink request ids change with the line, invoice, amount, customer and a caller requestId', () => {
  const base = { batchId: 'b1', depositId: '38114', lineId: '3', salesAccountId: null, invoiceId: '35369', customerId: '21', amountCents: 108305 };
  const key = relinkRequestId('relpay', base);
  assert.notEqual(key, relinkRequestId('relpay', { ...base, lineId: '4' }));
  assert.notEqual(key, relinkRequestId('relpay', { ...base, invoiceId: '35968' }));
  assert.notEqual(key, relinkRequestId('relpay', { ...base, amountCents: 25819 }));
  assert.notEqual(key, relinkRequestId('relpay', { ...base, customerId: '12810' }));
  assert.notEqual(key, relinkRequestId('relpay', { ...base, requestId: 'retry-20261124' }));
  assert.notEqual(key, relinkRequestId('reldep', base));
  assert.equal(key, relinkRequestId('relpay', { ...base }));
  const long = relinkRequestId('reldep', { ...base, depositId: '12345678901234567890', lineId: '9999999999999' });
  assert.match(long, /^[A-Za-z0-9_-]{8,50}$/);
});

test('a replayed payment response that does not match the request stops before the deposit is touched', async () => {
  const qbo = fakeQbo({ replayPayments: true });
  await runRelinkDeposit(relinkA, relinkDeps(qbo.fetchImpl));
  const postsBefore = qbo.state.posts.length;
  const tokenBefore = qbo.state.deposit.SyncToken;
  await assert.rejects(() => runRelinkDeposit(relinkB, relinkDeps(qbo.fetchImpl)), /does not match the request[\s\S]*amount 1083.05 instead of 258.19[\s\S]*customer 21 instead of 12810/);
  assert.deepEqual(qbo.state.posts.slice(postsBefore), ['payment']);
  assert.equal(qbo.state.deposit.SyncToken, tokenBefore);
});

test('a replayed deposit response that did not link the new payment throws', async () => {
  const qbo = fakeQbo({ replayDeposits: true });
  await runRelinkDeposit(relinkA, relinkDeps(qbo.fetchImpl));
  await assert.rejects(() => runRelinkDeposit(relinkB, relinkDeps(qbo.fetchImpl)), /was not confirmed as updated[\s\S]*SyncToken 3 did not go up from 3[\s\S]*does not link payment/);
});

test('a throw after the pending row writes a failed audit row instead of leaving it pending', async () => {
  const qbo = fakeQbo({ driftDepositAfterFirstRead: true });
  const audit: QboAuditEntry[] = [];
  await assert.rejects(() => runRelinkDeposit(relinkA, relinkDeps(qbo.fetchImpl, audit)), /No deposit sales line matches/);
  assert.deepEqual(audit.map((entry) => [entry.entity, entry.status]), [
    ['Payment', 'pending'],
    ['Payment', 'ok'],
    ['Deposit', 'pending'],
    ['Deposit', 'failed'],
  ]);
  const failed = audit[3];
  assert.equal(failed.ok, false);
  assert.equal(failed.requestId, audit[2].requestId);
  assert.match(String(failed.error), /Stopped after the pending row: No deposit sales line matches/);
  assert.deepEqual(qbo.state.posts, ['payment']);
});
