import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateFeed, callbackCandidates, callbackSources, firstCallback, formatCallbackStatus,
  hasWorkAfter, indexWorkTimes, isHangupUnder10s, needsCallback,
} from './callbacks.ts';
import { staffLines, staffLabel } from './staff-lines.ts';
import { parseTwilioOutbound } from './twilio-outbound.ts';
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
  assert.deepEqual(since.rows.map((r) => r.phone), ['(760) 111-0007']);
  assert.equal(since.count, 1);
  assert.equal(since.rows[0].outcome, 'Missed');
  const monthStart = Date.parse('2026-10-01T07:00:00Z');
  const month = needsCallback({ candidates, sources, work, fromMs: monthStart, now });
  assert.equal(month.count, 1);
  const thisWeek = needsCallback({ candidates, sources, work, fromMs: Date.parse('2026-10-13T07:00:00Z'), now });
  assert.equal(thisWeek.count, 0);
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
});

test('staff line list is configurable', () => {
  const lines = staffLines({ VOICE_STAFF_LINES: 'Liz:lizbeth@scwellservice.com:+16193208264,Alex:alex@scwellservice.com:' } as NodeJS.ProcessEnv);
  assert.deepEqual(lines.map((l) => l.name), ['Liz', 'Alex']);
  assert.equal(lines[1].phone, null);
  assert.equal(staffLabel('alex@scwellservice.com', null, lines), 'Alex');
  assert.equal(staffLabel(null, '+16193208264', lines), 'Liz');
  assert.equal(staffLines({} as NodeJS.ProcessEnv).some((l) => l.name === 'Brighton' && l.phone === null), true);
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
