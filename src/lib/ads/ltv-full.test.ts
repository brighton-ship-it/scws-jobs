import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFullHistory, summarize, normName } from './ltv-full.ts';

test('merges QuickBooks + Jobber by name and drops Feb 25+ duplicates', () => {
  assert.equal(normName('Smith, John & Mary (OLD)'), normName('john smith mary'));
  const f = mergeFullHistory({ source: 't', customers: [[normName('John Smith'), 0, [['2023-01-01', 1000], ['2025-02-27', 500, '9']]], [normName('Old Only'), 1, [['2022-05-01', 30000]]]] }, [
    { id: 'i1', invoiceStatus: 'paid', issuedDate: '2025-02-28T18:00:00Z', subject: 'Pump', amounts: { subtotal: 500 }, client: { id: 'c1', name: 'John Smith' } },
    { id: 'i2', invoiceStatus: 'draft', issuedDate: '2025-06-01T18:00:00Z', amounts: { subtotal: 9 }, client: { id: 'c1', name: 'John Smith' } },
  ]);
  assert.equal(f.droppedDupes, 1);
  const s = summarize(f.customers);
  assert.equal(s.n, 2); assert.equal(s.total, 31500); assert.equal(s.repeat60, 1);
  assert.equal(f.customers.find((c) => c.source === 'qbo')!.dept, 'drilling');
});
