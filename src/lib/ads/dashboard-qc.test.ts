import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, hashPhone, type DashCall } from './call-dashboard.ts';
import { buildRoasView } from './roas-view.ts';
import { categoryTotals, buildWeeklySales } from './weekly-sales.ts';
import { workCategory } from './work-category.ts';

const now = new Date('2026-10-09T20:00:00Z');
const call = (o: Partial<DashCall>): DashCall => ({
  started_at: '2026-10-09T15:00:00Z', duration_seconds: 60, campaign_name: 'Leads-Search-1', keyword: null,
  caller_area_code: '951', caller_phone: null, call_status: 'RECEIVED', call_source: 'AD', customer_id: null, jobber_client_id: null, ...o,
});
const conv = (id: string, phone: string, at: string) => ({
  jobber_job_id: id, conversion_at: at, value_usd: 200,
  payload: { conversion: { user_identifiers: [{ hashed_phone_number: hashPhone(phone) }] }, stages: { booking: 200, approved: 200, invoiced: 999 } },
});

test('funnel stages share one job set; live Jobber money replaces stale stages; paid = fully paid', () => {
  const d = buildDashboard({
    now, range: '7', spend: [{ date: '2026-10-08', campaign: 'Leads-Search-1', costUsd: 100 }], paidByJob: null,
    calls: [call({ caller_phone: '9515550001' }), call({ caller_phone: '9515550002' })],
    conversions: [conv('j1', '9515550001', '2026-10-09T16:00:00Z'), conv('j2', '9515550002', '2026-10-09T16:00:00Z'), conv('j3', '9515559999', '2026-10-09T16:00:00Z')],
    jobMoney: new Map([['j1', { invoiced: 500, paid: 500, invoiceCount: 1, fullyPaid: true }], ['j2', { invoiced: 300, paid: 100, invoiceCount: 1, fullyPaid: false }]]),
  });
  assert.deepEqual([d.funnel!.booked, d.funnel!.invoiced, d.funnel!.paid, d.funnel!.partPaid], [2, 2, 1, 1]);
  assert.equal(d.totals.invoicedValue, 800);
  assert.equal(d.totals.paidValue, 600);
  assert.equal(d.bookedCredited!.length, 2); // j3 has no call -> not a credited booking
});

test('ROAS overall vs new-only from Jobber invoices', () => {
  const r = buildRoasView({
    now, start: new Date('2026-09-18T07:00:00Z'), spend: [{ date: '2026-10-01', campaign: 'Leads-Search-1', costUsd: 100 }],
    adCalls: [{ started_at: '2026-10-01T16:00:00Z', caller_phone: '9515550001', campaign_name: 'Leads-Search-1' }, { started_at: '2026-10-01T16:00:00Z', caller_phone: '9515550002', campaign_name: 'Leads-Search-Drilling' }],
    invoices: [
      { invoiceStatus: 'paid', issuedDate: '2026-10-03T16:00:00Z', amounts: { subtotal: 400, total: 400, taxAmount: 0, paymentsTotal: 400 }, client: { id: 'new', createdAt: '2026-10-01T17:00:00Z', phones: [{ number: '(951) 555-0001' }] } },
      { invoiceStatus: 'awaiting_payment', issuedDate: '2026-10-03T16:00:00Z', amounts: { subtotal: 600, total: 600, taxAmount: 0, paymentsTotal: 0 }, client: { id: 'old', createdAt: '2025-01-01T00:00:00Z', phones: [{ number: '9515550002' }] } },
      { invoiceStatus: 'paid', issuedDate: '2026-09-30T16:00:00Z', amounts: { subtotal: 900, total: 900, taxAmount: 0, paymentsTotal: 900 }, client: { id: 'new', createdAt: '2026-10-01T17:00:00Z', phones: [{ number: '9515550001' }] } },
      { invoiceStatus: 'draft', issuedDate: '2026-10-03T16:00:00Z', amounts: { subtotal: 50, total: 50, taxAmount: 0, paymentsTotal: 0 }, client: { id: 'new', phones: [{ number: '9515550001' }] } },
    ],
  })!;
  assert.equal(r.overall.invoiced, 1000); // pre-call invoice and draft excluded
  assert.equal(r.newOnly.invoiced, 400);
  assert.equal(r.overall.multipleInvoiced, 10);
  assert.equal(r.newOnly.multiplePaid, 4);
  assert.equal(r.byCategory.drilling.overall.invoiced, 600);
});

test('drilling/pump/service-call split and unsent converted quotes are not approvals', () => {
  assert.equal(workCategory('New Well Drilling'), 'drilling');
  assert.equal(workCategory('Service Call '), 'service_call');
  assert.equal(workCategory('Replace Booster'), 'pump');
  const input = {
    now, invoices: [], jobsCreated: [{ title: 'Drill site walk', createdAt: '2026-10-06T16:00:00Z' }], jobsCompleted: [], callTimes: [], bookedAt: [],
    quotes: [
      { title: 'New Well Drilling', quoteStatus: 'awaiting_response', sentAt: '2026-10-06T16:00:00Z', amounts: { subtotal: 50000 } },
      { title: 'Service Call', quoteStatus: 'converted', sentAt: null, transitionedAt: '2026-10-06T16:00:00Z', amounts: { subtotal: 200 } },
      { title: 'Replace Booster', quoteStatus: 'approved', sentAt: '2026-10-06T16:00:00Z', transitionedAt: '2026-10-07T16:00:00Z', amounts: { subtotal: 1500 } },
    ],
  };
  const c = categoryTotals(input, '2026-10-05', '2026-10-09')!;
  assert.equal(c.drilling.quotesSentValue, 50000);
  assert.equal(c.drilling.jobsBooked, 1);
  assert.equal(c.service_call.quotesApproved, 0);
  assert.equal(c.pump.quotesApproved, 1);
  const w = buildWeeklySales({ ...input, range: { range: '7', startKey: '2026-10-03', endKey: '2026-10-09', name: '7' } });
  assert.equal(w.totals!.quotesApproved, 1);
});
