import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkItemTaxCategory } from './item-tax-category.ts';

const classes: Record<string, any> = {
  'EUC-99990202-V1-00020000': { Id: 'EUC-99990202-V1-00020000', Name: 'Service marked taxable', ApplicableTo: ['Service'] },
  'EUC-09020802-V1-00120000': { Id: 'EUC-09020802-V1-00120000', Name: 'General taxable retail products', ApplicableTo: ['Inventory', 'NonInventory'] },
};
const item = { Id: '1010000474', Type: 'Service', SyncToken: '1' };

function fakeQuery(seen: string[] = []) {
  return async (sql: string) => {
    seen.push(sql);
    const id = /Id = '([^']+)'/.exec(sql)?.[1] || '';
    if (/from TaxClassification/i.test(sql)) return { QueryResponse: classes[id] ? { TaxClassification: [classes[id]] } : {} };
    if (/from Item/i.test(sql)) return { QueryResponse: id === item.Id ? { Item: [item] } : {} };
    throw new Error(`unexpected ${sql}`);
  };
}

test('checkItemTaxCategory accepts a Service class on a Service item with the live SyncToken', async () => {
  const seen: string[] = [];
  const got = await checkItemTaxCategory({ itemId: '1010000474', taxClassificationId: 'EUC-99990202-V1-00020000', syncToken: '1' }, { qboQuery: fakeQuery(seen) });
  assert.equal(got.ok, true);
  assert.deepEqual(got.ok && got.applicableTo, ['Service']);
  assert.equal(seen.length, 2);
});

test('checkItemTaxCategory refuses a goods class on a Service item', async () => {
  const got = await checkItemTaxCategory({ itemId: '1010000474', taxClassificationId: 'EUC-09020802-V1-00120000', syncToken: '1' }, { qboQuery: fakeQuery() });
  assert.equal(got.ok, false);
  assert.match(!got.ok ? got.error : '', /type Service.*applies only to Inventory, NonInventory/);
});

test('checkItemTaxCategory refuses a class that is not on the TaxClassification list', async () => {
  const got = await checkItemTaxCategory({ itemId: '1010000474', taxClassificationId: 'EUC-12345678-V1-00000000', syncToken: '1' }, { qboQuery: fakeQuery() });
  assert.equal(got.ok, false);
  assert.match(!got.ok ? got.error : '', /not on the QuickBooks TaxClassification list/);
});

test('checkItemTaxCategory refuses a stale SyncToken, a missing item, and a missing SyncToken', async () => {
  const stale = await checkItemTaxCategory({ itemId: '1010000474', taxClassificationId: 'EUC-99990202-V1-00020000', syncToken: '0' }, { qboQuery: fakeQuery() });
  assert.match(!stale.ok ? stale.error : '', /SyncToken 1 in QuickBooks, not 0/);
  const missing = await checkItemTaxCategory({ itemId: '99', taxClassificationId: 'EUC-99990202-V1-00020000', syncToken: '1' }, { qboQuery: fakeQuery() });
  assert.match(!missing.ok ? missing.error : '', /not found/);
  const noToken = await checkItemTaxCategory({ itemId: '1010000474', taxClassificationId: 'EUC-99990202-V1-00020000' }, { qboQuery: fakeQuery() });
  assert.match(!noToken.ok ? noToken.error : '', /syncToken is required/);
});
