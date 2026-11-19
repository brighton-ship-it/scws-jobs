import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPurchaseAccounts,
  buildInvoice,
  buildJournalEntry,
  buildQboPlan,
  buildVoid,
  preferencesCloseDateBody,
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
