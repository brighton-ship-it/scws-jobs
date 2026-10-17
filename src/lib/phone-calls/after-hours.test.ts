import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { businessHours, isOfficeHours, directToAi, localDayMinute, AI_RECEPTIONIST } from './config.ts';
import { buildAfterHoursAiTwiml } from './twiml.ts';

const d = (iso: string) => new Date(iso);
const env = {} as NodeJS.ProcessEnv;
const h = businessHours(env);

describe('office hours (default Mon-Fri 07:00-17:00 America/Los_Angeles)', () => {
  it('defaults', () => {
    assert.deepEqual(h, { days: [1, 2, 3, 4, 5], openMin: 420, closeMin: 1020, tz: 'America/Los_Angeles', enabled: true });
  });
  it('weekday mid-day is in hours', () => {
    assert.equal(isOfficeHours(d('2026-10-14T19:00:00Z'), h), true); // Wed 12:00 PDT
  });
  it('4:59 PM in, 5:00 PM out', () => {
    assert.equal(isOfficeHours(d('2026-10-16T23:59:00Z'), h), true); // Fri 16:59 PDT
    assert.equal(isOfficeHours(d('2026-10-17T00:00:00Z'), h), false); // Fri 17:00 PDT
  });
  it('6:59 AM out, 7:00 AM in', () => {
    assert.equal(isOfficeHours(d('2026-10-12T13:59:00Z'), h), false); // Mon 06:59 PDT
    assert.equal(isOfficeHours(d('2026-10-12T14:00:00Z'), h), true); // Mon 07:00 PDT
  });
  it('weekends are out all day', () => {
    assert.equal(isOfficeHours(d('2026-10-17T18:00:00Z'), h), false); // Sat 11:00 PDT
    assert.equal(isOfficeHours(d('2026-10-18T20:00:00Z'), h), false); // Sun 13:00 PDT
    assert.equal(isOfficeHours(d('2026-10-17T06:59:00Z'), h), false); // Fri 23:59 PDT
  });
  it('DST: fall back (Nov 1 2026) keeps 7:00/17:00 local', () => {
    assert.equal(isOfficeHours(d('2026-10-30T14:00:00Z'), h), true); // Fri 07:00 PDT
    assert.equal(isOfficeHours(d('2026-11-02T14:00:00Z'), h), false); // Mon 06:00 PST
    assert.equal(isOfficeHours(d('2026-11-02T14:59:00Z'), h), false); // Mon 06:59 PST
    assert.equal(isOfficeHours(d('2026-11-02T15:00:00Z'), h), true); // Mon 07:00 PST
    assert.equal(isOfficeHours(d('2026-11-03T00:59:00Z'), h), true); // Mon 16:59 PST
    assert.equal(isOfficeHours(d('2026-11-03T01:00:00Z'), h), false); // Mon 17:00 PST
    assert.deepEqual(localDayMinute(d('2026-11-01T09:30:00Z'), h.tz), { day: 0, minute: 90 }); // Sun 01:30 PST (repeated hour)
  });
  it('DST: spring forward (Mar 8 2026)', () => {
    assert.equal(isOfficeHours(d('2026-03-06T15:00:00Z'), h), true); // Fri 07:00 PST
    assert.equal(isOfficeHours(d('2026-03-09T13:59:00Z'), h), false); // Mon 06:59 PDT
    assert.equal(isOfficeHours(d('2026-03-09T14:00:00Z'), h), true); // Mon 07:00 PDT
  });
  it('env overrides (days, hours, tz, off switch); bad values fall back', () => {
    const e = { PHONE_CALL_HOURS_DAYS: '1-6', PHONE_CALL_HOURS_OPEN: '08:00', PHONE_CALL_HOURS_CLOSE: '12:00' } as any;
    assert.equal(isOfficeHours(d('2026-10-17T15:30:00Z'), businessHours(e)), true); // Sat 08:30 PDT
    assert.equal(isOfficeHours(d('2026-10-14T19:30:00Z'), businessHours(e)), false); // Wed 12:30 PDT
    assert.deepEqual(businessHours({ PHONE_CALL_HOURS_DAYS: 'x', PHONE_CALL_HOURS_OPEN: 'nope', PHONE_CALL_HOURS_TZ: 'Mars/Base' } as any),
      { days: [1, 2, 3, 4, 5], openMin: 420, closeMin: 1020, tz: 'America/Los_Angeles', enabled: true });
    assert.equal(directToAi(d('2026-10-17T18:00:00Z'), AI_RECEPTIONIST, { PHONE_CALL_AFTER_HOURS_AI: '0' } as any), false);
  });
  it('directToAi only after hours and only when the AI fallback is on', () => {
    assert.equal(directToAi(d('2026-10-17T18:00:00Z'), AI_RECEPTIONIST, env), true);
    assert.equal(directToAi(d('2026-10-14T19:00:00Z'), AI_RECEPTIONIST, env), false);
    assert.equal(directToAi(d('2026-10-17T18:00:00Z'), null, env), false);
  });
});

describe('after-hours TwiML', () => {
  const x = buildAfterHoursAiTwiml({ aiNumber: AI_RECEPTIONIST, baseUrl: 'https://scws-jobs.vercel.app/', notice: 'This call may be recorded.', actionQuery: '?afterhours=1' });
  it('notice, then dials only Mike, recorded, with status action and no ai=1 (no second handoff)', () => {
    assert.match(x, /<Say[^>]*>This call may be recorded\.<\/Say><Dial /);
    assert.match(x, /<Number>\+17604915348<\/Number><\/Dial>/);
    assert.doesNotMatch(x, /17602763468/);
    assert.match(x, /record="record-from-answer-dual"/);
    assert.match(x, /recordingStatusCallback="https:\/\/scws-jobs\.vercel\.app\/api\/calls\/inbound\/recording"/);
    assert.match(x, /action="https:\/\/scws-jobs\.vercel\.app\/api\/calls\/inbound\/status\?afterhours=1"/);
    assert.doesNotMatch(x, /ai=1/);
  });
});
