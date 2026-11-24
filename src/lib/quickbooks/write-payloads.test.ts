import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRead,
  applyPurchaseAccounts,
  buildDeposit,
  buildInvoice,
  buildItemTaxCategory,
  buildJournalEntry,
  buildQboPlan,
  buildVoid,
  preferencesCloseDateBody,
  replaceDepositSalesLine,
  resolveRequestId,
} from './write-payloads.ts';

const lines = [
  { postingType: 'Debit', amount: 12.5, accountId: '80', description: 'Supplies' },
  { postingType: 'Credit', amount: 12.5, accountId: '35' },
];

test('journal preview body balances and has no delete operation', () => {
  const plan = buildJournalEntry({ lines, txnDate: '2026-10-31', privateNote: 'month-end', docNumber: 'JE-1' });
  assert.equal(plan.action, 'create');
  assert.equal(plan.path, '/journalentry');
  assert.equal(plan.operation, undefined);
  assert.deepEqual(plan.body, {
    TxnDate: '2026-10-31',
    PrivateNote: 'month-end',
    DocNumber: 'JE-1',
    Line: [
      {
        Description: 'Supplies',
        Amount: 12.5,
        DetailType: 'JournalEntryLineDetail',
        JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: '80' } },
      },
      {
        Amount: 12.5,
        DetailType: 'JournalEntryLineDetail',
        JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: '35' } },
      },
    ],
  });
  assert.throws(() => buildJournalEntry({ lines: [{ postingType: 'Debit', amount: 1, accountId: '1' }] }), /balance/);
});

test('identical payloads share a request id and a different amount does not', () => {
  const plan = buildJournalEntry({ lines, txnDate: '2026-10-31' });
  const again = buildJournalEntry({ lines, txnDate: '2026-10-31' });
  const other = buildJournalEntry({
    lines: [
      { postingType: 'Debit', amount: 12.51, accountId: '80' },
      { postingType: 'Credit', amount: 12.51, accountId: '35' },
    ],
    txnDate: '2026-10-31',
  });
  assert.equal(resolveRequestId('qbo_journal_entry', plan.body), resolveRequestId('qbo_journal_entry', again.body));
  assert.notEqual(resolveRequestId('qbo_journal_entry', plan.body), resolveRequestId('qbo_journal_entry', other.body));
  assert.equal(resolveRequestId('qbo_journal_entry', plan.body, 'retry-key-1'), 'retry-key-1');
});

test('invoice body never asks QuickBooks to email', () => {
  const plan = buildInvoice({
    customerId: '10',
    docNumber: '5830',
    txnDate: '2026-10-01',
    lines: [{ amount: 40, itemId: '3', description: 'Service', quantity: 1, unitPrice: 40 }],
  });
  const body = plan.body || {};
  assert.equal(body.DocNumber, '5830');
  assert.equal('EmailStatus' in body, false);
  assert.equal('BillEmail' in body, false);
  const stamped = buildInvoice({
    customerId: '10',
    docNumber: '5831',
    privateNote: 'shop copy',
    batchId: 'oct-2026',
    lines: [{ amount: 40, itemId: '3', quantity: 1, unitPrice: 40 }],
  });
  assert.equal(stamped.body?.PrivateNote, 'shop copy [batch:oct-2026]');
  const again = buildInvoice({
    customerId: '10',
    docNumber: '5831',
    privateNote: 'shop copy [batch:oct-2026]',
    batchId: 'oct-2026',
    lines: [{ amount: 40, itemId: '3', quantity: 1, unitPrice: 40 }],
  });
  assert.equal(again.body?.PrivateNote, 'shop copy [batch:oct-2026]');
  const update = buildInvoice({ id: '44', syncToken: '2', privateNote: 'follow up', batchId: 'oct-2026' });
  assert.equal(update.read?.apply, 'appendPrivateNote');
  assert.equal('PrivateNote' in (update.body || {}), false);
  const untouched = buildInvoice({ id: '44', syncToken: '2', txnDate: '2026-10-02', batchId: 'oct-2026' });
  assert.equal(untouched.read, undefined);
  assert.equal('PrivateNote' in (untouched.body || {}), false);
  const appended = applyRead(update, { Invoice: { Id: '44', SyncToken: '9', PrivateNote: 'shop copy [batch:oct-2026]' } });
  assert.equal(appended.PrivateNote, 'shop copy [batch:oct-2026]\nfollow up');
  const appendedAgain = applyRead(update, { Invoice: { Id: '44', SyncToken: '9', PrivateNote: appended.PrivateNote } });
  assert.equal(appendedAgain.PrivateNote, appended.PrivateNote);
});

test('purchase account update and books close date are exact', () => {
  const updated = applyPurchaseAccounts(
    {
      Id: '5',
      SyncToken: '3',
      MetaData: { CreateTime: 'x' },
      Line: [
        {
          Id: '1',
          Amount: 10,
          AccountBasedExpenseLineDetail: { AccountRef: { value: '9' }, BillableStatus: 'NotBillable' },
        },
      ],
    },
    [{ lineId: '1', accountId: '80' }],
    'coded'
  );
  assert.equal(updated.SyncToken, '3');
  assert.equal((updated.MetaData as unknown) ?? null, null);
  const line = (updated.Line as Record<string, unknown>[])[0];
  const detail = line.AccountBasedExpenseLineDetail as { AccountRef: { value: string } };
  assert.equal(detail.AccountRef.value, '80');
  assert.equal(updated.PrivateNote, 'coded');

  const prefs = preferencesCloseDateBody({ Id: '1', SyncToken: '4' }, '2026-10-31');
  assert.deepEqual(prefs, {
    Id: '1',
    SyncToken: '4',
    sparse: true,
    AccountingInfoPrefs: { BookCloseDate: '2026-10-31' },
  });
  assert.equal(JSON.stringify(prefs).includes('password'), false);
});

test('void is operation=void for an invoice or payment only', () => {
  const plan = buildVoid({ entityType: 'Invoice', entityId: '44', syncToken: '2', reason: 'duplicate backfill' });
  assert.equal(plan.operation, 'void');
  assert.equal(plan.path, '/invoice');
  assert.deepEqual(plan.body, { Id: '44', SyncToken: '2', sparse: true });
  assert.throws(() => buildQboPlan('qbo_void', { entityType: 'JournalEntry', entityId: '1', reason: 'nope' }), /only voids/);
  assert.throws(() => buildQboPlan('qbo_delete_invoice', {}), /Unknown QuickBooks write tool/);
});

test('a deposit fee line is negative and a sales line relinks to a payment of the same amount', () => {
  const deposit = buildDeposit({
    depositToAccountId: '90',
    txnDate: '2026-10-02',
    lines: [
      { amount: 100, paymentId: '50' },
      { amount: -2.5, accountId: '81', description: 'Jobber fee' },
    ],
  });
  const lines = (deposit.body?.Line || []) as Array<{ Amount: number }>;
  assert.equal(lines[1].Amount, -2.5);
  assert.equal(lines.reduce((sum, line) => sum + line.Amount, 0), 97.5);
  assert.throws(() => buildDeposit({ depositToAccountId: '90', lines: [{ amount: -1, paymentId: '50' }] }), /greater than 0/);

  const updated = replaceDepositSalesLine(
    {
      Id: '9',
      SyncToken: '2',
      Line: [
        { Id: '1', Amount: 100, DepositLineDetail: { AccountRef: { value: '35', name: '4010 Sales' } } },
        { Id: '2', Amount: 10, DepositLineDetail: { AccountRef: { value: '80' } } },
      ],
    },
    { amount: 100, salesAccountId: '35', paymentId: '50' }
  );
  const next = updated.Line as Array<{ Amount: number; DepositLineDetail?: unknown; LinkedTxn?: Array<{ TxnId: string }> }>;
  assert.equal(next.some((line) => line.DepositLineDetail && (line.DepositLineDetail as { AccountRef: { value: string } }).AccountRef.value === '35'), false);
  assert.equal(next.find((line) => line.LinkedTxn)?.LinkedTxn?.[0].TxnId, '50');
  assert.equal(next.reduce((sum, line) => sum + line.Amount, 0), 110);
});

test('qbo_invoice totalTax sparse-sets a tax override on an existing invoice only', () => {
  const plan = buildInvoice({ id: '39144', syncToken: '0', totalTax: 413.15, txnTaxCodeId: '3' });
  assert.deepEqual(plan.body, { TxnTaxDetail: { TxnTaxCodeRef: { value: '3' }, TotalTax: 413.15 }, Id: '39144', sparse: true, SyncToken: '0' });
  assert.deepEqual(plan.read, { path: '/invoice/39144', apply: 'syncToken' }, 'a tax override always reads the invoice first so prior_state is audited for revert');
  assert.deepEqual(plan.changes, { expectedSyncToken: '0', totalTax: 413.15 });
  assert.throws(() => buildInvoice({ customerId: '1', lines: [{ amount: 1, itemId: '23' }], totalTax: 1, txnTaxCodeId: '3' }), /only for an invoice update/);
  assert.throws(() => buildInvoice({ id: '39144', lines: [{ amount: 1, itemId: '23' }], totalTax: 1, txnTaxCodeId: '3' }), /cannot be combined with lines/);
  assert.throws(() => buildInvoice({ id: '39144', syncToken: '0', totalTax: 1 }), /txnTaxCodeId/);
  assert.throws(() => buildInvoice({ id: '39144', totalTax: 1, txnTaxCodeId: '3' }), /needs syncToken/);
  assert.throws(() => buildInvoice({ id: '39144', syncToken: '0', totalTax: 1, txnTaxCodeId: '3', privateNote: 'x' }), /privateNote/);
});

test('qbo_invoice totalTax confirm refuses when the live SyncToken is not the one passed', () => {
  const plan = buildInvoice({ id: '39144', syncToken: '0', totalTax: 413.15, txnTaxCodeId: '3' });
  assert.throws(() => applyRead(plan, { Invoice: { Id: '39144', SyncToken: '1' } }), /SyncToken 1 in QuickBooks, not 0/);
  const body = applyRead(plan, { Invoice: { Id: '39144', SyncToken: '0' } });
  assert.equal(body.SyncToken, '0');
  assert.deepEqual(body.TxnTaxDetail, { TxnTaxCodeRef: { value: '3' }, TotalTax: 413.15 });
});

test('qbo_item_tax_category is a sparse Item update that reads prior state first', () => {
  const plan = buildItemTaxCategory({ itemId: '1010000474', taxClassificationId: 'EUC-99990202-V1-00020000', taxable: true, syncToken: '1', applicableTo: ['Service'] });
  assert.equal(plan.entity, 'Item');
  assert.equal(plan.action, 'update');
  assert.deepEqual(plan.body, { Id: '1010000474', SyncToken: '1', sparse: true, TaxClassificationRef: { value: 'EUC-99990202-V1-00020000' }, Taxable: true });
  assert.deepEqual(plan.read, { path: '/item/1010000474', apply: 'itemTaxCategory' });
  assert.throws(() => buildItemTaxCategory({ itemId: '1', taxClassificationId: 'goods', syncToken: '1', applicableTo: ['Service'] }), /taxClassificationId/);
  assert.throws(() => buildItemTaxCategory({ itemId: '1', taxClassificationId: 'EUC-99990202-V1-00020000', applicableTo: ['Service'] }), /syncToken is required/);
  assert.throws(() => buildItemTaxCategory({ itemId: '1', taxClassificationId: 'EUC-99990202-V1-00020000', syncToken: '1' }), /TaxClassification list/);
  assert.equal(buildQboPlan('qbo_item_tax_category', { itemId: '1', taxClassificationId: 'EUC-99990202-V1-00020000', syncToken: '1', applicableTo: ['Service'] }).tool, 'qbo_item_tax_category');
});

test('qbo_item_tax_category confirm refuses a changed SyncToken or an item type the class does not apply to', () => {
  const plan = buildItemTaxCategory({ itemId: '1010000474', taxClassificationId: 'EUC-99990202-V1-00020000', taxable: true, syncToken: '1', applicableTo: ['Service'] });
  assert.throws(() => applyRead(plan, { Item: { Id: '1010000474', SyncToken: '2', Type: 'Service' } }), /SyncToken 2 in QuickBooks, not 1/);
  assert.throws(() => applyRead(plan, { Item: { Id: '1010000474', SyncToken: '1', Type: 'NonInventory' } }), /type NonInventory/);
  const body = applyRead(plan, { Item: { Id: '1010000474', SyncToken: '1', Type: 'Service' } });
  assert.deepEqual(body, { Id: '1010000474', SyncToken: '1', sparse: true, TaxClassificationRef: { value: 'EUC-99990202-V1-00020000' }, Taxable: true });
});
