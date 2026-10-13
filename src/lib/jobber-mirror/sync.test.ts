import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsFor, rollingTasks } from './sync.ts';

test('invoice rows strip nested client to id and collect client + job ids', () => {
  const r = rowsFor('invoices', [{ id: 'I1', invoiceStatus: 'paid', issuedDate: '2026-10-01T00:00:00Z', subject: 'Pump', amounts: { subtotal: 100 }, jobs: { nodes: [{ id: 'J1', title: 'Pump repair' }] }, client: { id: 'C1', name: 'A', createdAt: '2025-02-01T00:00:00Z', phones: [{ number: '+1 (760) 555-1212' }] } }]);
  assert.equal(r.table, 'jobber_invoices');
  assert.deepEqual(r.rows[0].job_ids, ['J1']);
  assert.deepEqual(r.rows[0].data.client, { id: 'C1' });
  assert.deepEqual(r.clients[0].phones_digits, ['7605551212']);
});
test('rolling windows: wide covers 200d quotes', () => {
  const t = rollingTasks(new Date('2026-10-12T00:00:00Z'), true).find((x) => x.field === 'quotes')!;
  assert.equal((t.filter.createdAt as any).after.slice(0, 10), '2026-03-26');
});
