import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInvoiceRetax } from './invoice-retax.ts';
import { taxCodeChangeOf } from './durable-write.ts';
import { buildInvoice } from './write-payloads.ts';

const invoice = {
  Id: '39144',
  SyncToken: '1',
  ShipFromAddr: { Line1: '8770 Harbison Canyon Road', City: 'Alpine' },
  Line: [{ Id: '3', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '1010000474' } } }],
};

function query(item: Record<string, unknown>) {
  return async (sql: string) => (/from Invoice/.test(sql) ? { QueryResponse: { Invoice: [invoice] } } : { QueryResponse: { Item: [item] } });
}

test('checkInvoiceRetax refuses while the line item is not Taxable, then passes after the item fix', async () => {
  const before = await checkInvoiceRetax({ id: '39144', syncToken: '1', retaxLineIds: ['3'] }, { qboQuery: query({ Id: '1010000474', Taxable: false, TaxClassificationRef: { value: 'EUC-99990201-V1-00020000' } }) });
  assert.equal(before.ok, false);
  assert.match(!before.ok ? before.error : '', /not Taxable.*EUC-99990201/);
  const after = await checkInvoiceRetax({ id: '39144', syncToken: '1', retaxLineIds: ['3'] }, { qboQuery: query({ Id: '1010000474', Taxable: true, TaxClassificationRef: { value: 'EUC-99990202-V1-00020000' } }) });
  assert.equal(after.ok, true);
  assert.equal(after.ok && after.items[0].taxClassificationId, 'EUC-99990202-V1-00020000');
});

test('checkInvoiceRetax refuses a stale SyncToken and a missing line', async () => {
  const item = { Id: '1010000474', Taxable: true };
  const stale = await checkInvoiceRetax({ id: '39144', syncToken: '0', retaxLineIds: ['3'] }, { qboQuery: query(item) });
  assert.match(!stale.ok ? stale.error : '', /SyncToken 1 in QuickBooks, not 0/);
  const missing = await checkInvoiceRetax({ id: '39144', syncToken: '1', retaxLineIds: ['7'] }, { qboQuery: query(item) });
  assert.match(!missing.ok ? missing.error : '', /no sales line 7/);
});

test('taxCodeChangeOf flags a saved code that differs from the requested one, only for invoices that expect one', () => {
  const plan = buildInvoice({ id: '39144', syncToken: '0', totalTax: 413.15, txnTaxCodeId: '3' });
  assert.deepEqual(taxCodeChangeOf(plan, { Invoice: { TxnTaxDetail: { TxnTaxCodeRef: { value: '24' } } } }), { requested: '3', saved: '24' });
  assert.equal(taxCodeChangeOf(plan, { Invoice: { TxnTaxDetail: { TxnTaxCodeRef: { value: '3' } } } }), null);
  const plain = buildInvoice({ id: '39144', syncToken: '0', dueDate: '2026-12-01' });
  assert.equal(taxCodeChangeOf(plain, { Invoice: { TxnTaxDetail: { TxnTaxCodeRef: { value: '24' } } } }), null);
});
