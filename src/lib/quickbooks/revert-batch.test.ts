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

test('a restore is refused when the prior TxnDate is on or before the close date', () => {
  const blocked = planBatchRevert(
    [
      row({
        id: 1,
        entity: 'Invoice',
        action: 'update',
        qboId: '39170',
        txnDate: '2026-10-01',
        priorState: { Id: '39170', SyncToken: '1', TxnDate: '2024-12-31', Line: [] },
      }),
    ],
    '2024-12-31'
  );
  assert.equal(blocked.steps.length, 0);
  assert.match(blocked.couldNot[0].reason, /prior TxnDate 2024-12-31/);
  const allowed = planBatchRevert(
    [
      row({
        id: 2,
        entity: 'Invoice',
        action: 'update',
        qboId: '39170',
        txnDate: '2026-10-01',
        priorState: { Id: '39170', SyncToken: '1', TxnDate: '2026-10-01', Line: [] },
      }),
    ],
    '2024-12-31'
  );
  assert.equal(allowed.couldNot.length, 0);
  assert.equal(allowed.steps.length, 1);
});

test('a missing TxnDate blocks a transaction when the books are closed, and does not block an item', () => {
  const closed = planBatchRevert(
    [
      row({ id: 1, entity: 'Invoice', created: false, action: 'update', qboId: '39170', txnDate: null, priorState: { Id: '39170', SyncToken: '0' } }),
      row({ id: 2, entity: 'Item', tool: 'qbo_item_tax_category', created: false, action: 'update', qboId: '1010000474', txnDate: null, priorState: { Id: '1010000474', SyncToken: '1' } }),
      row({ id: 3, entity: 'Customer', created: true, action: 'create', qboId: '8', txnDate: null }),
    ],
    '2024-12-31'
  );
  assert.equal(closed.steps.length, 2);
  assert.deepEqual(closed.steps.map((step) => step.entity), ['Item', 'Customer']);
  assert.match(closed.couldNot[0].reason, /no TxnDate/);
});

test('confirm revert reads the live TxnDate when the audit row has none', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const method = init?.method || 'GET';
    calls.push(method);
    const posted = method === 'POST';
    return new Response(JSON.stringify({
      Invoice: {
        Id: '39170',
        SyncToken: posted ? '2' : '1',
        TxnDate: '2026-10-01',
        TxnTaxDetail: { TxnTaxCodeRef: { value: '29' }, TotalTax: 200, TaxLine: [{ TaxLineDetail: { TaxRateRef: { value: '13' }, NetAmountTaxable: 2500 } }] },
      },
    }), { status: 200 });
  };
  const result = await runBatchRevert(
    { batchId: 'tax-39170', confirm: true },
    {
      env: { QBO_WRITES_ENABLED: 'true', QBO_WRITE_REALM_ID: '2222222222222222', QBO_PRODUCTION_REALM_ID: '9130349321543166' },
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      fetchImpl,
      audit: async () => {},
      readCloseDate: async () => '2024-12-31',
      loadBatch: async () => [
        row({
          id: 4,
          entity: 'Invoice',
          tool: 'qbo_invoice',
          action: 'update',
          qboId: '39170',
          txnDate: null,
          priorState: { Id: '39170', SyncToken: '0', TxnDate: '2026-10-01', TxnTaxDetail: { TxnTaxCodeRef: { value: '29' }, TotalTax: 200, TaxLine: [{ TaxLineDetail: { TaxRateRef: { value: '13' }, NetAmountTaxable: 2500 } }] } },
        }),
      ],
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.couldNot));
  assert.equal(result.wrote, true);
  assert.equal(calls.filter((method) => method === 'POST').length, 1);
  const step = (result.results as Array<{ txnDate: string | null; status: string }>)[0];
  assert.equal(step.txnDate, '2026-10-01');
  assert.equal(step.status, 'reverted');
});

test('a live TxnDate inside the closed period is still refused and nothing is posted', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    calls.push(init?.method || 'GET');
    return new Response(JSON.stringify({ Invoice: { Id: '39170', SyncToken: '1', TxnDate: '2024-06-01' } }), { status: 200 });
  };
  const result = await runBatchRevert(
    { batchId: 'old-39170', confirm: true },
    {
      env: { QBO_WRITES_ENABLED: 'true', QBO_WRITE_REALM_ID: '2222222222222222', QBO_PRODUCTION_REALM_ID: '9130349321543166' },
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      fetchImpl,
      audit: async () => {},
      readCloseDate: async () => '2024-12-31',
      loadBatch: async () => [
        row({ id: 4, entity: 'Invoice', tool: 'qbo_invoice', action: 'update', qboId: '39170', txnDate: null, priorState: { Id: '39170', SyncToken: '0' } }),
      ],
    }
  );
  assert.equal(result.wrote, false);
  assert.equal(calls.includes('POST'), false);
  assert.match((result.couldNot as Array<{ reason: string }>)[0].reason, /2024-06-01/);
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

test('revert restores a relinked deposit before it deletes the payment, invoice, and customer', () => {
  const plan = planBatchRevert(
    [
      row({ id: 1, entity: 'Customer', created: true, action: 'create', qboId: '8', txnDate: null }),
      row({ id: 2, entity: 'Invoice', created: true, action: 'create', qboId: '10' }),
      row({ id: 3, entity: 'Payment', created: true, action: 'create', qboId: '20' }),
      row({ id: 4, entity: 'Deposit', created: false, action: 'update', qboId: '30', priorState: { Id: '30', SyncToken: '1', Line: [] } }),
    ],
    null
  );
  assert.deepEqual(
    plan.steps.map((step) => [step.phase, step.entity, step.qboId]),
    [
      ['restore', 'Deposit', '30'],
      ['delete-payment', 'Payment', '20'],
      ['delete', 'Invoice', '10'],
      ['delete', 'Customer', '8'],
    ]
  );
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

test('a replayed payment row (relink-older-01 rows 29-35) is deleted once, not twice', () => {
  const rows = [
    row({ id: 29, entity: 'Payment', tool: 'qbo_relink_deposit', status: 'pending', ok: false, qboId: null, requestId: 'relpay-relink-older-01-38114' }),
    row({ id: 30, entity: 'Payment', tool: 'qbo_relink_deposit', status: 'ok', created: true, action: 'create', qboId: '39116', requestId: 'relpay-relink-older-01-38114', txnDate: '2026-10-23' }),
    row({ id: 31, entity: 'Deposit', tool: 'qbo_relink_deposit', status: 'pending', ok: false, qboId: null, requestId: 'reldep-relink-older-01-38114' }),
    row({ id: 32, entity: 'Deposit', tool: 'qbo_relink_deposit', status: 'ok', action: 'update', qboId: '38114', priorState: { Id: '38114', SyncToken: '1', Line: [] }, requestId: 'reldep-relink-older-01-38114', txnDate: '2026-10-23' }),
    row({ id: 33, entity: 'Payment', tool: 'qbo_relink_deposit', status: 'pending', ok: false, qboId: null, requestId: 'relpay-relink-older-01-38114' }),
    row({ id: 34, entity: 'Payment', tool: 'qbo_relink_deposit', status: 'ok', created: true, action: 'create', qboId: '39116', requestId: 'relpay-relink-older-01-38114', txnDate: '2026-10-23' }),
    row({ id: 35, entity: 'Deposit', tool: 'qbo_relink_deposit', status: 'failed', ok: false, qboId: null, requestId: 'reldep-relink-older-01-38114' }),
  ];
  const plan = planBatchRevert(rows, '2024-12-31');
  assert.deepEqual(
    plan.steps.map((step) => [step.phase, step.entity, step.qboId, step.auditId]),
    [
      ['restore', 'Deposit', '38114', 32],
      ['delete-payment', 'Payment', '39116', 30],
    ]
  );
  assert.equal(plan.couldNot.length, 0);
  assert.deepEqual(plan.duplicates.map((item) => [item.auditId, item.qboId, item.sameAsAuditId]), [[34, '39116', 30]]);
  // Row 35 still pending (before it is closed) is covered by row 32's request id.
  const stillPending = planBatchRevert(rows.map((item) => (item.id === 35 ? { ...item, status: 'pending' as const } : item)), '2024-12-31');
  assert.equal(stillPending.steps.length, 2);
  assert.equal(stillPending.couldNot.length, 0);
});

test('an unknown post outcome is reported as possibly written, not treated as failed', () => {
  const rows = [
    row({ id: 1, entity: 'Payment', tool: 'qbo_relink_deposit', status: 'pending', ok: false, qboId: null, requestId: 'relpay-38114-L3-aaaa' }),
    row({ id: 2, entity: 'Payment', tool: 'qbo_relink_deposit', status: 'unknown', ok: false, qboId: null, requestId: 'relpay-38114-L3-aaaa', error: 'outcome unknown' }),
  ];
  const plan = planBatchRevert(rows, null);
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.couldNot.length, 1);
  assert.match(plan.couldNot[0].reason, /outcome unknown[\s\S]*may have posted/);
  // A later ok row for the same request id is the real outcome.
  const resolved = planBatchRevert(
    [...rows, row({ id: 3, entity: 'Payment', tool: 'qbo_relink_deposit', status: 'ok', created: true, action: 'create', qboId: '39200', requestId: 'relpay-38114-L3-aaaa' })],
    null
  );
  assert.deepEqual(resolved.steps.map((step) => [step.qboId, step.auditId]), [['39200', 3]]);
  assert.equal(resolved.couldNot.length, 0);
});

test('revert restores an item tax category update and an invoice tax override from prior state, and deletes neither', async () => {
  const calls: string[] = [];
  const posted: Record<string, unknown>[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const method = init?.method || 'GET';
    const full = String(url);
    calls.push(`${method} ${full.split('?')[0].split('/v3/company/')[1]}${full.includes('operation=delete') ? '?operation=delete' : ''}`);
    if (method === 'POST') posted.push(JSON.parse(String(init?.body)));
    const entity = full.includes('/item') ? 'Item' : 'Invoice';
    const tax = entity === 'Invoice' ? { TxnTaxDetail: { TxnTaxCodeRef: { value: '3' }, TotalTax: 401.53, TaxLine: ['3', '4', '5'].map((id) => ({ TaxLineDetail: { TaxRateRef: { value: id }, NetAmountTaxable: 5181 } })) } } : {};
    return new Response(JSON.stringify({ [entity]: { Id: full.includes('/item') ? '1010000474' : '39144', SyncToken: '2', TxnDate: '2026-11-09', ...tax } }), { status: 200 });
  };
  const result = await runBatchRevert(
    { batchId: 'fix-item-1010000474', confirm: true },
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
        row({
          id: 1,
          entity: 'Item',
          tool: 'qbo_item_tax_category',
          created: false,
          action: 'update',
          qboId: '1010000474',
          txnDate: null,
          priorState: { Id: '1010000474', SyncToken: '1', Name: 'Electrical Equipment Pump Panel', Taxable: false, TaxClassificationRef: { value: 'EUC-99990201-V1-00020000' } },
        }),
        row({
          id: 2,
          entity: 'Invoice',
          tool: 'qbo_invoice',
          created: false,
          action: 'update',
          qboId: '39144',
          txnDate: '2026-11-09',
          priorState: { Id: '39144', SyncToken: '0', TotalAmt: 7132.53, TxnTaxDetail: { TxnTaxCodeRef: { value: '3' }, TotalTax: 401.53 } },
        }),
      ],
    }
  );
  assert.equal(result.wrote, true);
  assert.equal(calls.some((call) => call.includes('operation=delete')), false);
  assert.deepEqual(calls.filter((call) => call.startsWith('POST')).sort(), ['POST 2222222222222222/invoice', 'POST 2222222222222222/item']);
  const item = posted.find((body) => body.Id === '1010000474') as { Taxable: boolean; TaxClassificationRef: { value: string } };
  assert.equal(item.Taxable, false);
  assert.equal(item.TaxClassificationRef.value, 'EUC-99990201-V1-00020000');
  const invoice = posted.find((body) => body.Id === '39144') as { TxnTaxDetail: { TotalTax: number } };
  assert.equal(invoice.TxnTaxDetail.TotalTax, 401.53);
  const invoiceStep = (result.results as any[]).find((step: any) => step.entity === 'Invoice') as any;
  assert.equal(invoiceStep.status, 'reverted');
  assert.equal(invoiceStep.taxCodeChanged, null, 'the restore saved code 3, as in prior state');
  const itemStep = (result.results as any[]).find((step: any) => step.entity === 'Item') as any;
  assert.equal('taxCodeChanged' in itemStep, false);
});

test('an invoice restore that QuickBooks re-codes is reported as tax_code_changed, not reverted', async () => {
  const audits: any[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const method = init?.method || 'GET';
    const body = { Invoice: { Id: '39144', SyncToken: method === 'POST' ? '3' : '2', TxnDate: '2026-11-09', TxnTaxDetail: { TxnTaxCodeRef: { value: '24' }, TotalTax: 401.53, TaxLine: [{ TaxLineDetail: { TaxRateRef: { value: '25' }, NetAmountTaxable: 5181 } }] } } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const result = await runBatchRevert(
    { batchId: 'fix-39144-tax', confirm: true },
    {
      env: { QBO_WRITES_ENABLED: 'true', QBO_WRITE_REALM_ID: '2222222222222222', QBO_PRODUCTION_REALM_ID: '9130349321543166' },
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      fetchImpl,
      audit: async (entry) => { audits.push(entry); },
      readCloseDate: async () => null,
      loadBatch: async () => [
        row({
          id: 2, entity: 'Invoice', tool: 'qbo_invoice', created: false, action: 'update', qboId: '39144', txnDate: '2026-11-09',
          priorState: { Id: '39144', SyncToken: '0', TxnTaxDetail: { TxnTaxCodeRef: { value: '3' }, TotalTax: 401.53, TaxLine: [{ TaxLineDetail: { TaxRateRef: { value: '4' }, NetAmountTaxable: 5181 } }] } },
        }),
      ],
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.wrote, true);
  const step = (result.results as any[])[0];
  assert.equal(step.status, 'tax_code_changed');
  assert.equal(step.taxCodeChanged.saved, '24');
  assert.equal((result.couldNot as any[]).length, 1);
  assert.equal(audits.some((entry) => entry.status === 'tax_code_changed' && entry.ok === false), true);
});

test('a tax_code_changed row (ok:false) is a revert target and settles its pending row', () => {
  const prior = { Id: '39144', SyncToken: '1', TxnTaxDetail: { TxnTaxCodeRef: { value: '3' }, TotalTax: 413.15 } };
  const plan = planBatchRevert(
    [
      row({ id: 10, entity: 'Invoice', tool: 'qbo_invoice', action: 'update', ok: false, status: 'pending', requestId: 'fix-39144-tax-02-r1', qboId: '39144', priorState: prior }),
      row({ id: 11, entity: 'Invoice', tool: 'qbo_invoice', action: 'update', ok: false, status: 'tax_code_changed', requestId: 'fix-39144-tax-02-r1', qboId: '39144', priorState: prior, error: 'tax_code_changed: saved 24' }),
    ],
    null
  );
  assert.deepEqual(plan.steps.map((step) => [step.action, step.entity, step.qboId, step.auditId]), [['restore', 'Invoice', '39144', 11]]);
  assert.equal(plan.couldNot.length, 0, 'the pending row is settled by the tax_code_changed outcome');
});

test('a ship-address tax_mismatch update can be restored, and an import tax_mismatch row cannot', () => {
  const prior = { Id: '39170', SyncToken: '0', TxnDate: '2026-10-01', ShipAddr: { Line1: 'Remuda Drive', City: 'Temecula', PostalCode: '92592' } };
  const plan = planBatchRevert(
    [
      row({ id: 1, entity: 'Invoice', tool: 'qbo_invoice', action: 'update', ok: false, status: 'pending', requestId: 'ship-39170', qboId: '39170', priorState: prior, txnDate: null }),
      row({ id: 2, entity: 'Invoice', tool: 'qbo_invoice', action: 'update', ok: false, status: 'tax_mismatch', requestId: 'ship-39170', qboId: '39170', priorState: prior, txnDate: '2026-10-01', error: 'tax_mismatch: TotalTax' }),
      row({ id: 3, entity: 'Invoice', tool: 'qbo_import_jobber_invoices', action: 'create', created: false, ok: false, status: 'tax_mismatch', requestId: 'tax-batch-5901', qboId: '39193', txnDate: '2026-10-01' }),
    ],
    '2024-12-31'
  );
  assert.deepEqual(plan.steps.map((step) => [step.action, step.qboId, step.auditId]), [['restore', '39170', 2]]);
  assert.equal(plan.couldNot.length, 0);
});
