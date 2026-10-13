import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoicePretaxUsd } from './invoice-value.ts';
import { workCategory, isSiteVisit } from './work-category.ts';
import { categoryTotals, buildWeeklySales } from './weekly-sales.ts';

test('pre-tax invoice value subtracts the invoice discount (Jobber subtotal is pre-discount)', () => {
  // #5834: subtotal 23,346, discount 1,725, tax 1,379.27, total 23,000.27
  assert.equal(invoicePretaxUsd({ invoiceStatus: 'past_due', amounts: { subtotal: 23346, discountAmount: 1725, taxAmount: 1379.27, total: 23000.27 } }), 21621);
  assert.equal(invoicePretaxUsd({ invoiceStatus: 'paid', amounts: { subtotal: 200, discountAmount: 0, total: 200 } }), 200);
  assert.equal(invoicePretaxUsd({ invoiceStatus: 'paid', amounts: { subtotal: 200, total: 200 } }), 200);
});

test('drill site walks are site visits; pulls "with drill rig" are pump work', () => {
  assert.equal(workCategory('Pull on Fishing & Pump Equipment with Drill Rig'), 'pump');
  assert.equal(workCategory('Drill site walk'), 'drilling');
  assert.ok(isSiteVisit('Drill site walk') && isSiteVisit('Drilling site walk') && isSiteVisit('Site Visit For Pump System') && isSiteVisit('Walk-through - 5K Poly Tank'));
  assert.ok(!isSiteVisit('New Well Drilling') && !isSiteVisit('Service Call'));
  assert.equal(workCategory('New Well Drilling'), 'drilling');
  assert.equal(workCategory('Well Destruction'), 'drilling');
  assert.equal(workCategory('Service Call - no water'), 'service_call');
});

test('type cards: site walks counted apart from drilling jobs booked', () => {
  const at = '2026-10-05T18:00:00Z';
  const c = categoryTotals({ invoices: [], quotes: [], jobsCreated: [{ title: 'Drill site walk', createdAt: at }, { title: 'New Well Drilling', createdAt: at }, { title: 'Pull on Fishing & Pump Equipment with Drill Rig', createdAt: at }], jobsCompleted: [], callTimes: [], bookedAt: [] }, '2026-10-01', '2026-10-12')!;
  assert.equal(c.drilling.jobsBooked, 1);
  assert.equal(c.drilling.siteVisits, 1);
  assert.equal(c.pump.jobsBooked, 1);
});

test('headline quote counts exclude service-call quotes; approvals counted by approval date even for old quotes', () => {
  const w = buildWeeklySales({
    now: new Date('2026-10-12T20:00:00Z'), invoices: [], jobsCreated: [], jobsCompleted: [], callTimes: [], bookedAt: [],
    quotes: [
      { title: 'Service Call', quoteStatus: 'converted', sentAt: '2026-10-02T17:00:00Z', transitionedAt: '2026-10-02T18:00:00Z', amounts: { subtotal: 200 } },
      { title: 'Replace Booster', quoteStatus: 'approved', sentAt: '2026-10-02T17:00:00Z', transitionedAt: '2026-10-03T18:00:00Z', amounts: { subtotal: 3000 } },
      { title: 'New Well Drilling', quoteStatus: 'approved', sentAt: '2026-02-06T23:33:07Z', transitionedAt: '2026-10-05T18:48:35Z', amounts: { subtotal: 26250 } },
    ],
    range: { range: 'month', startKey: '2026-10-01', endKey: '2026-10-12', name: 'month' },
  });
  assert.equal(w.totals!.quotesSent, 1);
  assert.equal(w.totals!.quotesApproved, 2);
  assert.equal(w.totals!.quotesApprovedValue, 29250);
  assert.equal(w.totals!.byCategory!.service_call.quotesApproved, 1);
});
