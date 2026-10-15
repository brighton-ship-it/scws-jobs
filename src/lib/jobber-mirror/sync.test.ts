import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsFor, rollingTasks } from './sync.ts';

test('invoice rows strip nested client to id and collect client + job ids', () => {
  const r = rowsFor('invoices', [{ id: 'I1', invoiceNumber: '5806', invoiceStatus: 'paid', issuedDate: '2026-10-01T00:00:00Z', dueDate: '2026-10-15T00:00:00Z', subject: 'Pump', amounts: { subtotal: 100 }, jobs: { nodes: [{ id: 'J1', title: 'Pump repair' }] }, client: { id: 'C1', name: 'A', createdAt: '2025-02-01T00:00:00Z', phones: [{ number: '+1 (760) 555-1212' }], emails: [{ address: 'Nancy@Example.com' }, { address: 'nancy@example.com' }] } }]);
  assert.equal(r.table, 'jobber_invoices');
  assert.equal(r.rows[0].data.invoiceNumber, '5806');
  assert.equal(r.rows[0].data.dueDate, '2026-10-15T00:00:00Z');
  assert.deepEqual(r.rows[0].job_ids, ['J1']);
  assert.deepEqual(r.rows[0].data.client, { id: 'C1' });
  assert.deepEqual(r.clients[0].phones_digits, ['7605551212']);
  assert.deepEqual(r.clients[0].data.emails, ['nancy@example.com']);
});
test('quote rows keep client phones for callback exclusion', () => {
  const r = rowsFor('quotes', [{ id: 'Q1', quoteStatus: 'awaiting_response', createdAt: '2026-10-14T18:00:00Z', updatedAt: '2026-10-14T18:00:00Z', client: { id: 'C9', name: 'Pat', phones: [{ number: '+1 (760) 555-0199' }] } }]);
  assert.equal(r.table, 'jobber_quotes');
  assert.equal(r.rows[0].data.client.phones[0].number, '+1 (760) 555-0199');
  assert.deepEqual(r.clients[0].phones_digits, ['7605550199']);
});
test('rolling windows: wide covers 200d quotes', () => {
  const t = rollingTasks(new Date('2026-10-12T00:00:00Z'), true).find((x) => x.field === 'quotes')!;
  assert.equal((t.filter.createdAt as any).after.slice(0, 10), '2026-03-26');
  assert.ok(rollingTasks(new Date(), false).some((x) => x.field === 'quotes' && (x.filter as any).status === 'approved'));
  assert.ok(rollingTasks(new Date(), false).some((x) => x.field === 'jobs' && (x.filter as any).status === 'archived'));
});
