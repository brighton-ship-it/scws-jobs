import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_UNKNOWN_SOURCE, NOT_FROM_ADS, attributeAiHandledCalls, buildDashboard, hashPhone, maskPhone, mergeLiveCalls, parseRange, ptStartOfDay, isAnswered, rangeStart, type DashCall,
} from './call-dashboard.ts';

const now = new Date('2026-10-09T20:00:00Z'); // 1pm PT Fri
const call = (o: Partial<DashCall>): DashCall => ({
  started_at: '2026-10-09T18:00:00Z', duration_seconds: 60, campaign_name: 'Search-1', keyword: null,
  caller_area_code: '951', caller_phone: null, call_status: 'RECEIVED', call_source: 'WEBSITE',
  customer_id: null, jobber_client_id: null, ad_group_name: null, ...o,
});

test('mask and range helpers', () => {
  assert.equal(maskPhone('(951) 555-1234'), '(•••) •••-1234');
  assert.equal(maskPhone(null, '951'), '(951) •••-••••');
  assert.equal(parseRange('bogus'), 'since');
  assert.equal(ptStartOfDay(now).toISOString(), '2026-10-09T07:00:00.000Z');
  assert.equal(rangeStart('since', now).toISOString(), '2026-09-18T07:00:00.000Z');
  assert.equal(isAnswered({ duration_seconds: 10, call_status: 'RECEIVED' }), false);
  assert.equal(isAnswered({ duration_seconds: 40, call_status: 'MISSED' }), false);
});

test('aggregates calls, bookings, spend and multiples', () => {
  const h = hashPhone('9515551234')!;
  const d = buildDashboard({
    now, range: '7',
    calls: [
      call({ caller_phone: '9515551234' }),
      call({ duration_seconds: 5 }),
      call({ customer_id: 'c1', caller_phone: '9515559999' }),
      call({ started_at: '2026-08-01T00:00:00Z' }),
    ],
    conversions: [{
      jobber_job_id: 'j1', conversion_at: '2026-10-09T19:00:00Z', value_usd: 200,
      payload: { conversion: { user_identifiers: [{ hashed_phone_number: h }] }, stages: { booking: 200, approved: 1000, invoiced: 900 } },
    }],
    spend: [{ date: '2026-10-08', campaign: 'Search-1', costUsd: 100 }],
    paidByJob: new Map([['j1', 450]]),
  });
  assert.equal(d.totals.calls, 3);
  assert.equal(d.totals.answered, 2);
  assert.equal(d.totals.missedOrShort, 1);
  assert.equal(d.totals.bookedNew, 1);
  assert.equal(d.totals.knownExisting, 1);
  assert.equal(d.totals.invoicedValue, 900);
  assert.equal(d.totals.paidValue, 450);
  assert.equal(d.totals.multipleInvoiced, 9);
  assert.equal(d.totals.multiplePaid, 4.5);
  assert.equal(d.totals.costPerBooked, 100);
  assert.equal(d.tv.callsToday, 3);
  assert.equal(d.tv.bookedToday, 1);
  assert.equal(d.recent.some((r) => r.phone.endsWith('-1234')), true);
  assert.equal(JSON.stringify(d).includes('9515551234'), false);
});

test('missing spend/paid yields nulls and gaps, not crashes', () => {
  const d = buildDashboard({ now, range: '30', calls: [], conversions: [], spend: null, paidByJob: null });
  assert.equal(d.totals.spend, null);
  assert.equal(d.totals.multipleInvoiced, null);
  assert.ok(d.gaps.length >= 2);
});

test('a booked job is credited to one call only; repeat/later calls are Existing client', () => {
  const phone = '7602712106';
  const h = hashPhone(phone)!;
  const mk = (iso: string) => call({ started_at: iso, duration_seconds: 2, caller_phone: phone, customer_id: 'c9' });
  const conv = (id: string, at: string, v: number) => ({
    jobber_job_id: id, conversion_at: at, value_usd: v,
    payload: { conversion: { user_identifiers: [{ hashed_phone_number: h }] }, stages: { booking: v } },
  });
  // Existing customer: job booked before all four Oct 10 calls
  let d = buildDashboard({
    now, range: '30', spend: null, paidByJob: null,
    calls: ['2026-10-09T16:00:00Z', '2026-10-09T16:01:00Z', '2026-10-09T16:02:00Z', '2026-10-09T16:03:00Z'].map(mk),
    conversions: [conv('j1', '2026-10-08T00:00:00Z', 5776)],
  });
  assert.equal(d.totals.bookedNew, 0);
  assert.equal(d.totals.bookedValue, 0);
  assert.ok(d.recent.every((r) => r.outcome === 'Existing client'));
  // New customer: only the call nearest before booking is credited; later calls are not
  d = buildDashboard({
    now, range: '30', spend: null, paidByJob: null,
    calls: ['2026-10-09T15:00:00Z', '2026-10-09T16:00:00Z', '2026-10-09T18:00:00Z'].map(mk),
    conversions: [conv('j2', '2026-10-09T17:00:00Z', 5776)],
  });
  assert.equal(d.totals.bookedNew, 1);
  assert.equal(d.totals.bookedValue, 5776);
  assert.equal(d.recent.filter((r) => r.outcome === 'Booked (new)').length, 1);
});

import { buildWeeklySales, weekBounds } from './weekly-sales.ts';
test('weekly sales buckets by PT Monday week, paid share and closing rate', () => {
  const wnow = new Date('2026-10-09T20:00:00Z'); // Fri Oct 9 PT
  const b = weekBounds(wnow);
  assert.equal(b.length, 9);
  assert.equal(b[8].startKey, '2026-10-05');
  assert.equal(b[7].startKey, '2026-09-28');
  const w = buildWeeklySales({
    now: wnow,
    invoices: [
      { invoiceStatus: 'paid', issuedDate: '2026-10-06', amounts: { subtotal: 100, total: 110, taxAmount: 10, paymentsTotal: 110 } },
      { invoiceStatus: 'draft', issuedDate: '2026-10-06', amounts: { subtotal: 999, total: 999 } },
      { invoiceStatus: 'awaiting_payment', issuedDate: '2026-09-30', amounts: { subtotal: 200, total: 200, taxAmount: 0, paymentsTotal: 0 } },
    ],
    quotes: [{ quoteStatus: 'approved', sentAt: '2026-10-07T18:00:00Z', transitionedAt: '2026-10-08T18:00:00Z', amounts: { subtotal: 500 } }, { quoteStatus: 'awaiting_response', sentAt: '2026-10-07T18:00:00Z', amounts: { subtotal: 300 } }],
    jobsCreated: [{ createdAt: '2026-10-08T18:00:00Z' }], jobsCompleted: [],
    callTimes: ['2026-10-06T18:00:00Z', '2026-10-07T18:00:00Z', '2026-10-08T18:00:00Z', '2026-10-08T19:00:00Z'],
    bookedAt: ['2026-10-07T20:00:00Z'],
  });
  const cur = w.weeks[8];
  assert.equal(cur.invoiced, 100); assert.equal(cur.paid, 100);
  assert.equal(w.weeks[7].invoiced, 200); assert.equal(w.weeks[7].paid, 0);
  assert.equal(cur.quotesSent, 2); assert.equal(cur.quotesSentValue, 800);
  assert.equal(cur.quotesApproved, 1); assert.equal(cur.quotesApprovedValue, 500);
  assert.equal(cur.jobsBooked, 1);
  assert.equal(cur.closingRate, 0.25);
  assert.equal(cur.label, 'Oct 5–Oct 9');
  assert.equal(w.weeks[0].closingRate, null);
  const none = buildWeeklySales({ now: wnow, invoices: null, quotes: null, jobsCreated: null, jobsCompleted: null, callTimes: [], bookedAt: [] });
  assert.equal(none.weeks[8].invoiced, null); assert.equal(none.gaps.length, 5); assert.equal(none.weeks[8].cash, null);
});

test('weekly cash collected buckets by payment received date, not invoice week', () => {
  const wnow = new Date('2026-10-09T20:00:00Z');
  const w = buildWeeklySales({
    now: wnow, invoices: [
      // invoice issued last week, paid this week: counts as Paid on LAST week's invoices, cash THIS week
      { invoiceStatus: 'paid', issuedDate: '2026-09-30', amounts: { subtotal: 1000, total: 1000, taxAmount: 0, paymentsTotal: 1000 } },
    ], quotes: [], jobsCreated: [], jobsCompleted: [], callTimes: [], bookedAt: [],
    payments: [
      { id: 'a', amount: 1000, entryDate: '2026-10-06T17:00:00Z', adjustmentType: 'PAYMENT' },
      { id: 'b', amount: 250.5, entryDate: '2026-10-08T01:00:00Z', adjustmentType: 'DEPOSIT' }, // Oct 7 PT
      { id: 'c', amount: 100, entryDate: '2026-10-07T17:00:00Z', adjustmentType: 'REFUND' },
      { id: 'd', amount: 500, entryDate: '2026-10-07T17:00:00Z', adjustmentType: 'BAD_DEBT' }, // ignored
      { id: 'e', amount: 300, entryDate: '2026-10-05T06:30:00Z', adjustmentType: 'PAYMENT' }, // Sun Oct 4 PT -> prior week
      { id: 'f', amount: 40, entryDate: '2026-10-12T20:00:00Z', adjustmentType: 'PAYMENT' }, // outside range
    ],
  });
  assert.equal(w.weeks[8].cash, 1150.5); assert.equal(w.weeks[8].cashCount, 3);
  assert.equal(w.weeks[7].cash, 300);
  assert.equal(w.weeks[8].paid, 0); assert.equal(w.weeks[7].paid, 1000);
  assert.ok(!w.gaps.some((g) => /cash/.test(g)));
  const capped = Object.assign([], { truncated: true });
  const w2 = buildWeeklySales({ now: wnow, invoices: [], quotes: [], jobsCreated: [], jobsCompleted: [], callTimes: [], bookedAt: [], payments: capped });
  assert.ok(w2.gaps.some((g) => /incomplete/.test(g)));
});

test('compactUsd formats large values compactly', async () => {
  const { compactUsd } = await import('./format-usd.ts');
  assert.equal(compactUsd(null), '—');
  assert.equal(compactUsd(950), '$950');
  assert.equal(compactUsd(9876), '$9,876');
  assert.equal(compactUsd(12400), '$12.4k');
  assert.equal(compactUsd(456000), '$456k');
  assert.equal(compactUsd(999600), '$1.00M');
  assert.equal(compactUsd(1234567), '$1.23M');
  assert.equal(compactUsd(12345678), '$12.3M');
});

test('quotes approved counts by approval date, not sent date', () => {
  const wnow = new Date('2026-10-09T20:00:00Z');
  const w = buildWeeklySales({
    now: wnow, invoices: [], jobsCreated: [], jobsCompleted: [], callTimes: [], bookedAt: [],
    quotes: [
      // sent last week, approved this week: counts as approved THIS week
      { quoteStatus: 'approved', sentAt: '2026-09-30T18:00:00Z', transitionedAt: '2026-10-06T18:00:00Z', amounts: { subtotal: 1000 } },
      // sent this week, approved next week (future/now outside): counts as sent only
      { quoteStatus: 'awaiting_response', sentAt: '2026-10-06T18:00:00Z', transitionedAt: '2026-10-06T18:00:00Z', amounts: { subtotal: 400 } },
      // converted quote sent and approved this week
      { quoteStatus: 'converted', sentAt: '2026-10-07T18:00:00Z', transitionedAt: '2026-10-08T18:00:00Z', amounts: { subtotal: 250 } },
    ],
  });
  const cur = w.weeks[8], prev = w.weeks[7];
  assert.equal(cur.quotesApproved, 2); assert.equal(cur.quotesApprovedValue, 1250);
  assert.equal(cur.quotesSent, 2); assert.equal(cur.quotesSentValue, 650);
  assert.equal(prev.quotesSent, 1); assert.equal(prev.quotesApproved, 0);
});

test('adSplit separates pump and drilling by campaign', () => {
  const h = hashPhone('9515551234')!;
  const d = buildDashboard({
    now, range: 'since',
    calls: [
      call({ caller_phone: '9515551234', campaign_name: 'Leads-Search-Drilling' }),
      call({ campaign_name: 'Leads-Search-1' }),
      call({ campaign_name: '(Mike live call)', live: true }),
    ],
    conversions: [{
      jobber_job_id: 'j1', conversion_at: '2026-10-09T19:00:00Z', value_usd: 200,
      payload: { conversion: { user_identifiers: [{ hashed_phone_number: h }] }, stages: { booking: 200, invoiced: 900 } },
    }],
    spend: [
      { date: '2026-10-08', campaign: 'Leads-Search-Drilling', costUsd: 300, clicks: 20 },
      { date: '2026-10-08', campaign: 'Leads-Search-1', costUsd: 100, clicks: 10 },
    ],
    paidByJob: null,
  });
  const [pump, drill] = d.adSplit!.since.rows;
  assert.equal(drill.category, 'drilling');
  assert.deepEqual([drill.spend, drill.clicks, drill.calls, drill.booked, drill.invoiced, drill.multiple], [300, 20, 1, 1, 900, 3]);
  assert.deepEqual([pump.spend, pump.clicks, pump.calls, pump.booked, pump.invoiced, pump.multiple], [100, 10, 1, 0, 0, 0]);
  assert.equal(d.adSplit!.week.rows[1].booked, 1);
});

test('Mike and Sarah calls count on the dialed source, keyword, and campaign, including bookings', () => {
  const yelp = '7605550101';
  const ads = '7605550102';
  const older = '7605550103';
  const shop = '7605550104';
  const groupOnly = '7605550105';
  const live = mergeLiveCalls([], [
    { vapi_call_id: 'v-yelp', phone: yelp, duration_sec: 80, called_at: '2026-10-09T18:00:00Z' },
    { vapi_call_id: 'v-ads', phone: ads, duration_sec: 90, called_at: '2026-10-09T18:05:00Z' },
    { vapi_call_id: 'v-old', phone: older, duration_sec: 70, called_at: '2026-10-09T18:10:00Z' },
    { vapi_call_id: 'v-main', phone: shop, duration_sec: 40, called_at: '2026-10-09T18:12:00Z' },
    { vapi_call_id: 'v-group', phone: groupOnly, duration_sec: 55, called_at: '2026-10-09T18:20:00Z' },
  ]);
  assert.equal(live[0].call_source, 'Mike (AI receptionist)');
  // Recording supplies the dialed line; the call log / ads row supplies keyword and ad group.
  const attributed = attributeAiHandledCalls(live, [
    { at: '2026-10-09T18:00:05Z', callerPhone: '+1 (760) 555-0101', dialedNumber: '+17604408520', vapiCallId: 'v-yelp' },
    { at: '2026-10-09T18:00:00Z', callerPhone: yelp, dialedNumber: '+17608914264', recordingSource: 'yelp' },
    { at: '2026-10-09T18:05:00Z', callerPhone: ads, dialedNumber: '+17603312502', recordingSource: 'google_ads' },
    { at: '2026-10-09T18:05:10Z', callerPhone: ads, campaignName: 'Leads-Search-1', keyword: 'well pump repair', adGroupName: 'Pump Service' },
    { at: '2026-10-09T18:12:00Z', callerPhone: shop, dialedNumber: '+17604408520', vapiCallId: 'v-main' },
    { at: '2026-10-09T18:20:00Z', callerPhone: groupOnly, dialedNumber: '+17603312502', campaignName: 'Leads-Search-1', adGroupName: 'Emergency' },
  ]);
  const yelpCall = attributed.find((c) => c._vapi === 'v-yelp');
  const adsCall = attributed.find((c) => c._vapi === 'v-ads');
  const oldCall = attributed.find((c) => c._vapi === 'v-old');
  const mainCall = attributed.find((c) => c._vapi === 'v-main');
  const groupCall = attributed.find((c) => c._vapi === 'v-group');
  assert.equal(yelpCall?.call_source, 'Yelp');
  assert.equal(yelpCall?.keyword, null);
  assert.equal(adsCall?.call_source, 'Ads');
  assert.equal(adsCall?.campaign_name, 'Leads-Search-1');
  assert.equal(adsCall?.keyword, 'well pump repair');
  assert.equal(adsCall?.ad_group_name, 'Pump Service');
  assert.equal(oldCall?.call_source, AI_UNKNOWN_SOURCE);
  assert.equal(oldCall?.campaign_name, null);
  assert.equal(oldCall?.keyword, null);
  assert.equal(mainCall?.call_source, 'Main');
  assert.equal(groupCall?.call_source, 'Ads');
  assert.equal(groupCall?.keyword, null);
  assert.equal(groupCall?.ad_group_name, 'Emergency');
  assert.equal(attributed.some((c) => c.call_source === 'Mike (AI receptionist)' || c.campaign_name === '(Mike live call)'), false);
  const sarah = attributeAiHandledCalls([{
    ...live[0], _vapi: 'v-sarah', caller_phone: '7605550111', started_at: '2026-10-09T18:30:00Z',
    call_source: 'Sarah (AI receptionist)', campaign_name: '(Sarah live call)',
  }], [{ at: '2026-10-09T18:30:00Z', callerPhone: '7605550111', dialedNumber: '+17604540365', recordingSource: 'apple_maps', keyword: '  ' }]);
  assert.equal(sarah[0].call_source, 'Apple Maps');
  assert.equal(sarah[0].campaign_name, null);
  assert.equal(sarah[0].keyword, null);

  const d = buildDashboard({
    now, range: '7',
    calls: [
      ...attributed,
      call({ caller_phone: '9515557777', call_source: 'AD', campaign_name: 'Leads-Search-1', keyword: 'well pump repair' }),
      call({ caller_phone: '7605550188', call_source: 'GBP Anza', campaign_name: null, keyword: null, ad_group_name: null }),
    ],
    conversions: [
      {
        jobber_job_id: 'j-yelp', conversion_at: '2026-10-09T19:00:00Z', value_usd: 200,
        payload: { conversion: { user_identifiers: [{ hashed_phone_number: hashPhone(yelp) }] }, stages: { booking: 200 } },
      },
      {
        jobber_job_id: 'j-ads', conversion_at: '2026-10-09T19:10:00Z', value_usd: 400,
        payload: { conversion: { user_identifiers: [{ hashed_phone_number: hashPhone(ads) }] }, stages: { booking: 400 } },
      },
    ],
    spend: [{ date: '2026-10-08', campaign: 'Leads-Search-1', costUsd: 50, clicks: 4 }],
    paidByJob: null,
  });
  const src = (key: string) => d.byTrackingNumber.find((r) => r.key === key);
  const camp = (key: string) => d.byCampaign.find((r) => r.key === key);
  const kw = (key: string) => d.byKeyword.find((r) => r.key === key);
  assert.equal(src('Yelp')?.calls, 1);
  assert.equal(src('Yelp')?.booked, 1);
  assert.equal(src('Ads')?.calls, 2);
  assert.equal(src('Ads')?.booked, 1);
  assert.equal(src(AI_UNKNOWN_SOURCE)?.calls, 1);
  assert.equal(src('Main')?.calls, 1);
  assert.equal(src('GBP Anza')?.calls, 1);
  assert.equal(camp('Leads-Search-1')?.calls, 3);
  assert.equal(camp('Leads-Search-1')?.booked, 1);
  // Yelp, unresolved, Main, and the plain GBP call are not ad calls.
  assert.equal(camp(NOT_FROM_ADS)?.calls, 4);
  assert.equal(camp(NOT_FROM_ADS)?.booked, 1);
  assert.equal(kw('well pump repair')?.calls, 2);
  assert.equal(kw('well pump repair')?.booked, 1);
  assert.equal(kw('ad group: Emergency')?.calls, 1);
  assert.equal(kw('ad group: Emergency')?.booked, 0);
  assert.equal(kw(NOT_FROM_ADS)?.calls, 4);
  assert.equal(kw(NOT_FROM_ADS)?.booked, 1);
  for (const rows of [d.byTrackingNumber, d.byCampaign, d.byKeyword]) {
    assert.equal(rows.some((r) => r.key === '(none)' || r.key === '(Mike live call)' || r.key === 'Mike (AI receptionist)' || r.key === 'Sarah (AI receptionist)'), false);
  }
});

test('sales headline totals follow the selected range, weeks unchanged', async () => {
  const { buildWeeklySales: b, rangeTitle } = await import('./weekly-sales.ts');
  const now = new Date('2026-10-12T19:00:00Z'); // Mon Oct 12 PT
  const inv = (d: string, sub: number) => ({ invoiceStatus: 'paid', issuedDate: d, amounts: { subtotal: sub, total: sub, taxAmount: 0, paymentsTotal: sub } });
  const input = {
    now, invoices: [inv('2026-10-12', 100), inv('2026-10-06', 200), inv('2026-09-20', 400), inv('2026-07-20', 800)],
    quotes: [{ quoteStatus: 'approved', sentAt: '2026-09-15T18:00:00Z', transitionedAt: '2026-10-07T18:00:00Z', amounts: { subtotal: 50 } }],
    jobsCreated: [{ createdAt: '2026-10-08T18:00:00Z' }, { createdAt: '2026-09-01T18:00:00Z' }], jobsCompleted: [],
    payments: [{ amount: 75, entryDate: '2026-09-30', adjustmentType: 'PAYMENT' }], callTimes: [], bookedAt: [],
  };
  const r7 = b({ ...input, range: { range: '7', startKey: '2026-10-06', endKey: '2026-10-12', name: '7' } });
  assert.equal(r7.totals?.invoiced, 300);
  assert.equal(r7.totals?.cash, 0);
  assert.equal(r7.totals?.quotesSent, 0);
  assert.equal(r7.totals?.quotesApprovedValue, 50);
  assert.equal(r7.totals?.jobsBooked, 1);
  assert.equal(r7.totals?.title, 'Last 7 days: Oct 6–Oct 12');
  const r30 = b({ ...input, range: { range: '30', startKey: '2026-09-13', endKey: '2026-10-12', name: '30' } });
  assert.equal(r30.totals?.invoiced, 700);
  assert.equal(r30.totals?.cash, 75);
  assert.equal(r30.totals?.quotesSent, 1);
  const r90 = b({ ...input, range: { range: '90', startKey: '2026-07-15', endKey: '2026-10-12', name: '90' } });
  assert.equal(r90.totals?.invoiced, 1500);
  assert.equal(r90.totals?.jobsBooked, 2);
  // weekly rows identical regardless of range
  assert.deepEqual(r7.weeks, r90.weeks);
  assert.equal(r7.weeks[r7.weeks.length - 1].invoiced, 100); // Mon Oct 12 = new week
  assert.equal(rangeTitle('since', '2026-09-18', '2026-10-12'), 'Since Sep 18: Sep 18–Oct 12');
});
