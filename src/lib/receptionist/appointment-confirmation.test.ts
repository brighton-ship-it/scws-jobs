import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECK_SCHEDULE_TOOL,
  CHECK_SCHEDULE_TOOL_NAME,
  SARAH_APPOINTMENT_CONFIRMATION_LOCK,
  decideAppointmentConfirmation,
  parseClockToMinutes,
  speechConfirmsAppointment,
} from './appointment-confirmation.ts';
import {
  NO_VISIT_CONFIRMATION_RULE,
  type ScheduleLookupResult,
  type ScheduleVisit,
} from './check-schedule.ts';

/** Monday Aug 31 2026 3:00 PM PT (incident day). */
const INCIDENT_NOW = new Date('2026-08-31T22:00:00.000Z');

function emptySchedule(overrides: Partial<ScheduleLookupResult> = {}): ScheduleLookupResult {
  return {
    lookupStatus: 'ok',
    found: true,
    hasAppointments: false,
    canConfirm: false,
    customerName: 'Edward Guys',
    visits: [],
    totalUpcoming: 0,
    message:
      "I found your account, Edward Guys, but I don't see any upcoming appointments. I'll have the office call you back.",
    confirmationRule: NO_VISIT_CONFIRMATION_RULE,
    ...overrides,
  };
}

function travisVisit(overrides: Partial<ScheduleVisit> = {}): ScheduleVisit {
  return {
    startAt: '2026-08-31T18:00:00.000Z', // 11:00 AM PT
    endAt: '2026-08-31T19:00:00.000Z',
    allDay: false,
    service: 'Service Call',
    address: '123 Well Rd, Ramona',
    technicians: ['Travis C Sego'],
    date: 'Monday, August 31',
    time: 'between 11:00 AM and 12:00 PM',
    ...overrides,
  };
}

function foundVisitResult(visits: ScheduleVisit[]): ScheduleLookupResult {
  const next = visits[0];
  return {
    lookupStatus: 'ok',
    found: true,
    hasAppointments: true,
    canConfirm: true,
    customerName: 'Edward Guys',
    visits,
    nextAppointment: {
      date: next.date,
      time: next.time,
      service: next.service,
      address: next.address,
      technicians: next.technicians,
    },
    totalUpcoming: visits.length,
    message: `Yes! I see you're scheduled for ${next.service} on ${next.date}, ${next.time}.`,
    confirmationRule:
      'You may confirm only the date, time, and technician names in visits / nextAppointment.',
  };
}

describe('Sarah appointment confirmation lock', () => {
  it('requires checkSchedule before any confirmation language', () => {
    assert.equal(CHECK_SCHEDULE_TOOL_NAME, 'checkSchedule');
    assert.match(SARAH_APPOINTMENT_CONFIRMATION_LOCK, /MUST call checkSchedule/i);
    assert.match(SARAH_APPOINTMENT_CONFIRMATION_LOCK, /wait for the tool result/i);
    assert.match(CHECK_SCHEDULE_TOOL.description, /REQUIRED before confirming/i);
    assert.match(CHECK_SCHEDULE_TOOL.description, /Wait for the result/i);
  });

  it('forbids inventing a visit when the lookup is empty', () => {
    assert.match(SARAH_APPOINTMENT_CONFIRMATION_LOCK, /never invent/i);
    assert.match(SARAH_APPOINTMENT_CONFIRMATION_LOCK, /hasAppointments: false/i);
    assert.match(
      SARAH_APPOINTMENT_CONFIRMATION_LOCK,
      /Matching an existing customer by phone is NOT proof of a visit/i
    );
  });

  it('forbids confirming when Jobber is down', () => {
    assert.match(SARAH_APPOINTMENT_CONFIRMATION_LOCK, /lookupStatus: error/i);
    assert.match(SARAH_APPOINTMENT_CONFIRMATION_LOCK, /No fake "I see it\."/i);
  });
});

describe('decideAppointmentConfirmation — Guy Edwards incident', () => {
  const insisted = {
    dateText: 'today',
    timeText: '11 AM',
    technician: 'Travis',
  };

  it('refuses empty schedule even when the caller insists today 11 with Travis', () => {
    const decision = decideAppointmentConfirmation(emptySchedule(), insisted, INCIDENT_NOW);
    assert.equal(decision.mayConfirm, false);
    assert.match(decision.reason, /do not confirm|do not see/i);
    assert.equal(decision.allowedFacts, undefined);
  });

  it('refuses when the customer was matched but has zero visits', () => {
    const decision = decideAppointmentConfirmation(
      emptySchedule({ found: true, customerName: 'Edward Guys' }),
      insisted,
      INCIDENT_NOW
    );
    assert.equal(decision.mayConfirm, false);
  });

  it('refuses a tool error — no fake I see it', () => {
    const errored: ScheduleLookupResult = {
      lookupStatus: 'error',
      found: false,
      hasAppointments: false,
      canConfirm: false,
      visits: [],
      message:
        "I'm not able to pull up the schedule right now. I'll have the office verify and call you back.",
      confirmationRule: 'Do not confirm any appointment.',
      error: 'Jobber GraphQL HTTP 503',
    };
    const decision = decideAppointmentConfirmation(errored, insisted, INCIDENT_NOW);
    assert.equal(decision.mayConfirm, false);
    assert.match(decision.reason, /office verify|Do not confirm/i);
    assert.equal(speechConfirmsAppointment(errored.message), false);
  });

  it('allows confirming only the visit facts in the payload', () => {
    const result = foundVisitResult([travisVisit()]);
    const decision = decideAppointmentConfirmation(result, insisted, INCIDENT_NOW);
    assert.equal(decision.mayConfirm, true);
    assert.deepEqual(decision.allowedFacts?.technicians, ['Travis C Sego']);
    assert.match(decision.allowedFacts?.time || '', /11:00 AM/);
  });

  it('refuses when the caller names a time that is not in the result', () => {
    const result = foundVisitResult([
      travisVisit({
        startAt: '2026-08-31T21:00:00.000Z', // 2:00 PM PT
        time: 'starting at 2:00 PM',
        technicians: ['Travis C Sego'],
      }),
    ]);
    const decision = decideAppointmentConfirmation(
      result,
      { dateText: 'today', timeText: '11 AM', technician: 'Travis' },
      INCIDENT_NOW
    );
    assert.equal(decision.mayConfirm, false);
  });

  it('refuses when the caller names a technician who is not on the visit', () => {
    const result = foundVisitResult([
      travisVisit({ technicians: ['Lizbeth Garcia'] }),
    ]);
    const decision = decideAppointmentConfirmation(
      result,
      { dateText: 'today', timeText: '11 AM', technician: 'Travis' },
      INCIDENT_NOW
    );
    assert.equal(decision.mayConfirm, false);
  });

  it('treats a missing lookup as do-not-confirm', () => {
    const decision = decideAppointmentConfirmation(null, insisted, INCIDENT_NOW);
    assert.equal(decision.mayConfirm, false);
  });
});

describe('parseClockToMinutes', () => {
  it('reads 11 AM, 11 o\'clock, and 11:00', () => {
    assert.equal(parseClockToMinutes('11 AM'), 11 * 60);
    assert.equal(parseClockToMinutes("11 o'clock"), 11 * 60);
    assert.equal(parseClockToMinutes('11:00'), 11 * 60);
  });
});
