/**
 * Scenario tests for the /ops dashboards: one test per real-world situation found in the Jobber / call data
 * (fixtures are anonymized copies of real records; numbers kept). See /workspace/qc/scenario-audit/REPORT.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoicePretaxUsd, isIssuedInvoice } from './invoice-value.ts';
import { workCategory, isSiteVisit } from './work-category.ts';
import { categoryTotals, buildWeeklySales, invoiceTitle, quoteValue, jobberDateKey } from './weekly-sales.ts';
import { classifyRealLeads } from './real-leads.ts';
import { buildRoasView, buildBlendedRoas } from './roas-view.ts';

const R = (startKey: string, endKey: string) => ({ range: 'x', startKey, endKey, name: 'x' });
const base = { invoices: [], quotes: [], jobsCreated: [], jobsCompleted: [], callTimes: [], bookedAt: [] };

test('S01 invoice discount: pre-tax = subtotal − discount (#5834)', () => {
  assert.equal(invoicePretaxUsd({ invoiceStatus: 'past_due', amounts: { subtotal: 23346, discountAmount: 1725, taxAmount: 1379.27, total: 23000.27 } }), 21621);
});
test('S02 draft / void / bad-debt invoices are not revenue; past_due and awaiting_payment are', () => {
  for (const st of ['draft', 'void', 'bad_debt']) assert.equal(isIssuedInvoice({ invoiceStatus: st }), false);
  for (const st of ['paid', 'past_due', 'awaiting_payment']) assert.equal(isIssuedInvoice({ invoiceStatus: st }), true);
});
test('S03 $0 warranty invoice: counted in invoice count, not in dollars', () => {
  const w = buildWeeklySales({ ...base, now: new Date('2026-10-12T20:00:00Z'), range: R('2026-10-01', '2026-10-12'),
    invoices: [{ invoiceStatus: 'paid', issuedDate: '2026-10-05T18:00:00Z', amounts: { subtotal: 0, total: 0 } }, { invoiceStatus: 'paid', issuedDate: '2026-10-05T18:00:00Z', amounts: { subtotal: 200, total: 200, paymentsTotal: 200 } }] });
  assert.equal(w.totals!.invoiceCount, 2); assert.equal(w.totals!.zeroInvoices, 1); assert.equal(w.totals!.invoiced, 200);
});
test('S04 overpaid invoice: paid capped at the invoice total (#4975-style)', () => {
  const w = buildWeeklySales({ ...base, now: new Date('2026-10-12T20:00:00Z'), range: R('2026-10-01', '2026-10-12'),
    invoices: [{ invoiceStatus: 'paid', issuedDate: '2026-10-05T18:00:00Z', amounts: { subtotal: 1000, taxAmount: 77.5, total: 1077.5, paymentsTotal: 1200 } }] });
  assert.equal(w.totals!.paid, 1000);
});
test('S05 cash: deposits count, refunds and failed ACH subtract, other adjustment types ignored', () => {
  const w = buildWeeklySales({ ...base, now: new Date('2026-10-12T20:00:00Z'), range: R('2026-10-01', '2026-10-12'),
    payments: [{ amount: 5000, entryDate: '2026-10-02T18:00:00Z', adjustmentType: 'DEPOSIT' }, { amount: 1000, entryDate: '2026-10-03T18:00:00Z', adjustmentType: 'PAYMENT' },
      { amount: 300, entryDate: '2026-10-04T18:00:00Z', adjustmentType: 'REFUND' }, { amount: -200, entryDate: '2026-10-04T18:00:00Z', adjustmentType: 'FAILED_ACH_PAYMENT' }, { amount: 50, entryDate: '2026-10-04T18:00:00Z', adjustmentType: 'BAD_DEBT' }] });
  assert.equal(w.totals!.cash, 5500); assert.equal(w.totals!.cashCount, 4);
});
test('S06 invoice with no job (drilling deposit #5497, $35,200) is classified by its subject, not as pump', () => {
  const inv = { invoiceStatus: 'paid', issuedDate: '2026-08-12T18:00:00Z', subject: '50% deposit for drilling', amounts: { subtotal: 35200, total: 35200 }, jobs: { nodes: [] } };
  assert.equal(invoiceTitle(inv), '50% deposit for drilling');
  const c = categoryTotals({ ...base, invoices: [inv] }, '2026-08-01', '2026-08-31')!;
  assert.equal(c.drilling.invoiced, 35200); assert.equal(c.pump.invoiced, 0);
});
test('S07 invoice covering two jobs is classified by its first job', () => {
  assert.equal(invoiceTitle({ subject: 'For Services Rendered', jobs: { nodes: [{ title: 'Replace pressure tank' }, { title: 'New Well Drilling' }] } }), 'Replace pressure tank');
});
test('S08 quote discount: quote dollars = subtotal − discount (#4213: 23,346 − 1,725)', () => {
  assert.equal(quoteValue({ amounts: { subtotal: 23346, discountAmount: 1725, total: 23000.27 } }), 21621);
  assert.equal(quoteValue({ amounts: { subtotal: 53300, total: 53641.25 } }), 53300);
  const w = buildWeeklySales({ ...base, now: new Date('2026-10-12T20:00:00Z'), range: R('2026-09-18', '2026-10-12'),
    quotes: [{ title: 'New Pump System — Anza (25 GPM)', quoteStatus: 'converted', sentAt: '2026-08-28T18:35:59Z', transitionedAt: '2026-09-21T17:23:57Z', amounts: { subtotal: 23346, discountAmount: 1725 } }] });
  assert.equal(w.totals!.quotesApprovedValue, 21621);
});
test('S09 "New Well Pump System" and "Deepen Pump Setting" are pump work, not drilling', () => {
  for (const t of ['New Well Pump System', 'New Well Pump ', 'Install New Well Pump System', 'New Well Pump System (10-13GPM into holding tank)', 'Deepen Pump Setting',
    "Pull & Replace Pump Deepen Pump Setting 100' w/ Customers Existing Drop Pipe"]) assert.equal(workCategory(t), 'pump', t);
  for (const t of ['New Well Drilling', 'New well', 'Air Rotary New well', 'Deepen Existing Well', 'Well Destruction', 'Domestic Air-Rotary Drilling Quote']) assert.equal(workCategory(t), 'drilling', t);
});
test('S10 site walks: never jobs booked, any spelling', () => {
  for (const t of ['Drilling Site Visit', 'Site Visit Drilling', 'Drilling Job Walk', 'drilling site visit', 'Job Walk - Brighton']) assert.ok(isSiteVisit(t), t);
});
test('S11 old quote approved this period counts as approved (by approval date), close-rate cohort by sent date', () => {
  const w = buildWeeklySales({ ...base, now: new Date('2026-10-12T20:00:00Z'), range: R('2026-10-06', '2026-10-12'),
    quotes: [{ title: 'New Well Drilling', quoteStatus: 'approved', sentAt: '2026-07-22T17:27:59Z', transitionedAt: '2026-10-12T21:00:00Z', amounts: { subtotal: 53300 } }] });
  assert.equal(w.totals!.quotesApproved, 1); assert.equal(w.totals!.quotesSent, 0); assert.equal(w.totals!.byCategory!.drilling.quotesApproved, 1);
});
test('S12 quote converted without ever being sent is not an approval', () => {
  const w = buildWeeklySales({ ...base, now: new Date('2026-10-12T20:00:00Z'), range: R('2026-10-01', '2026-10-12'),
    quotes: [{ title: 'Deepen Pump Setting', quoteStatus: 'converted', sentAt: null, transitionedAt: '2026-10-05T18:00:00Z', amounts: { subtotal: 600 } }] });
  assert.equal(w.totals!.quotesApproved, 0);
});
test('S13 PT date boundary and DST: Jobber UTC timestamps bucket on the Pacific day', () => {
  assert.equal(jobberDateKey('2026-10-01T06:30:00Z'), '2026-09-30'); // 11:30 PM PDT
  assert.equal(jobberDateKey('2026-11-01T07:30:00Z'), '2026-11-01'); // 12:30 AM PDT, DST ends that night
  assert.equal(jobberDateKey('2026-11-02T07:30:00Z'), '2026-11-01'); // 11:30 PM PST
  assert.equal(jobberDateKey('2026-03-08T09:30:00Z'), '2026-03-08'); // 2:30 AM PDT after spring-forward
  assert.equal(jobberDateKey('2026-10-05'), '2026-10-05');
});
test('S14 drilling job booked = Jobber job created (approval alone does not add a booked job)', () => {
  const c = categoryTotals({ ...base, quotes: [{ title: 'New Well Drilling', quoteStatus: 'approved', sentAt: '2026-07-22T17:27:59Z', transitionedAt: '2026-10-12T21:00:00Z', amounts: { subtotal: 53300 } }] }, '2026-10-06', '2026-10-12')!;
  assert.equal(c.drilling.jobsBooked, 0); assert.equal(c.drilling.quotesApproved, 1);
});

// ---- Real leads (Call to booking denominator) ----
const call = (at: string, phone: string, dur = 120, extra: Record<string, unknown> = {}) => ({ at, phone, durationSec: dur, cat: 'pump' as const, live: false, ...extra });
test('S20 existing customer calling an ad is not a lead; new caller is', () => {
  const r = classifyRealLeads({ calls: [call('2026-10-01T18:00:00Z', '7605550101'), call('2026-10-01T19:00:00Z', '7605550102')],
    firstJobAt: new Map([['7605550101', Date.parse('2025-05-01T00:00:00Z')], ['7605550102', null]]), booked: new Map() });
  assert.deepEqual(r.leads.map((l) => l.phone), ['7605550102']);
});
test('S21 repeat caller counted once; missed call later reached is not a second lead', () => {
  const r = classifyRealLeads({ calls: [call('2026-10-01T18:00:00Z', '7605550103', 5, { missed: true }), call('2026-10-01T18:10:00Z', '7605550103'), call('2026-10-03T18:00:00Z', '7605550103')],
    firstJobAt: new Map([['7605550103', null]]), booked: new Map() });
  assert.equal(r.leads.length, 1); assert.deepEqual(r.reasons.map((x) => x.reason), ['lead', 'repeat', 'repeat']);
});
test('S22 toll-free / spam text / vendor are spam; hang-up never reached is not a lead', () => {
  const r = classifyRealLeads({ calls: [call('2026-10-01T18:00:00Z', '8005550100'), call('2026-10-01T18:00:00Z', '7605550104', 60, { text: 'Caller offered SEO marketing for the business' }),
    call('2026-10-01T18:00:00Z', '7605550105', 3)], firstJobAt: new Map([['8005550100', null], ['7605550104', null], ['7605550105', null]]), booked: new Map() });
  assert.equal(r.leads.length, 0); assert.deepEqual(r.reasons.map((x) => x.reason).sort(), ['hangup', 'spam', 'spam']);
});
test('S23 a booked caller is always a real lead (numerator ⊆ denominator), even with an older job record', () => {
  const r = classifyRealLeads({ calls: [call('2026-10-01T18:00:00Z', '7605550106', 3)], firstJobAt: new Map([['7605550106', Date.parse('2026-09-01T00:00:00Z')]]), booked: new Map([['7605550106', 'pump']]) });
  assert.equal(r.leads.length, 1); assert.equal(r.leads[0].booked, true);
});
test('S24 SCWS own numbers are internal, never leads', () => {
  const r = classifyRealLeads({ calls: [call('2026-10-01T18:00:00Z', '7604408520')], firstJobAt: new Map(), booked: new Map() });
  assert.equal(r.leads.length, 0); assert.equal(r.reasons[0].reason, 'internal');
});

// ---- ROAS (strict new-customer) ----
const spend = [{ date: '2026-10-02', campaign: 'Leads-Search-1', costUsd: 100, clicks: 5 }, { date: '2026-10-02', campaign: 'Leads-Search-Drilling', costUsd: 100, clicks: 5 }];
test('S30 ROAS new-only excludes clients with a Jobber job before their first ad call; blended includes them', () => {
  const v = buildRoasView({ spend, start: new Date('2026-10-01T07:00:00Z'), now: new Date('2026-10-12T20:00:00Z'),
    adCalls: [{ started_at: '2026-10-02T18:00:00Z', caller_phone: '7605550201', campaign_name: 'Leads-Search-1' }, { started_at: '2026-10-02T18:00:00Z', caller_phone: '7605550202', campaign_name: 'Leads-Search-Drilling' }],
    invoices: [
      { id: 'a', invoiceStatus: 'paid', issuedDate: '2026-10-05T18:00:00Z', amounts: { subtotal: 1000, total: 1000, paymentsTotal: 1000 }, client: { id: 'A', phones: [{ number: '(760) 555-0201' }], jobs: { nodes: [{ createdAt: '2026-10-03T00:00:00Z' }] } } },
      { id: 'b', invoiceStatus: 'paid', issuedDate: '2026-10-05T18:00:00Z', amounts: { subtotal: 5000, total: 5000, paymentsTotal: 5000 }, client: { id: 'B', phones: [{ number: '760-555-0202' }], jobs: { nodes: [{ createdAt: '2024-01-01T00:00:00Z' }] } } },
    ] })!;
  assert.equal(v.newOnly.invoiced, 1000); assert.equal(v.overall.invoiced, 6000);
  assert.equal(v.byCategory.pump.newOnly.multipleInvoiced, 10); assert.equal(v.byCategory.drilling.newOnly.invoiced, 0);
});
test('S31 ROAS: invoice issued before the client ever called an ad is not ad revenue', () => {
  const v = buildRoasView({ spend, start: new Date('2026-10-01T07:00:00Z'), now: new Date('2026-10-12T20:00:00Z'),
    adCalls: [{ started_at: '2026-10-08T18:00:00Z', caller_phone: '7605550203', campaign_name: 'Leads-Search-1' }],
    invoices: [{ id: 'c', invoiceStatus: 'paid', issuedDate: '2026-10-05T18:00:00Z', amounts: { subtotal: 900, total: 900 }, client: { id: 'C', phones: [{ number: '7605550203' }], jobs: { nodes: [] } } }] })!;
  assert.equal(v.overall.invoiced, 0);
});
test('S32 ROAS: discounted invoice counts net of discount; draft invoice ignored', () => {
  const v = buildRoasView({ spend, start: new Date('2026-10-01T07:00:00Z'), now: new Date('2026-10-12T20:00:00Z'),
    adCalls: [{ started_at: '2026-10-02T18:00:00Z', caller_phone: '7605550204', campaign_name: 'Leads-Search-1' }],
    invoices: [{ id: 'd', invoiceStatus: 'paid', issuedDate: '2026-10-05T18:00:00Z', amounts: { subtotal: 1000, discountAmount: 100, total: 900 }, client: { id: 'D', phones: [{ number: '7605550204' }], jobs: { nodes: [] } } },
      { id: 'e', invoiceStatus: 'draft', issuedDate: '2026-10-05T18:00:00Z', amounts: { subtotal: 7000, total: 7000 }, client: { id: 'D', phones: [{ number: '7605550204' }], jobs: { nodes: [] } } }] })!;
  assert.equal(v.newOnly.invoiced, 900);
});

// ---- Blended ROAS (all revenue ÷ all ad spend) ----
test('S40 Blended ROAS = every issued pre-tax invoice in the window (any customer) ÷ all Google Ads spend', () => {
  const v = buildRoasView({ spend, start: new Date('2026-10-01T07:00:00Z'), now: new Date('2026-10-12T20:00:00Z'),
    adCalls: [{ started_at: '2026-10-02T18:00:00Z', caller_phone: '7605550201', campaign_name: 'Leads-Search-1' }],
    invoices: [
      { id: 'a', invoiceStatus: 'paid', issuedDate: '2026-10-05T18:00:00Z', amounts: { subtotal: 1000, total: 1077.5, taxAmount: 77.5 }, client: { id: 'A', phones: [{ number: '7605550201' }], jobs: { nodes: [] } } },
      // never called an ad: not in ad ROAS, but IS in blended
      { id: 'b', invoiceStatus: 'awaiting_payment', issuedDate: '2026-10-07', amounts: { subtotal: 3000, discountAmount: 500, total: 2500 }, client: { id: 'B', phones: [{ number: '7605559999' }], jobs: { nodes: [] } } } as any,
      { id: 'c', invoiceStatus: 'draft', issuedDate: '2026-10-07', amounts: { subtotal: 9000, total: 9000 }, client: { id: 'C', phones: [], jobs: { nodes: [] } } },
      { id: 'd', invoiceStatus: 'void', issuedDate: '2026-10-07', amounts: { subtotal: 9000, total: 9000 }, client: { id: 'C', phones: [], jobs: { nodes: [] } } },
      // outside the window (before start / after today)
      { id: 'e', invoiceStatus: 'paid', issuedDate: '2026-09-30', amounts: { subtotal: 4000, total: 4000 }, client: { id: 'E', phones: [], jobs: { nodes: [] } } },
      { id: 'f', invoiceStatus: 'paid', issuedDate: '2026-10-13', amounts: { subtotal: 4000, total: 4000 }, client: { id: 'F', phones: [], jobs: { nodes: [] } } },
    ] })!;
  assert.equal(v.overall.invoiced, 1000);
  assert.deepEqual(v.blended, { invoiced: 3500, invoices: 2, spend: 200, multiple: 17.5, startKey: '2026-10-01', endKey: '2026-10-12' });
});
test('S41 Blended ROAS: zero or unknown spend gives no multiple (UI shows —); spend outside the window is ignored', () => {
  const inv = [{ id: 'a', invoiceStatus: 'paid', issuedDate: '2026-10-05', amounts: { subtotal: 500, total: 500 } }] as any;
  const z = buildBlendedRoas({ invoices: inv, spend: [{ date: '2026-09-20', campaign: 'Leads-Search-1', costUsd: 300, clicks: 1 }], start: new Date('2026-10-01T07:00:00Z'), now: new Date('2026-10-12T20:00:00Z') })!;
  assert.equal(z.spend, 0); assert.equal(z.multiple, null); assert.equal(z.invoiced, 500);
  const n = buildBlendedRoas({ invoices: inv, spend: null, start: new Date('2026-10-01T07:00:00Z'), now: new Date('2026-10-12T20:00:00Z') })!;
  assert.equal(n.spend, null); assert.equal(n.multiple, null);
  assert.equal(buildBlendedRoas({ invoices: null, spend: [], start: new Date('2026-10-01T07:00:00Z'), now: new Date('2026-10-12T20:00:00Z') }), null);
});
test('S42 Blended ROAS follows the selected window: a shorter range only counts its own days', () => {
  const sp = [{ date: '2026-10-02', campaign: 'Leads-Search-1', costUsd: 100, clicks: 1 }, { date: '2026-10-10', campaign: 'Leads-Search-Drilling', costUsd: 50, clicks: 1 }];
  const inv = [{ id: 'a', invoiceStatus: 'paid', issuedDate: '2026-10-03', amounts: { subtotal: 1000, total: 1000 } }, { id: 'b', invoiceStatus: 'paid', issuedDate: '2026-10-11', amounts: { subtotal: 600, total: 600 } }] as any;
  const all = buildBlendedRoas({ invoices: inv, spend: sp, start: new Date('2026-10-01T07:00:00Z'), now: new Date('2026-10-12T20:00:00Z') })!;
  const wk = buildBlendedRoas({ invoices: inv, spend: sp, start: new Date('2026-10-06T07:00:00Z'), now: new Date('2026-10-12T20:00:00Z') })!;
  assert.equal(all.multiple, 10.67); assert.equal(wk.multiple, 12); assert.equal(wk.invoiced, 600); assert.equal(wk.spend, 50);
});
