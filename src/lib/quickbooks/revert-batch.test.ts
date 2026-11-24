import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBatchRevert, runBatchRevert, type BatchAuditRow } from './revert-batch.ts';

function row(partial: Partial<BatchAuditRow> & Pick<BatchAuditRow, 'id' | 'entity'>): BatchAuditRow {
  return {
    tool: 'qbo_import_jobber_invoices',
    action: partial.created ? 'create' : 'update',
    created: false,
    ok: true,
    dryRun: false,
    confirmed: true,
    qboId: String(partial.id),
    syncToken: '0',
    priorState: null,
    txnDate: '2026-10-02',
    status: null,
    requestId: null,
    error: null,
    ...partial,
  };
}

test('revert restores updates, then deletes payments, then deletes invoices', () => {
  const plan = planBatchRevert(
    [
      row({ id: 1, entity: 'Invoice', created: true, action: 'create' }),
      row({ id: 2, entity: 'Payment', created: true, action: 'create' }),
      row({ id: 3, entity: 'Deposit', created: false, action: 'update', priorState: { Id: '9', SyncToken: '1', Line: [] } }),
    ],
    null
  );
  assert.deepEqual(
    plan.steps.map((step) => [step.phase, step.entity, step.auditId]),
    [
      ['restore', 'Deposit', 3],
      ['delete-payment', 'Payment', 2],
      ['delete', 'Invoice', 1],
    ]
  );
  assert.equal(plan.couldNot.length, 0);
});

test('revert refuses a closed period, a void, and a row this gateway did not create', () => {
  const plan = planBatchRevert(
    [
      row({ id: 1, entity: 'Invoice', created: true, action: 'create', txnDate: '2026-10-01' }),
      row({ id: 2, entity: 'Payment', created: false, action: 'void', txnDate: '2026-11-01' }),
      row({ id: 3, entity: 'Purchase', created: false, action: 'update', priorState: null, txnDate: '2026-11-01' }),
    ],
    '2026-10-15'
  );
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.couldNot.length, 3);
  assert.match(plan.couldNot[0].reason, /close date/);
  assert.match(plan.couldNot[1].reason, /void/);
  assert.match(plan.couldNot[2].reason, /not created/);
});

test('a pending intent row is not a second write when the ok row recorded the entity', () => {
  const plan = planBatchRevert(
    [
      row({
        id: 2,
        entity: 'Invoice',
        action: 'create',
        created: false,
        ok: false,
        status: 'pending',
        requestId: 'inv-write-test',
        qboId: null,
        syncToken: null,
      }),
      row({
        id: 3,
        entity: 'Invoice',
        action: 'create',
        created: true,
        ok: true,
        status: 'ok',
        requestId: 'inv-write-test',
        qboId: '39107',
      }),
    ],
    null
  );
  assert.deepEqual(
    plan.steps.map((step) => [step.action, step.entity, step.qboId]),
    [['delete', 'Invoice', '39107']]
  );
  assert.equal(plan.couldNot.length, 0);

  const sameEntity = planBatchRevert(
    [
      row({
        id: 4,
        entity: 'Invoice',
        action: 'create',
        created: false,
        ok: false,
        status: 'pending',
        requestId: 'intent',
        qboId: '39107',
      }),
      row({
        id: 5,
        entity: 'Invoice',
        action: 'create',
        created: true,
        ok: true,
        status: 'ok',
        requestId: 'outcome',
        qboId: '39107',
      }),
    ],
    null
  );
  assert.deepEqual(
    sameEntity.steps.map((step) => step.auditId),
    [5]
  );
});

test('an unresolved pending row is reported and a pending row that already has an id is reverted once', () => {
  const unresolved = planBatchRevert(
    [
      row({
        id: 2,
        entity: 'Invoice',
        action: 'create',
        created: false,
        ok: false,
        status: 'pending',
        requestId: 'inv-only',
        qboId: null,
      }),
    ],
    null
  );
  assert.equal(unresolved.steps.length, 0);
  assert.equal(unresolved.couldNot.length, 1);
  assert.match(unresolved.couldNot[0].reason, /pending audit row/);

  const onlyId = planBatchRevert(
    [
      row({
        id: 4,
        entity: 'Invoice',
        action: 'create',
        created: false,
        ok: false,
        status: 'pending',
        requestId: 'inv-stamped',
        qboId: '39107',
      }),
    ],
    null
  );
  assert.deepEqual(
    onlyId.steps.map((step) => step.qboId),
    ['39107']
  );
  assert.equal(onlyId.couldNot.length, 0);
});

test('refused and failed rows are not reverted, and a failed outcome settles its pending row', () => {
  const plan = planBatchRevert(
    [
      row({
        id: 1,
        entity: 'Invoice',
        action: 'create',
        created: false,
        ok: false,
        status: 'pending',
        requestId: 'inv-fail',
        qboId: null,
      }),
      row({
        id: 2,
        entity: 'Invoice',
        action: 'create',
        created: false,
        ok: false,
        status: 'failed',
        requestId: 'inv-fail',
        qboId: '55',
        error: 'QuickBooks /invoice failed (400).',
      }),
      row({
        id: 3,
        entity: 'Payment',
        action: 'create',
        created: false,
        ok: false,
        status: 'refused',
        requestId: 'pay-refused',
        qboId: '9',
        dryRun: true,
      }),
    ],
    null
  );
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.couldNot.length, 0);
});

test('confirm revert posts deletes after the deposit restore', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const method = init?.method || 'GET';
    const full = String(url);
    calls.push(`${method} ${full.split('?')[0].split('/v3/company/')[1]}${full.includes('operation=delete') ? '?operation=delete' : ''}`);
    assert.equal(full.startsWith('https://sandbox-quickbooks.api.intuit.com/'), true);
    const entity = String(url).includes('/deposit') ? 'Deposit' : String(url).includes('/payment') ? 'Payment' : 'Invoice';
    return new Response(JSON.stringify({ [entity]: { Id: '1', SyncToken: '4', TxnDate: '2026-10-02' } }), { status: 200 });
  };
  const result = await runBatchRevert(
    { batchId: 'oct-2026', confirm: true },
    {
      env: {
        QBO_WRITES_ENABLED: 'true',
        QBO_WRITE_REALM_ID: '2222222222222222',
        QBO_PRODUCTION_REALM_ID: '9130349321543166',
      },
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      fetchImpl,
      audit: async () => {},
      readCloseDate: async () => null,
      loadBatch: async () => [
        row({ id: 1, entity: 'Invoice', created: true, action: 'create', qboId: '10' }),
        row({ id: 2, entity: 'Payment', created: true, action: 'create', qboId: '20' }),
        row({ id: 3, entity: 'Deposit', created: false, action: 'update', qboId: '30', priorState: { Id: '30', SyncToken: '1', Line: [] } }),
      ],
    }
  );
  assert.equal(result.wrote, true);
  assert.deepEqual(calls, [
    'GET 2222222222222222/deposit/30',
    'POST 2222222222222222/deposit',
    'GET 2222222222222222/payment/20',
    'POST 2222222222222222/payment?operation=delete',
    'GET 2222222222222222/invoice/10',
    'POST 2222222222222222/invoice?operation=delete',
  ]);
  const deleteCalls = calls.filter((call) => call.startsWith('POST'));
  assert.match(deleteCalls[1], /payment/);
  assert.match(deleteCalls[2], /invoice/);
});
