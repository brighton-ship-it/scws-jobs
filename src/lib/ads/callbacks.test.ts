import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateFeed, balanceColumnMissing, callbackCandidates, callbackSources, calledAfterInvoice, firstCallback, formatCallbackStatus,
  formatCollectionAttempts, groupPastDueClients, handlingCallback, hasWorkAfter, hasWorkOnOrAfter, indexWorkTimes, isHangupUnder10s, listOpenInvoices, needsCallback,
  OUTREACH_TOOLTIP, dedupeOutreachAttempts, requestResolvesCallback, summarizeOutreach, voiceAttempts,
} from './callbacks.ts';
import { DEFAULT_STAFF_LINES, staffLines, staffLabel } from './staff-lines.ts';
import { parseTwilioCollectionMessages, parseTwilioOutbound } from './twilio-outbound.ts';
import type { FeedRow } from './call-feed.ts';

const now = new Date('2026-10-14T20:00:00Z'); // 1pm PT
const fromMs = Date.parse('2026-09-18T07:00:00Z');

test('hang-ups under 10s use talk or ring time', () => {
  assert.equal(isHangupUnder10s(0, 4), true);
  assert.equal(isHangupUnder10s(0, 25), false);
  assert.equal(isHangupUnder10s(45, 0), false);
  assert.equal(isHangupUnder10s(null, null), false);
});

test('first later outbound or staff answer counts; earlier calls do not', () => {
  const sources = callbackSources({
    log: [
      { direction: 'outbound', started_at: '2026-10-14T17:00:00Z', caller_phone: '+17602712106', duration_seconds: 80, ring_group: 'Liz' },
      { direction: 'outbound', started_at: '2026-10-14T18:30:00Z', caller_phone: '+17602712106', duration_seconds: 40, ring_group: 'Shanicey' },
      { direction: 'inbound', outcome: 'answered', answered_by: 'brighton@scwellservice.com', started_at: '2026-10-14T19:00:00Z', caller_phone: '+17609170001', duration_seconds: 90 },
      { direction: 'inbound', outcome: 'forwarded_ai', started_at: '2026-10-14T19:05:00Z', caller_phone: '+17609170001', duration_seconds: 30 },
    ],
  });
  const back = firstCallback('+1 (760) 271-2106', '2026-10-14T18:10:00Z', sources);
  assert.equal(back?.kind, 'outbound');
  assert.equal(back?.durationSeconds, 40);
  assert.equal(firstCallback('7602712106', '2026-10-14T16:00:00Z', sources)?.durationSeconds, 80);
  assert.equal(firstCallback('7602712106', '2026-10-14T19:00:00Z', sources), null);
  assert.equal(firstCallback('7609170001', '2026-10-14T18:00:00Z', sources)?.kind, 'staff_answered');
  assert.equal(formatCallbackStatus(back, true, now), 'Called back 11:30 AM PT, 40s');
  assert.equal(formatCallbackStatus(null, true, now), 'No callback yet');
  assert.equal(formatCallbackStatus(back, false, now), null);
});

test('needs callback follows the period and the exclusions', () => {
  const log = [
    { direction: 'inbound', outcome: 'missed', started_at: '2026-10-14T16:00:00Z', caller_phone: '+17601110001', duration_seconds: 0, ring_seconds: 22, client_name: 'Ada' },
    { direction: 'inbound', outcome: 'missed', started_at: '2026-10-14T16:05:00Z', caller_phone: '+17601110002', duration_seconds: 0, ring_seconds: 3 },
    { direction: 'inbound', outcome: 'voicemail', started_at: '2026-10-14T16:10:00Z', caller_phone: '+18005551212', duration_seconds: 30 },
    { direction: 'inbound', outcome: 'forwarded_ai', started_at: '2026-10-14T16:20:00Z', caller_phone: '+17601110003', duration_seconds: 40, receptionist_call_id: 'booked-1', client_name: 'Booked' },
    { direction: 'inbound', outcome: 'missed', started_at: '2026-10-14T16:30:00Z', caller_phone: '+17601110004', duration_seconds: 0, ring_seconds: 18, client_name: 'Vendor supply' },
    { direction: 'inbound', outcome: 'missed', started_at: '2026-10-14T16:40:00Z', caller_phone: '+17601110005', duration_seconds: 0, ring_seconds: 40 },
    { direction: 'inbound', outcome: 'forwarded_ai', started_at: '2026-10-14T16:50:00Z', caller_phone: '+17601110006', duration_seconds: 55 },
    { direction: 'inbound', outcome: 'missed', started_at: '2026-10-01T16:00:00Z', caller_phone: '+17601110007', duration_seconds: 0, ring_seconds: 30 },
    { direction: 'outbound', started_at: '2026-10-14T17:10:00Z', caller_phone: '+17601110006', duration_seconds: 70, ring_group: 'Liz' },
    { direction: 'inbound', outcome: 'answered', answered_by: 'shanicey@scwellservice.com', started_at: '2026-10-14T18:00:00Z', caller_phone: '+17601110005', duration_seconds: 100 },
  ];
  const candidates = callbackCandidates({ log, recordings: [], mike: [], bookedMike: new Set(['booked-1']) });
  const sources = callbackSources({ log });
  const work = indexWorkTimes([{ phone: '7601110001', at: '2026-10-14T17:00:00Z' }]);
  assert.equal(hasWorkAfter('7601110001', '2026-10-14T16:00:00Z', work), true);
  const since = needsCallback({ candidates, sources, work, fromMs, now });
  assert.deepEqual(since.leads.rows.map((r) => r.phone), ['(760) 111-0007']);
  assert.equal(since.leads.count, 1);
  assert.equal(since.invoices.count, 0);
  assert.equal(since.leads.rows[0].outcome, 'Missed');
  const monthStart = Date.parse('2026-10-01T07:00:00Z');
  const month = needsCallback({ candidates, sources, work, fromMs: monthStart, now });
  assert.equal(month.leads.count, 1);
  const thisWeek = needsCallback({ candidates, sources, work, fromMs: Date.parse('2026-10-13T07:00:00Z'), now });
  assert.equal(thisWeek.leads.count, 0);
});

test('feed rows show callback status for missed, voicemail, and Mike', () => {
  const sources = callbackSources({
    log: [{ direction: 'outbound', started_at: '2026-10-14T18:00:00Z', caller_phone: '+17602220000', duration_seconds: 95, ring_group: 'Brighton' }],
  });
  const feed: FeedRow[] = [
    { at: '2026-10-14T17:00:00Z', name: 'Pat', phone: '(760) 222-0000', line: 'Main', outcome: 'Missed', answeredBy: null, durationSeconds: 0, summary: null },
    { at: '2026-10-14T17:05:00Z', name: null, phone: '(760) 222-0001', line: 'Mike', outcome: 'Mike (AI)', answeredBy: null, durationSeconds: 40, summary: null },
    { at: '2026-10-14T17:06:00Z', name: 'Sam', phone: '(760) 222-0002', line: 'Main', outcome: 'Answered', answeredBy: 'Liz', durationSeconds: 60, summary: null },
  ];
  const rows = annotateFeed(feed, sources, now);
  assert.equal(rows[0].callback, 'Called back 11:00 AM PT, 1m 35s');
  assert.equal(rows[1].callback, 'No callback yet');
  assert.equal(rows[2].callback, null);
  assert.equal(rows[1].outreach, 'No Voice attempts yet');
  assert.equal(rows[1].goingCold, false);
  assert.equal(rows[2].outreach, null);
  assert.equal(rows[2].goingCold, false);
});

test('shop Voice attempts count, name the last caller, and flag going cold', () => {
  const log = [
    { direction: 'outbound', started_at: '2026-10-12T17:00:00Z', caller_phone: '+17603330001', duration_seconds: 0, ring_group: 'Liz', answered_by: 'lizbeth@scwellservice.com' },
    { direction: 'outbound', started_at: '2026-10-13T18:00:00Z', caller_phone: '+17603330001', duration_seconds: 0, ring_group: 'Shanicey' },
    { direction: 'outbound', started_at: '2026-10-13T21:14:00Z', caller_phone: '+17603330001', duration_seconds: 0, answered_by: 'brighton@scwellservice.com', called_number: '+17604408520' },
    { direction: 'outbound', started_at: '2026-10-13T21:14:00Z', caller_phone: '+17603330002', duration_seconds: 90, ring_group: 'Ads', called_number: '+17603312502' },
    { direction: 'outbound', started_at: '2026-10-01T18:00:00Z', caller_phone: '+17603330003', duration_seconds: 40, ring_group: 'Liz' },
  ];
  const attempts = voiceAttempts(log, DEFAULT_STAFF_LINES);
  assert.equal(attempts.length, 4);
  assert.equal(attempts.filter((a) => a.phone?.includes('3330002')).length, 0);
  const sources = callbackSources({ log });
  assert.equal(handlingCallback('7603330001', '2026-10-12T16:00:00Z', sources), null);
  const cold = summarizeOutreach({ phone: '7603330001', attempts, fromMs, now, anchorAt: '2026-10-12T16:00:00Z', trackCold: true });
  assert.equal(cold.attempts, 3);
  assert.equal(cold.lastBy, 'Brighton');
  assert.equal(cold.label, '3 attempts, last Tue 2:14 PM · Brighton');
  assert.equal(cold.goingCold, true);
  const connected = summarizeOutreach({ phone: '7603330001', attempts, fromMs, now, anchorAt: '2026-10-14T19:00:00Z', connected: true, trackCold: true });
  assert.equal(connected.goingCold, false);
  const stale = summarizeOutreach({ phone: '7603330009', attempts, fromMs, now, anchorAt: '2026-10-10T16:00:00Z', trackCold: true });
  assert.equal(stale.label, 'No Voice attempts yet');
  assert.equal(stale.goingCold, true);
  const fresh = summarizeOutreach({ phone: '7603330009', attempts, fromMs, now, anchorAt: '2026-10-14T18:00:00Z', trackCold: true });
  assert.equal(fresh.goingCold, false);
  const monthOnly = summarizeOutreach({ phone: '7603330003', attempts, fromMs: Date.parse('2026-10-10T07:00:00Z'), now, anchorAt: '2026-10-14T18:00:00Z', trackCold: true });
  assert.equal(monthOnly.attempts, 0);
  assert.equal(OUTREACH_TOOLTIP.includes('Personal cell'), true);

  const candidates = callbackCandidates({
    log: [{ direction: 'inbound', outcome: 'missed', started_at: '2026-10-12T16:00:00Z', caller_phone: '+17603330001', duration_seconds: 0, ring_seconds: 20, client_name: 'Ada' }],
    recordings: [], mike: [],
  });
  const freshCall = callbackCandidates({
    log: [{ direction: 'inbound', outcome: 'missed', started_at: '2026-10-14T19:00:00Z', caller_phone: '+17603330008', duration_seconds: 0, ring_seconds: 20, client_name: 'New' }],
    recordings: [], mike: [],
  });
  const view = needsCallback({
    candidates: [...candidates, ...freshCall], sources, work: indexWorkTimes([]), fromMs, now, attempts,
    pastDue: [{ id: 'C1', name: 'Owen', phones: ['7603330004'], issuedAt: '2026-10-01T15:00:00Z' }],
  });
  assert.equal(view.leads.rows[0].name, 'Ada');
  assert.equal(view.leads.rows[1].name, 'New');
  assert.equal(view.leads.rows[0].outreach, cold.label);
  assert.equal(view.leads.rows[0].goingCold, true);
  assert.equal(view.leads.rows[1].goingCold, false);
  assert.equal(view.leads.count, 2);
  const owen = view.invoices.rows.find((r) => r.name === 'Owen');
  assert.equal(owen?.outcome, 'Past due');
  assert.equal(owen?.phone, '(760) 333-0004');
  assert.equal(owen?.outreach, '0 calls · texts unavailable · email unavailable');
  assert.equal(owen?.goingCold, true);
  assert.equal(view.invoices.count, 1);
  assert.equal(view.leads.rows.some((r) => r.name === 'Owen'), false);
});

test('Stephanie has one callback after the Mike call: Shanicey at 9:30:57 AM, 11s', () => {
  // Production phone_call_log on 2026-10-23. The 9:33 AM dial is not in the log.
  const attempts = [
    { at: '2026-10-12T14:08:43.736Z', phone: '+17605717808', staff: 'Shanicey', durationSeconds: 23 },
    { at: '2026-10-23T15:44:37.942Z', phone: '+17605717808', staff: 'Shanicey', durationSeconds: 164 },
    { at: '2026-10-23T16:30:57.782Z', phone: '+17605717808', staff: 'Shanicey', durationSeconds: 11 },
  ];
  const seenAt = new Date('2026-10-23T16:24:00Z');
  const before = summarizeOutreach({
    phone: '(760) 571-7808', attempts, fromMs, now: seenAt, anchorAt: '2026-10-23T16:17:28.304Z', trackCold: true,
  });
  assert.equal(before.attempts, 0);
  assert.equal(before.label, 'No Voice attempts yet');
  const feed = annotateFeed([
    { at: '2026-10-23T16:17:28.304Z', name: 'Stephanie', phone: '(760) 571-7808', line: 'Mike', outcome: 'Mike (AI)', answeredBy: null, durationSeconds: 5, summary: null },
  ], [], seenAt, { attempts, fromMs });
  assert.equal(feed[0].callback, 'No callback yet');
  assert.equal(feed[0].outreach, 'No Voice attempts yet');
  const after = summarizeOutreach({
    phone: '7605717808', attempts, fromMs, now: new Date('2026-10-23T17:00:00Z'), anchorAt: '2026-10-23T16:17:28.304Z',
  });
  assert.equal(after.attempts, 1);
  assert.equal(after.lastBy, 'Shanicey');
  assert.equal(after.lastAt, '2026-10-23T16:30:57.782Z');
  assert.match(after.label, /^1 attempt, last/);
});

test('Peter Crotty has four staff dials and one callback on the Oct 19 card', () => {
  // Production rows. Three Brighton dials on Oct 15, then Liz at 9:57 AM PT on Oct 19.
  const attempts = [
    { at: '2026-10-15T21:14:16.925Z', phone: '+17607497141', staff: 'Brighton', durationSeconds: 0 },
    { at: '2026-10-15T21:15:05.919Z', phone: '+17607497141', staff: 'Brighton', durationSeconds: 2 },
    { at: '2026-10-15T21:15:44.484Z', phone: '+17607497141', staff: 'Brighton', durationSeconds: 193 },
    { at: '2026-10-19T16:57:33.530Z', phone: '+17607497141', staff: 'Liz', durationSeconds: 86 },
  ];
  assert.equal(attempts.length, 4);
  const oct19 = summarizeOutreach({
    phone: '(760) 749-7141', attempts, fromMs, now: new Date('2026-10-23T17:00:00Z'), anchorAt: '2026-10-19T16:55:50.317Z',
  });
  assert.equal(oct19.attempts, 1);
  assert.equal(oct19.lastBy, 'Liz');
  assert.equal(oct19.lastAt, '2026-10-19T16:57:33.530Z');
  const feed: FeedRow[] = [
    { at: '2026-10-16T16:54:55.510Z', name: 'Peter Crotty', phone: '(760) 749-7141', line: 'Main', outcome: 'Answered', answeredBy: 'Liz', durationSeconds: 73, summary: null },
    { at: '2026-10-16T20:36:39.811Z', name: 'Peter Crotty', phone: '(760) 749-7141', line: 'Main', outcome: 'Answered', answeredBy: 'Liz', durationSeconds: 46, summary: null },
    { at: '2026-10-19T16:55:50.317Z', name: 'Peter Crotty', phone: '(760) 749-7141', line: 'Main', outcome: 'Answered', answeredBy: 'Liz', durationSeconds: 34, summary: null },
  ];
  const rows = annotateFeed(feed, [], new Date('2026-10-23T17:00:00Z'), { attempts, fromMs });
  assert.equal(rows[0].outreach, null);
  assert.equal(rows[1].outreach, null);
  assert.match(rows[2].outreach ?? '', /^1 attempt, last/);
  assert.match(rows[2].outreach ?? '', /Liz/);
});

test('a callback stops at the next inbound from that number', () => {
  const phone = '(760) 222-3333';
  const attempts = [
    { at: '2026-10-14T17:30:00Z', phone: '7602223333', staff: 'Liz', durationSeconds: 20 },
    { at: '2026-10-14T19:30:00Z', phone: '7602223333', staff: 'Shanicey', durationSeconds: 40 },
  ];
  const feed: FeedRow[] = [
    { at: '2026-10-14T17:00:00Z', name: 'Ada', phone, line: 'Main', outcome: 'Missed', answeredBy: null, durationSeconds: 0, summary: null },
    { at: '2026-10-14T19:00:00Z', name: 'Ada', phone, line: 'Mike', outcome: 'Mike (AI)', answeredBy: null, durationSeconds: 30, summary: null },
    { at: '2026-10-14T21:00:00Z', name: 'Ada', phone, line: 'Main', outcome: 'Voicemail', answeredBy: null, durationSeconds: 15, summary: null },
  ];
  const sources = callbackSources({
    log: [
      { direction: 'outbound', started_at: '2026-10-14T17:30:00Z', caller_phone: '+17602223333', duration_seconds: 20, ring_group: 'Liz' },
      { direction: 'outbound', started_at: '2026-10-14T19:30:00Z', caller_phone: '+17602223333', duration_seconds: 40, ring_group: 'Shanicey' },
    ],
  });
  const rows = annotateFeed(feed, sources, new Date('2026-10-14T22:00:00Z'), { attempts, fromMs });
  assert.match(rows[0].outreach ?? '', /^1 attempt/);
  assert.match(rows[0].outreach ?? '', /Liz/);
  assert.equal(rows[0].callback, 'Called back 10:30 AM PT, 20s');
  assert.match(rows[1].outreach ?? '', /^1 attempt/);
  assert.match(rows[1].outreach ?? '', /Shanicey/);
  assert.equal(rows[1].callback, 'Called back 12:30 PM PT, 40s');
  assert.equal(rows[2].outreach, 'No Voice attempts yet');
  assert.equal(rows[2].callback, 'No callback yet');
});

test('a blank staff name merges into the named row, and a missing call time counts nothing', () => {
  const named = dedupeOutreachAttempts([
    { at: '2026-10-23T16:30:57.782Z', phone: '+17605717808', staff: null, durationSeconds: 11 },
    { at: '2026-10-23T16:31:05.000Z', phone: '+17605717808', staff: 'Shanicey', durationSeconds: 4 },
  ]);
  assert.equal(named.length, 1);
  assert.equal(named[0].staff, 'Shanicey');
  assert.equal(named[0].durationSeconds, 11);
  const longerBlank = dedupeOutreachAttempts([
    { at: '2026-10-23T16:30:57.782Z', phone: '+17605717808', staff: 'Shanicey', durationSeconds: 4 },
    { at: '2026-10-23T16:31:05.000Z', phone: '+17605717808', staff: '', durationSeconds: 11 },
  ]);
  assert.equal(longerBlank.length, 1);
  assert.equal(longerBlank[0].staff, 'Shanicey');
  assert.equal(longerBlank[0].durationSeconds, 11);
  const twin = dedupeOutreachAttempts([
    { at: '2026-10-16T21:30:20.331Z', phone: '+16198557276', staff: 'Liz', durationSeconds: 0 },
    { at: '2026-10-16T21:30:31.428Z', phone: '6198557276', staff: 'Liz', durationSeconds: 0 },
  ]);
  assert.equal(twin.length, 1);
  const twoPeople = dedupeOutreachAttempts([
    { at: '2026-10-23T16:30:57.782Z', phone: '+17605717808', staff: 'Liz', durationSeconds: 11 },
    { at: '2026-10-23T16:31:05.000Z', phone: '+17605717808', staff: 'Shanicey', durationSeconds: 4 },
  ]);
  assert.equal(twoPeople.length, 2);
  const attempts = [{ at: '2026-10-23T16:30:57.782Z', phone: '+17605717808', staff: 'Shanicey', durationSeconds: 11 }];
  const missing = summarizeOutreach({
    phone: '7605717808', attempts, fromMs, now: new Date('2026-10-23T17:00:00Z'), anchorAt: '',
  });
  assert.equal(missing.attempts, 0);
  assert.equal(missing.label, 'No Voice attempts yet');
  const feed = annotateFeed([
    { at: '', name: 'Stephanie', phone: '(760) 571-7808', line: 'Mike', outcome: 'Mike (AI)', answeredBy: null, durationSeconds: 5, summary: null },
  ], [], new Date('2026-10-23T17:00:00Z'), { attempts, fromMs });
  assert.equal(feed[0].outreach, 'No Voice attempts yet');
  assert.equal(feed[0].callback, 'No callback yet');
});

test('past-due clients match Jobber phones and ignore other invoice statuses', () => {
  const clients = groupPastDueClients(
    [
      { client_id: 'C1', issued_date: '2026-10-02T15:00:00Z', invoice_status: 'past_due' },
      { client_id: 'C1', issued_date: '2026-09-01T15:00:00Z', invoice_status: 'past_due' },
      { client_id: 'C2', issued_date: '2026-10-03T15:00:00Z', invoice_status: 'paid' },
      { client_id: 'C3', issued_date: '2026-10-03T15:00:00Z', invoice_status: 'past_due' },
    ],
    [
      { id: 'C1', name: 'Owen', phones_digits: ['7603330004'] },
      { id: 'C3', name: 'No Phone', phones_digits: [] },
    ],
  );
  assert.equal(clients.length, 1);
  assert.equal(clients[0].issuedAt, '2026-09-01T15:00:00Z');
  assert.deepEqual(clients[0].phones, ['7603330004']);
  assert.equal(clients[0].pastDue, true);
});

test('answered calls hide empty attempt text; bookings show none', () => {
  const attempts = voiceAttempts([
    { direction: 'outbound', started_at: '2026-10-14T18:00:00Z', caller_phone: '+17602220009', duration_seconds: 0, ring_group: 'Liz', answered_by: 'lizbeth@scwellservice.com' },
    { direction: 'outbound', started_at: '2026-10-14T18:05:00Z', caller_phone: '+17604440001', duration_seconds: 20, ring_group: 'Shanicey' },
  ], DEFAULT_STAFF_LINES);
  const feed: FeedRow[] = [
    { at: '2026-10-14T16:20:00Z', name: 'Booked by Mike', phone: '(760) 444-0001', line: 'Mike', outcome: 'Booked', answeredBy: null, durationSeconds: 40, summary: null },
    { at: '2026-10-14T16:30:00Z', name: 'Still open', phone: '(760) 444-0002', line: 'Mike', outcome: 'Mike (AI)', answeredBy: null, durationSeconds: 50, summary: null },
    { at: '2026-10-14T16:35:00Z', name: 'Sarah booked', phone: '(760) 444-0004', line: 'Sarah', outcome: 'Sarah (AI)', answeredBy: null, durationSeconds: 40, summary: 'Booked a service call' },
    { at: '2026-10-14T16:40:00Z', name: 'Job later', phone: '(760) 444-0003', line: 'Main', outcome: 'Missed', answeredBy: null, durationSeconds: 0, summary: null },
    { at: '2026-10-14T17:06:00Z', name: 'Sam', phone: '(760) 222-0002', line: 'Main', outcome: 'Answered', answeredBy: 'Liz', durationSeconds: 60, summary: null },
    { at: '2026-10-14T17:10:00Z', name: 'Pat', phone: '(760) 222-0009', line: 'Main', outcome: 'Answered', answeredBy: 'Shanicey', durationSeconds: 30, summary: null },
  ];
  const work = indexWorkTimes([
    { phone: '7604440004', at: '2026-10-14T17:00:00Z' },
    { phone: '7604440003', at: '2026-10-14T17:00:00Z' },
  ]);
  const rows = annotateFeed(feed, [], now, { attempts, fromMs, work });
  assert.equal(rows[0].outreach, null);
  assert.equal(rows[0].callback, null);
  assert.equal(rows[0].goingCold, false);
  assert.equal(rows[1].outreach, 'No Voice attempts yet');
  assert.equal(rows[2].outreach, null);
  assert.equal(rows[2].callback, null);
  assert.equal(rows[3].outreach, null);
  assert.equal(rows[4].outreach, null);
  assert.equal(rows[4].goingCold, false);
  assert.match(rows[5].outreach ?? '', /^1 attempt, last/);
  assert.match(rows[5].outreach ?? '', /Liz/);
  assert.equal(rows[5].goingCold, false);
});

test('an AI booking is not a needs-callback lead', () => {
  const log = [
    { direction: 'inbound', outcome: 'forwarded_ai', started_at: '2026-10-14T16:20:00Z', caller_phone: '+17604440001', duration_seconds: 40, receptionist_call_id: 'booked-9', client_name: 'Booked by Mike' },
    { direction: 'inbound', outcome: 'forwarded_ai', started_at: '2026-10-14T16:30:00Z', caller_phone: '+17604440002', duration_seconds: 50, client_name: 'Still open' },
    { direction: 'inbound', outcome: 'missed', started_at: '2026-10-14T16:40:00Z', caller_phone: '+17604440003', duration_seconds: 0, ring_seconds: 20, client_name: 'Job later' },
    { direction: 'inbound', outcome: 'forwarded_ai', started_at: '2026-10-14T16:50:00Z', caller_phone: '+17604440004', duration_seconds: 45, client_name: 'Request later' },
  ];
  const candidates = callbackCandidates({ log, recordings: [], mike: [], bookedMike: new Set(['booked-9']) });
  assert.equal(candidates.find((c) => c.name === 'Booked by Mike')?.aiBooked, true);
  const work = indexWorkTimes([
    { phone: '7604440003', at: '2026-10-14T17:00:00Z' },
    { phone: '7604440004', at: '2026-10-14T17:05:00Z' },
  ]);
  const view = needsCallback({ candidates, sources: callbackSources({ log }), work, fromMs, now });
  assert.deepEqual(view.leads.rows.map((r) => r.name), ['Still open']);
  assert.equal(view.invoices.count, 0);
});

test('invoice follow-up is separate from new leads and keeps attempt counts', () => {
  const log = [
    { direction: 'inbound', outcome: 'missed', started_at: '2026-10-14T16:00:00Z', caller_phone: '+17605550001', duration_seconds: 0, ring_seconds: 22, client_name: 'New lead' },
    { direction: 'inbound', outcome: 'missed', started_at: '2026-10-14T16:10:00Z', caller_phone: '+1 (760) 555-0002', duration_seconds: 0, ring_seconds: 30, client_name: 'No water at the house' },
    { direction: 'inbound', outcome: 'voicemail', started_at: '2026-10-14T16:20:00Z', caller_phone: '7605550003', duration_seconds: 40, client_name: 'Calling about the past due invoice' },
    { direction: 'inbound', outcome: 'missed', started_at: '2026-10-14T16:30:00Z', caller_phone: '+17605550004', duration_seconds: 0, ring_seconds: 25, client_name: 'Paid caller' },
    { direction: 'outbound', started_at: '2026-10-14T18:00:00Z', caller_phone: '+17605550005', duration_seconds: 0, ring_group: 'Liz', answered_by: 'lizbeth@scwellservice.com' },
  ];
  const candidates = callbackCandidates({ log, recordings: [], mike: [], bookedMike: [] });
  const attempts = voiceAttempts(log, DEFAULT_STAFF_LINES);
  const invoices = groupPastDueClients(
    [
      { client_id: 'A', issued_date: '2026-10-02T15:00:00Z', invoice_status: 'awaiting_payment', data: { amounts: { total: 500, paymentsTotal: 100 } } },
      { client_id: 'B', issued_date: '2026-09-20T15:00:00Z', invoice_status: 'past_due', data: { amounts: { total: 80, paymentsTotal: 0 } } },
      { client_id: 'C', issued_date: '2026-10-01T15:00:00Z', invoice_status: 'awaiting_payment', data: { amounts: { total: 40, paymentsTotal: 0 } } },
      { client_id: 'D', issued_date: '2026-10-01T15:00:00Z', invoice_status: 'paid', data: { amounts: { total: 10, paymentsTotal: 0 } } },
      { client_id: 'E', issued_date: '2026-09-01T15:00:00Z', invoice_status: 'past_due', data: { amounts: { total: 200, paymentsTotal: 50 } } },
      { client_id: 'E', issued_date: '2026-10-05T15:00:00Z', invoice_status: 'past_due', data: { amounts: { total: 20, paymentsTotal: 20 } } },
    ],
    [
      { id: 'A', name: 'No Water', phones_digits: ['7605550002'] },
      { id: 'B', name: 'Invoice Caller', phones_digits: ['(760) 555-0003'] },
      { id: 'C', name: 'Quiet Open', phones_digits: ['7605550009'] },
      { id: 'D', name: 'Paid', phones_digits: ['7605550004'] },
      { id: 'E', name: 'Owen', phones_digits: ['7605550005'] },
    ],
  );
  const view = needsCallback({
    candidates, sources: callbackSources({ log }), work: indexWorkTimes([]), fromMs, now, attempts, pastDue: invoices,
    inbound: log.filter((r) => r.direction !== 'outbound').map((r) => ({ at: r.started_at, phone: r.caller_phone })),
  });
  assert.deepEqual(view.leads.rows.map((r) => r.name).sort(), ['New lead', 'Paid caller']);
  assert.equal(view.leads.rows.some((r) => r.phone.includes('555-0002')), false);
  assert.equal(view.invoices.rows.some((r) => r.name === 'Paid'), false);
  assert.deepEqual(view.invoices.rows.map((r) => r.name), ['No Water', 'Owen', 'Invoice Caller', 'Quiet Open']);
  const noWater = view.invoices.rows.find((r) => r.name === 'No Water');
  assert.equal(noWater?.calledAfter, 'Called us Oct 14, 9:10 AM (after invoice)');
  assert.equal(noWater?.alsoCalledIn, false);
  assert.equal(noWater?.balance, 400);
  assert.equal(noWater?.outcome, 'Awaiting payment');
  assert.equal(noWater?.pastDue, false);
  assert.equal(noWater?.outreach, '0 calls · texts unavailable · email unavailable');
  assert.equal(noWater?.goingCold, true);
  const inv = view.invoices.rows.find((r) => r.name === 'Invoice Caller');
  assert.equal(inv?.calledAfter, 'Called us Oct 14, 9:20 AM (after invoice)');
  assert.equal(inv?.pastDue, true);
  assert.equal(inv?.balance, 80);
  assert.equal(inv?.goingCold, true);
  const quiet = view.invoices.rows.find((r) => r.name === 'Quiet Open');
  assert.equal(quiet?.calledAfter, null);
  assert.equal(quiet?.balance, 40);
  const owen = view.invoices.rows.find((r) => r.name === 'Owen');
  assert.equal(owen?.phone, '(760) 555-0005');
  assert.equal(owen?.balance, 150);
  assert.match(owen?.outreach ?? '', /^1 call · /);
  assert.match(owen?.outreach ?? '', /last: call by Liz Oct 14/);
  assert.equal(view.invoices.totalOwed, 670);
  assert.equal(view.invoices.rows.some((r) => r.name === 'No Water' && view.leads.rows.some((l) => l.phone === r.phone)), false);
});

test('balance column decides unpaid; status is the fallback', () => {
  const withBalance = groupPastDueClients(
    [
      { client_id: 'A', issued_date: '2026-10-01T00:00:00Z', invoice_status: 'paid', balance: 25 },
      { client_id: 'B', issued_date: '2026-10-02T00:00:00Z', invoice_status: 'past_due', balance: 0 },
      { client_id: 'C', issued_date: '2026-10-03T00:00:00Z', invoice_status: 'awaiting_payment', balance: 40 },
      { client_id: 'C', issued_date: '2026-09-01T00:00:00Z', invoice_status: 'past_due', balance: 10 },
    ],
    [
      { id: 'A', name: 'Stale paid', phones_digits: ['7605550101'] },
      { id: 'B', name: 'Zero', phones_digits: ['7605550102'] },
      { id: 'C', name: 'Owes', phones_digits: ['7605550103'] },
    ],
    { hasBalanceColumn: true },
  );
  assert.deepEqual(withBalance.map((c) => c.name).sort(), ['Owes', 'Stale paid']);
  const owes = withBalance.find((c) => c.name === 'Owes');
  assert.equal(owes?.balance, 50);
  assert.equal(owes?.pastDue, true);
  assert.equal(owes?.issuedAt, '2026-09-01T00:00:00Z');
  assert.equal(withBalance.find((c) => c.name === 'Stale paid')?.pastDue, false);
  const openOnly = needsCallback({
    candidates: [], sources: [], work: indexWorkTimes([]), fromMs, now, pastDue: withBalance,
  });
  assert.deepEqual(openOnly.invoices.rows.map((r) => r.name), ['Owes']);
  assert.equal(openOnly.leads.count, 0);
});

test('production shapes: a phone intake is not a booking, and past-due invoices still list', () => {
  assert.equal(balanceColumnMissing({ code: '42703', message: 'column jobber_invoices.balance does not exist' }), true);
  assert.equal(balanceColumnMissing({
    code: 'PGRST204',
    message: "Could not find the 'balance' column of 'jobber_invoices' in the schema cache",
  }), true);
  assert.equal(balanceColumnMissing({ code: '42501', message: 'permission denied for table jobber_invoices' }), false);
  assert.equal(balanceColumnMissing(null), false);
  assert.equal(requestResolvesCallback('phone'), false);
  assert.equal(requestResolvesCallback('PHONE'), false);
  assert.equal(requestResolvesCallback('website'), true);

  const clientId = 'Z2lkOi8vSm9iYmVyL0NsaWVudC8xMjM=';
  const pastDue = groupPastDueClients(
    [{
      client_id: clientId,
      issued_date: '2026-08-15T17:00:00.000Z',
      invoice_status: 'past_due',
      data: { amounts: { subtotal: 1100, total: 1200, taxAmount: 100, paymentsTotal: 200, discountAmount: 0 } },
    }],
    [{ id: clientId, name: 'Ada Wells', phones_digits: ['7605551212'] }],
    { hasBalanceColumn: false },
  );
  assert.equal(pastDue.length, 1);
  assert.equal(pastDue[0].balance, 1000);
  assert.equal(pastDue[0].pastDue, true);
  assert.deepEqual(pastDue[0].phones, ['7605551212']);

  const log = [
    { direction: 'inbound', outcome: 'forwarded_ai', started_at: '2026-10-10T18:00:00Z', caller_phone: '+1 (760) 555-3434', duration_seconds: 95, ring_seconds: 8, receptionist_call_id: 'vapi-ada', client_name: 'Ada Caller' },
    { direction: 'inbound', outcome: 'forwarded_ai', started_at: '2026-10-11T18:00:00Z', caller_phone: '7605555656', duration_seconds: 80, receptionist_call_id: 'vapi-job', client_name: 'Got a job' },
  ];
  const candidates = callbackCandidates({ log, recordings: [], mike: [], bookedMike: new Set(['vapi-ada']) });
  // vapi-ada is only on a source=phone intake row, so the route does not pass it as booked.
  const open = callbackCandidates({ log, recordings: [], mike: [], bookedMike: new Set(requestResolvesCallback('phone') ? ['vapi-ada'] : []) });
  assert.equal(open.find((c) => c.name === 'Ada Caller')?.aiBooked, false);
  assert.equal(candidates.find((c) => c.name === 'Ada Caller')?.aiBooked, true);
  const requests = [
    { source: 'phone', status: 'pending', service_type: 'Phone Inquiry', phone: '(760) 555-3434', created_at: '2026-10-10T18:01:00Z' },
    { source: 'website', status: 'pending', service_type: 'new_well', phone: '7605555656', created_at: '2026-10-11T19:00:00Z' },
  ];
  const work = indexWorkTimes(requests.filter((r) => requestResolvesCallback(r.source)).map((r) => ({ phone: r.phone, at: r.created_at })));
  const view = needsCallback({ candidates: open, sources: [], work, fromMs, now, pastDue });
  assert.deepEqual(view.leads.rows.map((r) => r.name), ['Ada Caller']);
  assert.equal(view.invoices.count, 1);
  assert.equal(view.invoices.rows[0].name, 'Ada Wells');
  assert.equal(view.invoices.rows[0].balance, 1000);
  assert.equal(view.invoices.rows[0].outcome, 'Past due');
  assert.equal(view.leads.rows.some((r) => r.name === 'Got a job'), false);
});

test('shop work on the call date, including a cancelled job, drops the lead', () => {
  const callAt = '2026-10-11T23:10:30Z'; // 4:10 PM PT Oct 11
  const log = [
    { direction: 'inbound', outcome: 'forwarded_ai', started_at: callAt, caller_phone: '+16198557276', duration_seconds: 125, client_name: 'Cecilia Catlin' },
    { direction: 'inbound', outcome: 'forwarded_ai', started_at: '2026-10-11T20:00:00Z', caller_phone: '+17605550111', duration_seconds: 40, client_name: 'Same day job' },
    { direction: 'inbound', outcome: 'missed', started_at: '2026-10-10T18:00:00Z', caller_phone: '+17605550222', duration_seconds: 0, ring_seconds: 20, client_name: 'Still waiting' },
  ];
  const work = indexWorkTimes([
    { phone: '6198557276', at: '2026-10-12T17:00:00Z' },
    { phone: '7605550111', at: '2026-10-11T16:00:00Z' },
  ]);
  assert.equal(hasWorkOnOrAfter('6198557276', callAt, work), true);
  assert.equal(hasWorkAfter('7605550111', '2026-10-11T20:00:00Z', work), false);
  assert.equal(hasWorkOnOrAfter('7605550111', '2026-10-11T20:00:00Z', work), true);
  const view = needsCallback({
    candidates: callbackCandidates({ log, recordings: [], mike: [] }),
    sources: [], work, fromMs, now,
  });
  assert.deepEqual(view.leads.rows.map((r) => r.name), ['Still waiting']);
});

test('open invoices list every past-due and awaiting invoice, with collection counts and only a later call', () => {
  const issued = '2026-10-01T17:00:00Z';
  const open = listOpenInvoices(
    [
      { id: 'I1', client_id: 'C1', issued_date: issued, invoice_status: 'past_due', data: { invoiceNumber: '5806', dueDate: '2026-10-08T17:00:00Z', amounts: { total: 800, paymentsTotal: 0 } } },
      { id: 'I2', client_id: 'C1', issued_date: '2026-10-12T17:00:00Z', invoice_status: 'awaiting_payment', data: { invoiceNumber: 5807, dueDate: '2026-10-20T17:00:00Z', amounts: { total: 50, paymentsTotal: 10 } } },
      { id: 'I3', client_id: 'C2', issued_date: issued, invoice_status: 'paid', data: { invoiceNumber: '1', amounts: { total: 10, paymentsTotal: 0 } } },
      { id: 'I4', client_id: 'C3', issued_date: issued, invoice_status: 'past_due', data: { invoiceNumber: '9', dueDate: '2026-09-01T17:00:00Z', amounts: { total: 2000, paymentsTotal: 500 } } },
    ],
    [
      { id: 'C1', name: 'Kevin and Dominique Cardinal', phones_digits: ['7608038863', '(760) 555-0199'] },
      { id: 'C2', name: 'Paid', phones_digits: ['7605550004'] },
      { id: 'C3', name: 'Big balance', phones_digits: [] },
    ],
  );
  assert.deepEqual(open.map((r) => r.number), ['5806', '5807', '9']);
  const before = '2026-09-20T18:00:00Z';
  const after = '2026-10-13T21:14:00Z';
  assert.equal(calledAfterInvoice(['7608038863'], issued, [{ at: before, phone: '7608038863' }]), null);
  assert.equal(calledAfterInvoice(['7608038863'], issued, [
    { at: before, phone: '7608038863' },
    { at: after, phone: '+1 (760) 803-8863' },
  ]), 'Called us Oct 13, 2:14 PM (after invoice)');
  const label = formatCollectionAttempts({
    phones: ['7608038863', '7605550199'],
    clientId: 'C1',
    invoiceNumber: '5806',
    sinceIso: issued,
    channels: { calls: true, appTexts: true, jobberTexts: true, emails: true },
    events: [
      { at: '2026-09-01T18:00:00Z', channel: 'call', source: 'voice', phone: '7608038863', by: 'Liz' },
      { at: '2026-10-10T18:00:00Z', channel: 'call', source: 'voice', phone: '7608038863', by: 'Liz' },
      { at: '2026-10-11T18:00:00Z', channel: 'call', source: 'voice', phone: '7605550199', by: 'Shanicey' },
      { at: '2026-10-12T18:00:00Z', channel: 'call', source: 'voice', phone: '7608038863', by: 'Brighton' },
      { at: '2026-10-09T18:00:00Z', channel: 'text', source: 'app_sms', clientId: 'C1', invoiceNumbers: ['5806'] },
      { at: '2026-10-12T20:00:00Z', channel: 'text', source: 'jobber_sms', clientId: 'C1', by: 'Liz' },
      { at: '2026-10-08T18:00:00Z', channel: 'email', source: 'jobber_email', clientId: 'C1', by: 'Liz', invoiceNumbers: ['5806'], subject: 'Invoice #5806' },
    ],
  });
  assert.equal(label, '3 calls · 2 texts · 1 email · Gmail unavailable · last: text by Liz Oct 12');
  const unavailable = formatCollectionAttempts({
    phones: ['7608038863'], clientId: 'C1', invoiceNumber: '5806', sinceIso: issued,
    channels: { calls: true, appTexts: true, jobberTexts: false, emails: false },
    events: [{ at: '2026-10-09T18:00:00Z', channel: 'text', source: 'app_sms', clientId: 'C1' }],
  });
  assert.equal(unavailable, '0 calls · 1 text · Jobber texts unavailable · email unavailable · last: text Oct 9');
  const view = needsCallback({
    candidates: callbackCandidates({
      log: [{ direction: 'inbound', outcome: 'forwarded_ai', started_at: before, caller_phone: '7608038863', duration_seconds: 80, client_name: 'Kevin and Dominique Cardinal' }],
      recordings: [], mike: [],
    }),
    sources: [], work: indexWorkTimes([]), fromMs, now,
    openInvoices: open,
    inbound: [{ at: before, phone: '7608038863' }, { at: after, phone: '7608038863' }],
    channels: { calls: true, appTexts: true, jobberTexts: false, emails: false },
    collections: [{ at: '2026-10-09T18:00:00Z', channel: 'text', source: 'app_sms', clientId: 'C1', invoiceNumbers: ['5806'] }],
  });
  assert.equal(view.leads.count, 0);
  assert.equal(view.invoices.count, 3);
  assert.equal(view.invoices.rows[0].name, 'Big balance');
  assert.equal(view.invoices.rows[0].balance, 1500);
  assert.equal(view.invoices.rows[0].phone, 'No phone on file');
  assert.equal(view.invoices.rows[0].daysPastDue != null && view.invoices.rows[0].daysPastDue > 0, true);
  const cardinal = view.invoices.rows.find((r) => r.invoiceNumber === '5806');
  assert.equal(cardinal?.calledAfter, 'Called us Oct 13, 2:14 PM (after invoice)');
  assert.equal(cardinal?.alsoCalledIn, false);
  assert.match(cardinal?.outreach ?? '', /1 text · Jobber texts unavailable · email unavailable/);
  const later = view.invoices.rows.find((r) => r.invoiceNumber === '5807');
  assert.equal(later?.calledAfter, 'Called us Oct 13, 2:14 PM (after invoice)');
  assert.equal(later?.daysPastDue, 0);
  assert.equal(view.invoices.totalOwed, 800 + 40 + 1500);
});

test('staff line list is configurable', () => {
  const lines = staffLines({ VOICE_STAFF_LINES: 'Liz:lizbeth@scwellservice.com:+16193208264,Alex:alex@scwellservice.com:' } as NodeJS.ProcessEnv);
  assert.deepEqual(lines.map((l) => l.name), ['Liz', 'Alex']);
  assert.equal(lines[1].phone, null);
  assert.equal(staffLabel('alex@scwellservice.com', null, lines), 'Alex');
  assert.equal(staffLabel(null, '+16193208264', lines), 'Liz');
  assert.equal(staffLines({} as NodeJS.ProcessEnv).some((l) => l.name === 'Brighton' && l.phone === '6192590410'), true);
});

test('twilio outbound from a tracking number is stored', () => {
  const rows = parseTwilioOutbound({
    calls: [
      { sid: 'CA1', from: '+17603312502', to: '+17605551212', direction: 'outbound-api', start_time: 'Wed, 14 Oct 2026 18:00:00 +0000', duration: '55', status: 'completed' },
      { sid: 'CA2', from: '+15555550100', to: '+17605551212', direction: 'outbound-api', start_time: 'Wed, 14 Oct 2026 18:05:00 +0000', duration: '10', status: 'completed' },
      { sid: 'CA3', from: '+17603312502', to: '+17605550000', direction: 'inbound', start_time: 'Wed, 14 Oct 2026 18:06:00 +0000', duration: '10', status: 'completed' },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].voice_call_key, 'twilio:CA1');
  assert.equal(rows[0].direction, 'outbound');
  assert.equal(rows[0].caller_phone, '+17605551212');
  assert.equal(rows[0].ring_group, 'Ads');
  assert.equal(rows[0].duration_seconds, 55);
});

test('a collection call matches the Jobber client when the dialed number is not on the invoice', () => {
  const attempts = voiceAttempts([
    { direction: 'outbound', started_at: '2026-10-14T17:59:27Z', caller_phone: '+13103516864', answered_by: 'lizbeth@scwellservice.com', called_number: '+16193208264', jobber_client_id: 'C-DEIDREH' },
    { direction: 'outbound', started_at: '2026-10-14T18:00:00Z', caller_phone: '+17605550111', answered_by: 'office@example.com', called_number: '+17604408520' },
  ], DEFAULT_STAFF_LINES);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].staff, 'Liz');
  assert.equal(attempts[0].clientId, 'C-DEIDREH');
  const label = formatCollectionAttempts({
    phones: ['7604190997'],
    emails: ['nancy@pacificaglass.net'],
    clientId: 'C1',
    invoiceNumber: '5818',
    sinceIso: '2026-09-30T20:54:50Z',
    channels: { calls: true, appTexts: true, jobberTexts: false, emails: false, gmail: true },
    events: [
      { at: '2026-10-14T17:59:27Z', channel: 'call', source: 'voice', phone: '3103516864', clientId: 'C1', by: 'Liz' },
      { at: '2026-10-05T18:25:18Z', channel: 'email', source: 'gmail', by: 'Brighton', invoiceNumbers: ['5818'], toEmails: ['nancy@pacificaglass.net'] },
      { at: '2026-10-13T18:41:26Z', channel: 'email', source: 'gmail', by: 'Brighton', toEmails: ['pwrobinson33@yahoo.com'] },
      { at: '2026-10-07T18:00:00Z', channel: 'text', source: 'app_sms', clientId: 'C1', invoiceNumbers: ['9999'] },
    ],
  });
  assert.equal(label, '1 call · 0 texts · Jobber texts unavailable · 1 email · Jobber emails unavailable · last: call by Liz Oct 14');
  const hidden = formatCollectionAttempts({
    phones: ['7604190997'],
    emails: ['nancy@pacificaglass.net'],
    clientId: 'C1',
    invoiceNumber: '5818',
    sinceIso: '2026-09-30T20:54:50Z',
    channels: { calls: true, appTexts: true, jobberTexts: true, emails: true },
    events: [
      { at: '2026-10-05T18:25:18Z', channel: 'email', source: 'gmail', by: 'Brighton', invoiceNumbers: ['5818'], toEmails: ['nancy@pacificaglass.net'] },
    ],
  });
  assert.equal(hidden, '0 calls · 0 texts · 0 emails · Gmail unavailable');
  const partial = formatCollectionAttempts({
    phones: ['7604190997'],
    emails: ['nancy@pacificaglass.net'],
    clientId: 'C1',
    invoiceNumber: '5818',
    sinceIso: '2026-09-30T20:54:50Z',
    channels: { calls: true, appTexts: true, jobberTexts: true, emails: true, gmail: true, gmailMissing: ['Liz'] },
    events: [
      { at: '2026-10-05T18:25:18Z', channel: 'email', source: 'gmail', by: 'Brighton', invoiceNumbers: ['5818'], toEmails: ['nancy@pacificaglass.net'] },
    ],
  });
  assert.equal(partial, '0 calls · 0 texts · 1 email · Liz Gmail unavailable · last: email by Brighton Oct 5');
  const allClosed = formatCollectionAttempts({
    phones: ['7604190997'],
    emails: ['kareneddy48@gmail.com'],
    clientId: 'C1',
    invoiceNumber: '5785',
    sinceIso: '2026-09-24T13:57:11Z',
    channels: { calls: true, appTexts: true, jobberTexts: true, emails: true, gmail: false, gmailMissing: ['Brighton', 'Liz', 'Shanicey'] },
    events: [],
  });
  assert.equal(allClosed, '0 calls · 0 texts · 0 emails · Brighton Gmail unavailable · Liz Gmail unavailable · Shanicey Gmail unavailable');
  const karen = formatCollectionAttempts({
    phones: [],
    emails: ['kareneddy48@gmail.com'],
    clientId: 'C-KAREN',
    invoiceNumber: '5785',
    sinceIso: '2026-09-24T13:57:11Z',
    channels: { calls: true, appTexts: true, jobberTexts: true, emails: true, gmail: true },
    events: [
      { at: '2026-09-28T18:33:41Z', channel: 'email', source: 'gmail', by: 'Brighton', invoiceNumbers: ['5785'], toEmails: ['keddy48@gmail.com'] },
      { at: '2026-10-05T18:25:02Z', channel: 'email', source: 'gmail', by: 'Brighton', invoiceNumbers: ['5785', '5829'], toEmails: ['keddy48@gmail.com'] },
      { at: '2026-10-08T19:39:52Z', channel: 'email', source: 'gmail', by: 'Brighton', invoiceNumbers: ['5785', '5829'], toEmails: ['kareneddy48@gmail.com'] },
      { at: '2026-10-14T18:29:46Z', channel: 'email', source: 'gmail', by: 'Brighton', invoiceNumbers: ['5785'], toEmails: ['kareneddy48@gmail.com'] },
    ],
  });
  assert.equal(karen, '0 calls · 0 texts · 2 emails · last: email by Brighton Oct 14');
  const loose = formatCollectionAttempts({
    phones: [],
    emails: ['kareneddy48@gmail.com'],
    clientId: 'C-KAREN',
    invoiceNumber: '5785',
    balance: 200,
    sinceIso: '2026-09-24T13:57:11Z',
    channels: { calls: true, appTexts: true, jobberTexts: true, emails: true, gmail: true },
    events: [
      { at: '2026-10-08T19:39:52Z', channel: 'email', source: 'gmail', by: 'Brighton', subject: 'Invoices #5785 and #5829 from SCWS', invoiceNumbers: ['5785', '5829'], toEmails: ['kareneddy48@gmail.com'] },
      { at: '2026-10-09T18:00:00Z', channel: 'email', source: 'gmail', by: 'Brighton', subject: 'Quote for the new pump', toEmails: ['kareneddy48@gmail.com'] },
      { at: '2026-10-10T18:00:00Z', channel: 'email', source: 'gmail', by: 'Brighton', subject: 'See you Tuesday', toEmails: ['kareneddy48@gmail.com'] },
      { at: '2026-10-11T18:00:00Z', channel: 'email', source: 'gmail', by: 'Brighton', subject: 'Thanks', toEmails: ['kareneddy48@gmail.com'] },
      { at: '2026-10-12T18:00:00Z', channel: 'email', source: 'gmail', by: 'Brighton', subject: 'Your balance of $200 is due', amounts: [200], paymentRequest: true, toEmails: ['kareneddy48@gmail.com'] },
    ],
  });
  assert.equal(loose, '0 calls · 0 texts · 2 emails · last: email by Brighton Oct 12');
  const view = needsCallback({
    candidates: [],
    sources: [],
    work: indexWorkTimes([]),
    fromMs,
    now,
    openInvoices: [{
      id: 'K', number: '5785', clientId: 'C-KAREN', name: 'Karen Eddy', phones: [],
      emails: ['kareneddy48@gmail.com'], issuedAt: '2026-09-24T13:57:11Z', dueAt: null,
      status: 'past_due', balance: 200,
    }],
    collections: [
      { at: '2026-10-08T19:39:52Z', channel: 'email', source: 'gmail', by: 'Brighton', subject: 'Invoices #5785 and #5829 from SCWS', invoiceNumbers: ['5785', '5829'], toEmails: ['kareneddy48@gmail.com'] },
      { at: '2026-10-14T18:29:46Z', channel: 'email', source: 'gmail', by: 'Brighton', subject: 'Invoice #5785 from SCWS', invoiceNumbers: ['5785'], amounts: [200], paymentLink: true, toEmails: ['kareneddy48@gmail.com'] },
      { at: '2026-10-09T18:00:00Z', channel: 'email', source: 'gmail', by: 'Brighton', subject: 'See you Tuesday', toEmails: ['kareneddy48@gmail.com'] },
    ],
    channels: { calls: true, appTexts: true, jobberTexts: false, emails: false, gmail: true },
  });
  assert.deepEqual(view.invoices.rows[0].collectionEmails, [
    { at: '2026-10-08T19:39:52Z', by: 'Brighton', subject: 'Invoices #5785 and #5829 from SCWS' },
    { at: '2026-10-14T18:29:46Z', by: 'Brighton', subject: 'Invoice #5785 from SCWS' },
  ]);
});

test('Mike callback attempts stay off the invoice collection count', () => {
  const view = needsCallback({
    candidates: [],
    sources: [],
    work: indexWorkTimes([]),
    fromMs,
    now,
    attempts: [{ at: '2026-10-14T18:00:00Z', phone: '7608038863', staff: 'Mike', durationSeconds: 1 }],
    openInvoices: [{
      id: 'I', number: '1', clientId: 'C', name: 'Ada', phones: ['7608038863'],
      issuedAt: '2026-10-01T17:00:00Z', dueAt: null, status: 'past_due', balance: 10,
    }],
    channels: { calls: true, appTexts: false, jobberTexts: false, emails: false },
  });
  assert.match(view.invoices.rows[0].outreach ?? '', /^0 calls/);
});

test('twilio collection texts keep the invoice number and skip inbound', () => {
  const rows = parseTwilioCollectionMessages({
    messages: [
      { sid: 'SM1', from: '+17608237963', to: '+17604190997', direction: 'outbound-api', date_sent: 'Tue, 07 Oct 2026 18:00:00 +0000', body: 'Invoice #5656 is past due' },
      { sid: 'SM1', from: '+17608237963', to: '+17604190997', direction: 'outbound-api', date_sent: 'Tue, 07 Oct 2026 18:00:00 +0000', body: 'duplicate' },
      { sid: 'SM2', from: '+17603312502', to: '+17604190997', direction: 'outbound-api', date_sent: 'Tue, 07 Oct 2026 18:05:00 +0000', body: 'Invoice #1' },
      { sid: 'SM3', from: '+17608237963', to: '+17608237963', direction: 'inbound', date_sent: 'Tue, 07 Oct 2026 18:06:00 +0000', body: 'STOP' },
    ],
  }, new Set(['7608237963']));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sid, 'SM1');
  assert.equal(rows[0].to, '+17604190997');
  assert.match(rows[0].body, /5656/);
});

test('past due follows the due date when Jobber gives one, else Jobber status', async () => {
  const { invoiceIsPastDue } = await import('./callbacks.ts');
  assert.equal(invoiceIsPastDue('past_due', 0), false); // due today: not past due yet
  assert.equal(invoiceIsPastDue('awaiting_payment', 3), true); // due date passed, status not refreshed yet
  assert.equal(invoiceIsPastDue('past_due', null), true);
  assert.equal(invoiceIsPastDue('awaiting_payment', null), false);
});
