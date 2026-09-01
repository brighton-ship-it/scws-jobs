import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  callerWantsSomeoneNow,
  decideSarahBooking,
  isSarahBookingHours,
  isWeekendEmergencyWindow,
} from './after-hours.ts';

/** Thursday Sep 3 2026 4:00 PM PT — daytime weekday. */
const THU_4PM = new Date('2026-09-03T23:00:00.000Z');
/** Thursday Sep 3 2026 5:30 PM PT — Sarah weeknight. */
const THU_530PM = new Date('2026-09-04T00:30:00.000Z');
/** Friday Sep 4 2026 4:00 PM PT — Liz still has daytime Friday. */
const FRI_4PM = new Date('2026-09-04T23:00:00.000Z');
/** Friday Sep 4 2026 6:00 PM PT — weekend window starts. */
const FRI_6PM = new Date('2026-09-05T01:00:00.000Z');
/** Saturday Sep 5 2026 10:00 AM PT. */
const SAT_10AM = new Date('2026-09-05T17:00:00.000Z');
/** Monday Sep 7 2026 6:30 AM PT — still after-hours. */
const MON_630AM = new Date('2026-09-07T13:30:00.000Z');
/** Monday Sep 7 2026 8:00 AM PT — Liz daytime. */
const MON_8AM = new Date('2026-09-07T15:00:00.000Z');

describe('isSarahBookingHours', () => {
  it('blocks weekday daytime and Friday before 5pm PT', () => {
    assert.equal(isSarahBookingHours(THU_4PM), false);
    assert.equal(isSarahBookingHours(FRI_4PM), false);
    assert.equal(isSarahBookingHours(MON_8AM), false);
  });

  it('allows Mon–Thu after 5pm and Friday 5pm through Monday 7am PT', () => {
    assert.equal(isSarahBookingHours(THU_530PM), true);
    assert.equal(isSarahBookingHours(FRI_6PM), true);
    assert.equal(isSarahBookingHours(SAT_10AM), true);
    assert.equal(isSarahBookingHours(MON_630AM), true);
  });
});

describe('isWeekendEmergencyWindow', () => {
  it('is Friday 5pm through Monday 7am, not Thursday evening', () => {
    assert.equal(isWeekendEmergencyWindow(THU_530PM), false);
    assert.equal(isWeekendEmergencyWindow(FRI_6PM), true);
    assert.equal(isWeekendEmergencyWindow(SAT_10AM), true);
    assert.equal(isWeekendEmergencyWindow(MON_630AM), true);
    assert.equal(isWeekendEmergencyWindow(MON_8AM), false);
  });
});

describe('callerWantsSomeoneNow', () => {
  it('detects explicit flags, STR guests, and no-water emergencies', () => {
    assert.equal(callerWantsSomeoneNow({ needNow: true }), true);
    assert.equal(callerWantsSomeoneNow({ needNow: 'true' }), true);
    assert.equal(callerWantsSomeoneNow({ urgency: 'emergency' }), true);
    assert.equal(callerWantsSomeoneNow({ notes: 'Airbnb guests this weekend, no water' }), true);
    assert.equal(callerWantsSomeoneNow({ urgency: 'normal', notes: 'schedule a pump check next week' }), false);
  });
});

describe('decideSarahBooking', () => {
  it('daytime weekday path does not book — Liz keeps those calls', () => {
    const decision = decideSarahBooking(THU_4PM, { urgency: 'normal' });
    assert.equal(decision.mayBook, false);
    if (decision.mayBook) throw new Error('expected block');
    assert.equal(decision.reason, 'daytime_weekday');
    assert.match(decision.spoken, /Liz|office/i);
  });

  it('weekend emergency does not auto-book Monday', () => {
    const decision = decideSarahBooking(SAT_10AM, {
      urgency: 'emergency',
      needNow: true,
      notes: 'STR guests, no water now',
    });
    assert.equal(decision.mayBook, false);
    if (decision.mayBook) throw new Error('expected block');
    assert.equal(decision.reason, 'weekend_emergency');
    assert.equal(decision.weekendEmergency, true);
    assert.match(decision.spoken, /not going to put you on Monday/i);
  });

  it('after-hours routine call may book', () => {
    const decision = decideSarahBooking(THU_530PM, { urgency: 'normal' });
    assert.equal(decision.mayBook, true);
  });

  it('Friday night and Saturday routine calls may book (visit still lands on a weekday)', () => {
    assert.equal(decideSarahBooking(FRI_6PM, { urgency: 'normal' }).mayBook, true);
    assert.equal(decideSarahBooking(SAT_10AM, { urgency: 'normal' }).mayBook, true);
  });
});
