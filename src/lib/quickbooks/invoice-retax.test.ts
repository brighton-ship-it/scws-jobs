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

const taxLines = (ids: string[], net: number) => ids.map((id) => ({ DetailType: 'TaxLineDetail', Amount: 1, TaxLineDetail: { TaxRateRef: { value: id }, NetAmountTaxable: net } }));

test('taxCodeChangeOf checks the header code, the county rate and NetAmountTaxable', () => {
  const plan = buildInvoice({ id: '39144', syncToken: '0', totalTax: 413.15, txnTaxCodeId: '3' });
  const as24 = taxCodeChangeOf(plan, { Invoice: { TxnTaxDetail: { TxnTaxCodeRef: { value: '24' }, TaxLine: taxLines(['3', '5', '25'], 5181) } } });
  assert.equal(as24?.saved, '24');
  assert.equal(as24?.reasons.length, 3, 'code, missing rate 4, and rate 25 present');
  assert.equal(taxCodeChangeOf(plan, { Invoice: { TxnTaxDetail: { TxnTaxCodeRef: { value: '3' }, TaxLine: taxLines(['3', '4', '5'], 5181) } } }), null);
  const wrongCounty = taxCodeChangeOf(plan, { Invoice: { TxnTaxDetail: { TxnTaxCodeRef: { value: '3' }, TaxLine: taxLines(['3', '25', '5'], 5181) } } });
  assert.match(wrongCounty?.reasons.join(' ') || '', /do not include county rate 4.*other county rate 25/);
  const plain = buildInvoice({ id: '39144', syncToken: '0', dueDate: '2026-12-01' });
  assert.equal(taxCodeChangeOf(plain, { Invoice: { TxnTaxDetail: { TxnTaxCodeRef: { value: '24' } } } }), null);
});

test('taxCodeChangeOf on a retax compares NetAmountTaxable with the posted TAX lines', () => {
  const plan = buildInvoice({ id: '39144', syncToken: '1', txnTaxCodeId: '3', retaxLineIds: ['3'] });
  const body = { Line: [
    { DetailType: 'SalesItemLineDetail', Amount: 5181, SalesItemLineDetail: { TaxCodeRef: { value: 'TAX' } } },
    { DetailType: 'SalesItemLineDetail', Amount: 150, SalesItemLineDetail: { TaxCodeRef: { value: 'TAX' } } },
    { DetailType: 'SalesItemLineDetail', Amount: 1400, SalesItemLineDetail: { TaxCodeRef: { value: 'NON' } } },
  ] };
  const stillOld = taxCodeChangeOf(plan, { Invoice: { TxnTaxDetail: { TxnTaxCodeRef: { value: '3' }, TaxLine: taxLines(['3', '4', '5'], 5181) } } }, body);
  assert.match(stillOld?.reasons.join(' ') || '', /NetAmountTaxable is 5181, expected 5331/);
  assert.equal(taxCodeChangeOf(plan, { Invoice: { TxnTaxDetail: { TxnTaxCodeRef: { value: '3' }, TaxLine: taxLines(['3', '4', '5'], 5331) } } }, body), null);
});

test('checkInvoiceRetax refuses an invoice with a discount, description-only or group line', async () => {
  for (const DetailType of ['DiscountLineDetail', 'DescriptionOnly', 'GroupLineDetail']) {
    const withOther = { ...invoice, Line: [...invoice.Line, { Id: '9', DetailType, Amount: 0 }] };
    const qboQuery = async (sql: string) => (/from Invoice/.test(sql) ? { QueryResponse: { Invoice: [withOther] } } : { QueryResponse: { Item: [{ Id: '1010000474', Taxable: true }] } });
    const got = await checkInvoiceRetax({ id: '39144', syncToken: '1', retaxLineIds: ['3'] }, { qboQuery });
    assert.match(!got.ok ? got.error : '', new RegExp(`${DetailType} lines`));
  }
});
