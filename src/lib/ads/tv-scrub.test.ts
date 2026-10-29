import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubForTv } from './tv-scrub.ts';

test('TV payload carries no invoice follow-up, balances, or payment figures', () => {
  const out = scrubForTv({
    invoiceFollowUp: { count: 2, totalOwed: 500, rows: [{ name: 'A', balance: 300 }] },
    weekly: { weeks: [{ invoiced: 100, paid: 50, cash: 40, cashCount: 1 }], totals: { invoiced: 100, paid: 50, cash: 40 }, sources: ['Paid = payments'] },
    roas: { spend: 10, newOnly: { invoiced: 30, paid: 20, paidClients: 1, multipleInvoiced: 3 }, overall: { invoiced: 60, paid: 30 }, method: ['Paid ...'] },
    needsCallback: { count: 1, rows: [{ phone: '1', balance: null, pastDue: false }] },
    gaps: ['open invoices: x'],
    missedCallTexts: { sent: 1, rows: [{ phone: '6195550142', body: 'Sorry we missed your call', replies: [{ body: 'No water' }] }] },
  });
  const text = JSON.stringify(out);
  assert.ok(!('invoiceFollowUp' in out));
  assert.ok(!/"(paid|cash|balance|totalOwed)":\s*[0-9]/.test(text), text);
  assert.equal((out as any).weekly.weeks[0].invoiced, 100);
  assert.equal((out as any).roas.newOnly.multipleInvoiced, 3);
  assert.ok(!('gaps' in out));
  assert.ok(!('missedCallTexts' in out));
  assert.equal(text.includes('6195550142'), false);
  assert.equal(text.includes('No water'), false);
});
