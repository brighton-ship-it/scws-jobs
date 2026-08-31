/**
 * Sarah appointment-confirmation lock.
 *
 * Source of truth for: she may confirm a date, time, or technician name only
 * when checkSchedule (live Jobber visit lookup) returned that visit.
 *
 * Live Vapi: this repo has no sanctioned Vapi PATCH path. Paste
 * SARAH_APPOINTMENT_CONFIRMATION_LOCK and CHECK_SCHEDULE_TOOL into the
 * live assistant (system prompt + tools). Do not invent a deploy script.
 */

import {
  LOOKUP_ERROR_CONFIRMATION_RULE,
  NO_VISIT_CONFIRMATION_RULE,
  PACIFIC_TZ,
  VISIT_CONFIRMATION_RULE,
  ptCalendarDate,
  type ScheduleLookupResult,
  type ScheduleVisit,
} from './check-schedule.ts';

export type CallerAppointmentClaim = {
  dateText?: string;
  timeText?: string;
  technician?: string;
};

export type ConfirmationDecision = {
  mayConfirm: boolean;
  reason: string;
  allowedFacts?: {
    date: string;
    time: string;
    service: string | null;
    technicians: string[];
  };
};

export const CHECK_SCHEDULE_TOOL_NAME = 'checkSchedule';

export const CHECK_SCHEDULE_TOOL = {
  name: CHECK_SCHEDULE_TOOL_NAME,
  description:
    'Look up the caller\'s upcoming Jobber visits by phone. REQUIRED before confirming any appointment (date, time, technician, "I see it", "you\'re all set", "everything looks good"). Wait for the result. Confirm only facts in the result. If hasAppointments is false or lookupStatus is error, do not invent or agree to a visit.',
  parameters: {
    type: 'object',
    properties: {
      phone: {
        type: 'string',
        description: 'The caller\'s phone number',
      },
    },
    required: ['phone'],
  },
} as const;

/**
 * Paste this block into Sarah's Vapi system prompt.
 * Confirmation-only. Do not replace $200 after-hours, book_job, quote, or payment-plan language.
 */
export const SARAH_APPOINTMENT_CONFIRMATION_LOCK = `## Appointment confirmation lock (HARD RULE)
Before you say any appointment is booked or confirmed — a date, a time, a technician name, "I see it", "I have confirmed", "you're all set", or "everything looks good" — you MUST call checkSchedule and wait for the tool result.

You may confirm ONLY facts in that result (matching date, time, and technician). If the caller names a time or technician that is not in the result, do not agree. Say you do not see that appointment and you will have the office call back.

If checkSchedule returns no upcoming visits (hasAppointments: false): never invent one. Say you don't see an upcoming appointment. Offer to have the office call back.

If checkSchedule errors or Jobber is down (lookupStatus: error): do not confirm. Say you'll have the office verify. No fake "I see it."

Matching an existing customer by phone is NOT proof of a visit.

Do not read stage directions out loud. Do not say "pause for a moment" or "if checking the schedule."

Keep it short. Do not explain tools to the caller.`;

const CONFIRMATION_SPEECH =
  /\b(i see (your|an|the) appointment|i have confirmed|you're all set|everything looks good|i've confirmed|confirmed your appointment)\b/i;

export function speechConfirmsAppointment(text: string): boolean {
  return CONFIRMATION_SPEECH.test(text);
}

function addPtDays(now: Date, days: number): Date {
  const dateStr = ptCalendarDate(now);
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
}

export function resolveClaimDatePt(dateText: string | undefined, now: Date): string | null {
  if (!dateText) return null;
  const raw = dateText.trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'today') return ptCalendarDate(now);
  if (raw === 'tomorrow') return ptCalendarDate(addPtDays(now, 1));

  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];

  const parsed = Date.parse(dateText);
  if (Number.isFinite(parsed)) return ptCalendarDate(new Date(parsed));
  return null;
}

export function parseClockToMinutes(text: string | undefined): number | null {
  if (!text) return null;
  const cleaned = text
    .toLowerCase()
    .replace(/o['’]?clock/g, '')
    .replace(/\./g, '');
  const match = cleaned.match(/(\d{1,2})(?::(\d{2}))?\s*(a\s*m|p\s*m|am|pm)?/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (!Number.isFinite(hour) || hour > 23 || minute > 59) return null;

  const meridiem = match[3]?.replace(/\s+/g, '');
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

export function visitMinutesPt(startAt: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(startAt));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || '0');
  return hour * 60 + minute;
}

function technicianMatches(claim: string, technicians: string[]): boolean {
  const needle = claim.trim().toLowerCase();
  if (!needle) return true;
  return technicians.some((name) => {
    const hay = name.toLowerCase();
    return hay.includes(needle) || needle.includes(hay);
  });
}

export function visitMatchesClaim(
  visit: ScheduleVisit,
  claim: CallerAppointmentClaim,
  now: Date
): boolean {
  if (claim.dateText) {
    const claimedDate = resolveClaimDatePt(claim.dateText, now);
    if (claimedDate && ptCalendarDate(new Date(visit.startAt)) !== claimedDate) {
      return false;
    }
  }

  if (claim.timeText && !visit.allDay) {
    const claimedMinutes = parseClockToMinutes(claim.timeText);
    if (claimedMinutes != null) {
      const visitMins = visitMinutesPt(visit.startAt);
      const sameHour = Math.floor(claimedMinutes / 60) === Math.floor(visitMins / 60);
      const closeEnough = Math.abs(claimedMinutes - visitMins) <= 30;
      if (!sameHour && !closeEnough) return false;
    }
  }

  if (claim.technician && !technicianMatches(claim.technician, visit.technicians)) {
    return false;
  }

  return true;
}

function allowedFactsFrom(visit: ScheduleVisit): NonNullable<ConfirmationDecision['allowedFacts']> {
  return {
    date: visit.date,
    time: visit.time,
    service: visit.service,
    technicians: visit.technicians,
  };
}

/**
 * Hard lock: Sarah may confirm only a visit that is actually in the
 * checkSchedule payload. Caller insistence is never enough.
 */
export function decideAppointmentConfirmation(
  result: ScheduleLookupResult | null | undefined,
  claim: CallerAppointmentClaim = {},
  now: Date = new Date()
): ConfirmationDecision {
  if (!result) {
    return { mayConfirm: false, reason: 'No checkSchedule result. Do not confirm.' };
  }

  if (result.lookupStatus === 'error' || result.canConfirm === false) {
    return {
      mayConfirm: false,
      reason:
        result.lookupStatus === 'error'
          ? LOOKUP_ERROR_CONFIRMATION_RULE
          : result.confirmationRule || NO_VISIT_CONFIRMATION_RULE,
    };
  }

  if (result.lookupStatus !== 'ok' || !result.hasAppointments || result.visits.length === 0) {
    return { mayConfirm: false, reason: NO_VISIT_CONFIRMATION_RULE };
  }

  const hasClaim = Boolean(claim.dateText || claim.timeText || claim.technician);
  if (!hasClaim) {
    const next = result.visits[0];
    return {
      mayConfirm: true,
      reason: VISIT_CONFIRMATION_RULE,
      allowedFacts: allowedFactsFrom(next),
    };
  }

  const match = result.visits.find((visit) => visitMatchesClaim(visit, claim, now));
  if (!match) {
    return {
      mayConfirm: false,
      reason:
        'The caller named a date, time, or technician that is not in the checkSchedule result. Do not agree. Say you do not see that appointment and offer a callback.',
    };
  }

  return {
    mayConfirm: true,
    reason: VISIT_CONFIRMATION_RULE,
    allowedFacts: allowedFactsFrom(match),
  };
}

export function assertNoHallucinatedConfirmation(
  result: ScheduleLookupResult,
  spoken: string
): boolean {
  if (result.canConfirm && result.hasAppointments) return true;
  return !speechConfirmsAppointment(spoken);
}
