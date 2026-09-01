/**
 * When Sarah may book a $200 service call, and when she must not.
 *
 * Booking hours (call time, America/Los_Angeles):
 *   weeknights Mon–Thu after 5:00pm PT
 *   Friday 5:00pm PT through Monday 7:00am PT
 *
 * Visit days (Jobber startAt, America/Los_Angeles):
 *   Monday–Friday only. Never Saturday or Sunday.
 *   Friday-night / weekend after-hours callers may land on the next weekday.
 *
 * Daytime weekday service calls stay with Liz — Sarah takes a message.
 * A caller who needs someone NOW this weekend is not a Monday $200 visit.
 */

import { PACIFIC_TZ } from './check-schedule.ts';

export const SARAH_BOOKING_CUTOFF_HOUR_PT = 17;
export const WEEKEND_WINDOW_ENDS_MONDAY_HOUR_PT = 7;

export type BookingBlockReason = 'daytime_weekday' | 'weekend_emergency';

export type SarahBookingDecision =
  | { mayBook: true; weekendEmergency: false }
  | {
      mayBook: false;
      reason: BookingBlockReason;
      weekendEmergency: boolean;
      spoken: string;
      confirmationRule: string;
    };

export type WeekendNeedInput = {
  urgency?: string | null;
  needNow?: boolean | string | null;
  thisWeekend?: boolean | string | null;
  notes?: string | null;
  reason?: string | null;
};

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function asBool(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return /^(true|yes|1)$/i.test(value.trim());
  return false;
}

export function ptClock(date: Date, timeZone = PACIFIC_TZ): {
  weekday: number;
  hour: number;
  minute: number;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);

  const weekdayLabel = parts.find((part) => part.type === 'weekday')?.value || 'Sun';
  const weekday = WEEKDAY_SHORT.indexOf(weekdayLabel as (typeof WEEKDAY_SHORT)[number]);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || '0');

  return {
    weekday: weekday < 0 ? 0 : weekday,
    hour,
    minute,
    minutes: hour * 60 + minute,
  };
}

/** Sarah may create a Jobber visit only during this window. */
export function isSarahBookingHours(now: Date): boolean {
  const { weekday, minutes } = ptClock(now);
  const afterFive = minutes >= SARAH_BOOKING_CUTOFF_HOUR_PT * 60;
  const beforeMondaySeven = minutes < WEEKEND_WINDOW_ENDS_MONDAY_HOUR_PT * 60;

  if (weekday === 0 || weekday === 6) return true;
  if (weekday === 5) return afterFive;
  if (weekday === 1) return beforeMondaySeven || afterFive;
  if (weekday >= 2 && weekday <= 4) return afterFive;
  return false;
}

/** Friday 5pm PT through Monday 7am PT — the "need someone this weekend" window. */
export function isWeekendEmergencyWindow(now: Date): boolean {
  const { weekday, minutes } = ptClock(now);
  const afterFive = minutes >= SARAH_BOOKING_CUTOFF_HOUR_PT * 60;
  const beforeMondaySeven = minutes < WEEKEND_WINDOW_ENDS_MONDAY_HOUR_PT * 60;

  if (weekday === 5) return afterFive;
  if (weekday === 6 || weekday === 0) return true;
  if (weekday === 1) return beforeMondaySeven;
  return false;
}

const NOW_THIS_WEEKEND =
  /\b(right now|need(s)? someone now|need(s)? (a )?(tech|technician) now|tonight|this weekend|over the weekend|airbnb|vrbo|\bstr\b|short[- ]term|guests? (are|in|checking)|check[- ]in)\b/i;

const IMMEDIATE_NEED =
  /\b(emergency|no water|no pressure|flooding|sewage|right now|asap|tonight|today)\b/i;

export function callerWantsSomeoneNow(input: WeekendNeedInput = {}): boolean {
  if (asBool(input.needNow) || asBool(input.thisWeekend)) return true;

  const urgency = String(input.urgency || '').toLowerCase().trim();
  if (urgency === 'emergency' || urgency === 'urgent' || urgency === 'now') return true;

  const text = `${input.notes || ''} ${input.reason || ''}`;
  return NOW_THIS_WEEKEND.test(text) || IMMEDIATE_NEED.test(text);
}

export const DAYTIME_WEEKDAY_SPOKEN =
  "Our office is open right now, so I'll take your information and have Liz call you back to schedule. I don't book daytime weekday service calls.";

export const WEEKEND_EMERGENCY_SPOKEN =
  "If you need someone this weekend, I'm not going to put you on Monday's calendar. I'll flag this for the shop and have them call you back.";

export const DAYTIME_WEEKDAY_RULE =
  'Do not book. Take a message. Say the office will call back. Daytime weekday service calls stay with Liz.';

export const WEEKEND_EMERGENCY_RULE =
  'Do not book a Monday $200 visit. Do not tell the caller they are scheduled. Flag the shop. Say the office will call back.';

export function decideSarahBooking(
  now: Date,
  need: WeekendNeedInput = {}
): SarahBookingDecision {
  if (isWeekendEmergencyWindow(now) && callerWantsSomeoneNow(need)) {
    return {
      mayBook: false,
      reason: 'weekend_emergency',
      weekendEmergency: true,
      spoken: WEEKEND_EMERGENCY_SPOKEN,
      confirmationRule: WEEKEND_EMERGENCY_RULE,
    };
  }

  if (!isSarahBookingHours(now)) {
    return {
      mayBook: false,
      reason: 'daytime_weekday',
      weekendEmergency: false,
      spoken: DAYTIME_WEEKDAY_SPOKEN,
      confirmationRule: DAYTIME_WEEKDAY_RULE,
    };
  }

  return { mayBook: true, weekendEmergency: false };
}
