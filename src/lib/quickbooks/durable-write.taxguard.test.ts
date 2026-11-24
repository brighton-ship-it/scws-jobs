import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runQboPlan } from './durable-write.ts';
import { buildInvoice } from './write-payloads.ts';

const live = {
  Id: '39144',
  SyncToken: '1',
  ShipFromAddr: { Id: '46097', Line1: '8770 Harbison Canyon Road', City: 'Alpine', PostalCode: '91901' },
  Line: [
    { Id: '1', LineNum: 1, Amount: 5181, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '334' }, TaxCodeRef: { value: 'TAX' } } },
    { Id: '3', LineNum: 3, Amount: 150, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '1010000474' }, TaxCodeRef: { value: 'TAX' } } },
  ],
};

async function confirmWith(saved: { code: string; rates: string[]; net: number }) {
  const audits: any[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    if ((init?.method || 'GET') === 'GET') return new Response(JSON.stringify({ Invoice: live }), { status: 200 });
    const TaxLine = saved.rates.map((id) => ({ TaxLineDetail: { TaxRateRef: { value: id }, NetAmountTaxable: saved.net } }));
    return new Response(JSON.stringify({ Invoice: { Id: '39144', SyncToken: '2', TxnTaxDetail: { TxnTaxCodeRef: { value: saved.code }, TaxLine } } }), { status: 200 });
  };
  const plan = buildInvoice({ id: '39144', syncToken: '1', txnTaxCodeId: '3', retaxLineIds: ['3'] });
  const result = await runQboPlan(plan, { confirm: true, batchId: 'fix-39144-tax-02', requestId: 'fix-39144-tax-02-r1' }, {
    env: { QBO_WRITES_ENABLED: 'true', QBO_WRITE_REALM_ID: '2222222222222222', QBO_PRODUCTION_REALM_ID: '9130349321543166' } as any,
    productionRealmId: '9130349321543166',
    accessToken: 'tok',
    fetchImpl,
    audit: async (entry) => { audits.push(entry); },
  });
  return { result, audits };
}

test('a retax that QuickBooks re-codes returns ok:false and audits status tax_code_changed', async () => {
  const { result, audits } = await confirmWith({ code: '24', rates: ['3', '5', '25'], net: 5331 });
  assert.equal(result.wrote, true);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'tax_code_changed');
  assert.equal(result.taxCodeChanged?.saved, '24');
  assert.match(result.error || '', /tax_code_changed/);
  const last = audits[audits.length - 1];
  assert.equal(last.status, 'tax_code_changed');
  assert.equal(last.ok, false);
  assert.equal(last.qboIds.id, '39144');
});

test('a retax saved on code 3 with rate 4 and the full taxable amount is ok', async () => {
  const { result, audits } = await confirmWith({ code: '3', rates: ['3', '4', '5'], net: 5331 });
  assert.equal(result.ok, true);
  assert.equal(result.taxCodeChanged, null);
  assert.equal(audits[audits.length - 1].status, 'ok');
});

test('a retax that keeps the old taxable amount is flagged', async () => {
  const { result } = await confirmWith({ code: '3', rates: ['3', '4', '5'], net: 5181 });
  assert.equal(result.ok, false);
  assert.match(result.taxCodeChanged?.reasons.join(' ') || '', /NetAmountTaxable is 5181, expected 5331/);
});
