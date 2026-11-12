/**
 * book_job refuses when the day Mike told the caller is not the slot's day.
 *
 * Clay Spiegel (Nov 9 2026): Tuesday had no openings. checkSchedule returned
 * Wednesday, November 11, 8–10 and 10–12. The caller said "tomorrow," Mike
 * called those windows Tuesday, then booked the Wednesday 10–12 startAt.
 *
 * A slot is accepted when any parsed offer of that start hour, in Mike's latest
 * turn that names a time, is on the slot's day. Two same-hour days ("Wed 8–10
 * or Thu 8–10") are not a mismatch. A time is tied to a day that follows it
 * in the same sentence ("10–12 on Wednesday"). An unparsed time does not fall
 * back to the last weekday. After two mismatches the call goes to createCallback.
 */

import type { ConsentTurn } from './booking-consent.ts';
import { formatPtDate, formatVisitTime, ptCalendarDate } from './check-schedule.ts';
import { SLOT_DURATION_MINUTES } from './open-slots.ts';
import { slotSayLabel } from './slot-say.ts';

const HOUR_WORD: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const WEEKDAY_WORD: Record<string, string> = {
  sun: 'sunday', sunday: 'sunday',
  mon: 'monday', monday: 'monday',
  tue: 'tuesday', tues: 'tuesday', tuesday: 'tuesday',
  wed: 'wednesday', wednesday: 'wednesday',
  thu: 'thursday', thur: 'thursday', thurs: 'thursday', thursday: 'thursday',
  fri: 'friday', friday: 'friday',
  sat: 'saturday', saturday: 'saturday',
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const HOUR = '(?:1[0-2]|0?[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const MERIDIEM = '(?:am|pm)';
const WEEKDAY_RE = '(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues|thurs|thur|wed|tue|thu|mon|fri|sat|sun)';

/** Two spoken mismatches, then createCallback. Same limit as the address gate. */
export const DAY_MISMATCH_RETRY_LIMIT = 2;

export type OfferedDayDecision =
  | { ok: true }
  | { ok: false; result: Record<string, unknown> };

type DayState = { weekday?: string; ymd?: string; spoken: string; relativeOnly: boolean };

type DayMark = { index: number; end: number; kind: 'rel' | 'weekday' | 'date'; spoken: string; ymd?: string; weekday?: string };
type WindowMark = { index: number; end: number; kind: 'window'; hour: number };
type Mark = DayMark | WindowMark;

export type SlotDay = { weekday: string; ymd: string; say: string; hour24: number };

type Offer = { hour: number; state: DayState };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymdFromDate(date: Date): string {
  return ptCalendarDate(date);
}

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  return ptCalendarDate(new Date(Date.UTC(year, month - 1, day + days, 20, 0, 0)));
}

function weekdayOfYmd(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
  }).format(new Date(Date.UTC(year, month - 1, day, 20, 0, 0))).toLowerCase();
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function resolveYmd(month: number, day: number, anchor: string): string {
  const year = Number(anchor.slice(0, 4));
  let ymd = iso(year, month, day);
  if (ymd < addDays(anchor, -2)) ymd = iso(year + 1, month, day);
  return ymd;
}

function hourValue(raw: string, meridiem?: string): number | null {
  const word = HOUR_WORD[raw.toLowerCase()];
  const hour12 = word ?? Number(raw);
  if (!Number.isFinite(hour12) || hour12 < 1 || hour12 > 12) return null;
  const mer = (meridiem || '').toLowerCase();
  if (mer === 'pm') return hour12 === 12 ? 12 : hour12 + 12;
  if (mer === 'am') return hour12 === 12 ? 0 : hour12;
  if (hour12 >= 1 && hour12 <= 6) return hour12 + 12;
  return hour12;
}

export function slotDay(startAt: unknown): SlotDay | null {
  const date = new Date(String(startAt || ''));
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const weekday = get('weekday').toLowerCase();
  const hour24 = Number(get('hour'));
  const ymd = `${get('year')}-${get('month')}-${get('day')}`;
  if (!weekday || !/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !Number.isFinite(hour24)) return null;
  const end = new Date(date.getTime() + SLOT_DURATION_MINUTES * 60_000);
  return {
    weekday,
    ymd,
    hour24,
    say: slotSayLabel(formatPtDate(date), formatVisitTime(date.toISOString(), end.toISOString(), false)),
  };
}

function pushWindow(marks: WindowMark[], index: number, end: number, hour: number | null) {
  if (hour == null) return;
  if (marks.some((mark) => index < mark.end && end > mark.index)) return;
  marks.push({ index, end, kind: 'window', hour });
}

function collectMarks(sentence: string, anchor: string | null): Mark[] {
  const days: DayMark[] = [];
  const windows: WindowMark[] = [];
  let match: RegExpExecArray | null;

  if (anchor) {
    const rel = /\b(today|tomorrow)\b/gi;
    while ((match = rel.exec(sentence))) {
      const spoken = match[1].toLowerCase();
      const ymd = spoken === 'tomorrow' ? addDays(anchor, 1) : anchor;
      days.push({
        index: match.index,
        end: match.index + match[0].length,
        kind: 'rel',
        spoken,
        ymd,
        weekday: weekdayOfYmd(ymd),
      });
    }
  } else {
    const rel = /\b(today|tomorrow)\b/gi;
    while ((match = rel.exec(sentence))) {
      days.push({
        index: match.index,
        end: match.index + match[0].length,
        kind: 'rel',
        spoken: match[1].toLowerCase(),
      });
    }
  }

  const weekdayRe = new RegExp(`\\b(${WEEKDAY_RE})\\b`, 'gi');
  while ((match = weekdayRe.exec(sentence))) {
    const weekday = WEEKDAY_WORD[match[1].toLowerCase()];
    if (!weekday) continue;
    days.push({
      index: match.index,
      end: match.index + match[0].length,
      kind: 'weekday',
      spoken: weekday,
      weekday,
    });
  }

  const monthRe = /\b(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi;
  while ((match = monthRe.exec(sentence))) {
    const month = MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    if (!month || day < 1 || day > 31 || !anchor) continue;
    const ymd = resolveYmd(month, day, anchor);
    days.push({
      index: match.index,
      end: match.index + match[0].length,
      kind: 'date',
      spoken: match[0],
      ymd,
      weekday: weekdayOfYmd(ymd),
    });
  }

  const slashRe = /\b(0?[1-9]|1[0-2])\/([0-2]?\d|3[01])\b/g;
  while ((match = slashRe.exec(sentence))) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (!month || day < 1 || day > 31 || !anchor) continue;
    if (/\s*(?:am|pm)\b/i.test(sentence.slice(match.index + match[0].length, match.index + match[0].length + 4))) continue;
    const ymd = resolveYmd(month, day, anchor);
    days.push({
      index: match.index,
      end: match.index + match[0].length,
      kind: 'date',
      spoken: match[0],
      ymd,
      weekday: weekdayOfYmd(ymd),
    });
  }

  const rangeRe = new RegExp(
    `\\b(?:between\\s+|from\\s+)?(${HOUR})(?:\\s*:\\s*00)?(?:\\s*(${MERIDIEM}))?\\s+(?:and|to)\\s+(noon|${HOUR})(?:\\s*:\\s*00)?(?:\\s*(${MERIDIEM}))?`,
    'gi',
  );
  while ((match = rangeRe.exec(sentence))) {
    pushWindow(windows, match.index, match.index + match[0].length, hourValue(match[1], match[2]));
  }

  const dashRe = new RegExp(
    `\\b(${HOUR})(?:\\s*:\\s*00)?(?:\\s*(${MERIDIEM}))?\\s*[-–—]\\s*(${HOUR}|noon)(?:\\s*:\\s*00)?(?:\\s*(${MERIDIEM}))?`,
    'gi',
  );
  while ((match = dashRe.exec(sentence))) {
    pushWindow(windows, match.index, match.index + match[0].length, hourValue(match[1], match[2]));
  }

  const atRe = new RegExp(`\\bat\\s+(${HOUR})(?:\\s*:\\s*00)?(?:\\s*(${MERIDIEM}))?\\b`, 'gi');
  while ((match = atRe.exec(sentence))) {
    pushWindow(windows, match.index, match.index + match[0].length, hourValue(match[1], match[2]));
  }

  return [...days, ...windows].sort((a, b) => a.index - b.index || a.end - b.end);
}

function applyMark(state: DayState | null, mark: DayMark): DayState {
  if (mark.kind === 'rel') {
    if (!mark.ymd) return { spoken: mark.spoken, relativeOnly: true };
    return { weekday: mark.weekday, ymd: mark.ymd, spoken: mark.spoken, relativeOnly: true };
  }
  if (mark.kind === 'weekday') {
    const keepYmd = state?.ymd && weekdayOfYmd(state.ymd) === mark.weekday ? state.ymd : undefined;
    return { weekday: mark.weekday, ymd: keepYmd, spoken: mark.spoken, relativeOnly: false };
  }
  const conflict = Boolean(state?.weekday && state.weekday !== mark.weekday);
  return {
    ymd: mark.ymd,
    weekday: conflict ? state?.weekday : mark.weekday,
    spoken: conflict ? `${state?.spoken}, ${mark.spoken}` : mark.spoken,
    relativeOnly: false,
  };
}

function hasDay(state: DayState | null): state is DayState {
  return Boolean(state && (state.relativeOnly || state.weekday || state.ymd));
}

/**
 * A day that follows the window in this sentence ("10–12 on Wednesday"),
 * stopping before "or" so the next offer keeps its own day.
 */
function dayAfterWindow(sentence: string, window: WindowMark, marks: Mark[]): DayState | null {
  const nextWindow = marks.find((mark) => mark.kind === 'window' && mark.index >= window.end);
  const limit = nextWindow ? nextWindow.index : sentence.length;
  const between = sentence.slice(window.end, limit);
  const orAt = between.search(/\bor\b/i);
  const end = orAt >= 0 ? window.end + orAt : limit;
  const leadEnd = marks.find((mark) => mark.kind !== 'window' && mark.index >= window.end && mark.index < end);
  if (!leadEnd) return null;
  const lead = sentence.slice(window.end, leadEnd.index);
  if (!/^\s*(?:,\s*)?(?:on|for)\b/i.test(lead) && !/^\s*,?\s*$/.test(lead)) return null;
  let state: DayState | null = null;
  for (const mark of marks) {
    if (mark.kind === 'window' || mark.index < window.end || mark.index >= end) continue;
    state = applyMark(state, mark);
  }
  return hasDay(state) ? state : null;
}

function offersInText(text: string, anchor: string | null): Offer[] {
  const normalized = text.replace(/\ba\.?\s*m\.?\b/gi, 'am').replace(/\bp\.?\s*m\.?\b/gi, 'pm');
  const sentences = normalized.split(/\n+|(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  const offers: Offer[] = [];
  let carry: DayState | null = null;
  for (const sentence of sentences) {
    const marks = collectMarks(sentence, anchor);
    let state = carry;
    for (const mark of marks) {
      if (mark.kind !== 'window') {
        state = applyMark(state, mark);
        continue;
      }
      const followed = dayAfterWindow(sentence, mark, marks);
      const used = followed ?? (hasDay(state) ? state : null);
      if (used) offers.push({ hour: mark.hour, state: { ...used } });
      if (followed) state = followed;
    }
    carry = state;
  }
  return offers;
}

function dayMatches(state: DayState, slot: SlotDay, nowKnown: boolean): boolean {
  if (state.relativeOnly && !nowKnown) return true;
  if (state.ymd && state.ymd !== slot.ymd) return false;
  if (state.weekday && state.weekday !== slot.weekday) return false;
  return Boolean(state.relativeOnly || state.ymd || state.weekday);
}

function refuse(spoken: string, slot: SlotDay): OfferedDayDecision {
  return {
    ok: false,
    result: {
      booked: false,
      canConfirm: false,
      mayBook: false,
      dayMismatch: true,
      say: slot.say,
      message:
        `NOT BOOKED. You told the caller ${spoken}, but this slot is ${slot.say}. ` +
        `Say that label verbatim and ask if they want it. Do not say ${spoken}, today, tomorrow, or any other day. ` +
        `Call book_job again only after they agree to ${slot.say}. Do not say they are booked.`,
    },
  };
}

function giveUp(slot: SlotDay): OfferedDayDecision {
  return {
    ok: false,
    result: {
      booked: false,
      canConfirm: false,
      mayBook: false,
      dayMismatch: true,
      fallback: 'createCallback',
      say: slot.say,
      message:
        `NOT BOOKED. The day still does not match after ${DAY_MISMATCH_RETRY_LIMIT} tries. ` +
        `Call createCallback once with their name, number, and the day they asked for (${slot.say} was the open slot). ` +
        'Do not call book_job again.',
    },
  };
}

/** How many day-mismatch tool results are already on this call. */
export function countDayRefusals(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  let count = 0;
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const record = message as { result?: unknown; content?: unknown };
    const raw = record.result ?? record.content;
    const text = typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : '';
    if (/"dayMismatch"\s*:\s*true/.test(text)) count += 1;
  }
  return count;
}

export function dayRefusalsFromBody(body: any): number {
  const message = body?.message || body || {};
  const raw =
    message.artifact?.messages ||
    body?.artifact?.messages ||
    message.messages ||
    message.call?.messages ||
    body?.call?.messages ||
    [];
  return countDayRefusals(raw);
}

/**
 * Compare the day Mike spoke for this slot's window with the slot itself.
 * now null means the call start time was missing: today/tomorrow are not refused.
 * priorRefusals is how many day-mismatch results this call already returned.
 */
export function checkOfferedDay(
  params: Record<string, unknown>,
  turns: ConsentTurn[] = [],
  now?: Date | null,
  priorRefusals = 0,
): OfferedDayDecision {
  const slot = slotDay(params.startAt ?? params.slotId);
  if (!slot) return { ok: true };
  const knownNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : null;
  const anchor = knownNow ? ymdFromDate(knownNow) : slot.ymd;
  const botTurns = turns.filter((turn) => turn.role === 'bot' && turn.text.trim());
  let offers: Offer[] = [];
  for (let i = botTurns.length - 1; i >= 0; i--) {
    offers = offersInText(botTurns[i].text, anchor);
    if (offers.length) break;
  }
  const matched = offers.filter((offer) => offer.hour === slot.hour24);
  if (!matched.length) return { ok: true };
  if (matched.some((offer) => dayMatches(offer.state, slot, Boolean(knownNow)))) return { ok: true };
  if (priorRefusals >= DAY_MISMATCH_RETRY_LIMIT) return giveUp(slot);
  const spoken = matched[matched.length - 1].state.spoken || 'a different day';
  return refuse(spoken, slot);
}
