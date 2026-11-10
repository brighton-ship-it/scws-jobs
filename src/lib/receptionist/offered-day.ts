/**
 * book_job refuses when the day Mike told the caller is not the slot's day.
 *
 * Clay Spiegel (Nov 9 2026): Tuesday had no openings. checkSchedule returned
 * Wednesday, November 11, 8–10 and 10–12. The caller said "tomorrow," Mike
 * called those windows Tuesday, then booked the Wednesday 10–12 startAt.
 * The slot date was already "Wednesday, November 11"; nothing compared that
 * to the weekday Mike had just spoken.
 */

import type { ConsentTurn } from './booking-consent.ts';
import { formatPtDate, formatVisitTime, ptCalendarDate } from './check-schedule.ts';
import { SLOT_DURATION_MINUTES } from './open-slots.ts';
import { slotSayLabel } from './slot-say.ts';

const HOUR_WORD: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const HOUR = '(?:1[0-2]|0?[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const MERIDIEM = '(?:a\\.?m\\.?|p\\.?m\\.?|am|pm)';

function windowRe(): RegExp {
  return new RegExp(
    `\\b(?:between\\s+)?(${HOUR})(?:\\s*:\\s*00)?(?:\\s*(${MERIDIEM}))?\\s+(?:and|to)\\s+(${HOUR})(?:\\s*:\\s*00)?(?:\\s*(${MERIDIEM}))?`,
    'gi',
  );
}

export type OfferedDayDecision =
  | { ok: true }
  | { ok: false; result: Record<string, unknown> };

type DayState = { weekday?: string; ymd?: string; spoken: string };

type Mark =
  | { index: number; kind: 'rel'; spoken: string; ymd: string; weekday: string }
  | { index: number; kind: 'weekday'; spoken: string; weekday: string }
  | { index: number; kind: 'date'; spoken: string; ymd: string; weekday: string }
  | { index: number; kind: 'window'; hour: number };

export type SlotDay = { weekday: string; ymd: string; say: string; hour24: number };

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

function resolveYmd(month: number, day: number, today: string): string {
  const year = Number(today.slice(0, 4));
  let ymd = iso(year, month, day);
  if (ymd < addDays(today, -2)) ymd = iso(year + 1, month, day);
  return ymd;
}

function hourValue(raw: string, meridiem?: string): number | null {
  const word = HOUR_WORD[raw.toLowerCase()];
  const hour12 = word ?? Number(raw);
  if (!Number.isFinite(hour12) || hour12 < 1 || hour12 > 12) return null;
  const mer = (meridiem || '').toLowerCase().replace(/\./g, '');
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

function collectMarks(text: string, now: Date): Mark[] {
  const marks: Mark[] = [];
  const today = ymdFromDate(now);
  let match: RegExpExecArray | null;

  const rel = /\b(today|tomorrow)\b/gi;
  while ((match = rel.exec(text))) {
    const spoken = match[1].toLowerCase();
    const ymd = spoken === 'tomorrow' ? addDays(today, 1) : today;
    marks.push({ index: match.index, kind: 'rel', spoken, ymd, weekday: weekdayOfYmd(ymd) });
  }

  const weekdayRe = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi;
  while ((match = weekdayRe.exec(text))) {
    const spoken = match[1].toLowerCase();
    marks.push({ index: match.index, kind: 'weekday', spoken, weekday: spoken });
  }

  const monthRe = /\b(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi;
  while ((match = monthRe.exec(text))) {
    const month = MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    if (!month || day < 1 || day > 31) continue;
    const ymd = resolveYmd(month, day, today);
    marks.push({
      index: match.index,
      kind: 'date',
      spoken: match[0],
      ymd,
      weekday: weekdayOfYmd(ymd),
    });
  }

  const windows = windowRe();
  while ((match = windows.exec(text))) {
    const hour = hourValue(match[1], match[2]);
    if (hour == null) continue;
    marks.push({ index: match.index, kind: 'window', hour });
  }

  return marks.sort((a, b) => a.index - b.index);
}

function applyMark(state: DayState | null, mark: Exclude<Mark, { kind: 'window' }>): DayState {
  if (mark.kind === 'rel') {
    return { weekday: mark.weekday, ymd: mark.ymd, spoken: mark.spoken };
  }
  if (mark.kind === 'weekday') {
    const keepYmd = state?.ymd && weekdayOfYmd(state.ymd) === mark.weekday ? state.ymd : undefined;
    return { weekday: mark.weekday, ymd: keepYmd, spoken: mark.spoken };
  }
  const conflict = Boolean(state?.weekday && state.weekday !== mark.weekday);
  return {
    ymd: mark.ymd,
    weekday: conflict ? state?.weekday : mark.weekday,
    spoken: conflict ? `${state?.spoken}, ${mark.spoken}` : mark.spoken,
  };
}

function dayMatches(state: DayState, slot: SlotDay): boolean {
  if (state.ymd && state.ymd !== slot.ymd) return false;
  if (state.weekday && state.weekday !== slot.weekday) return false;
  return Boolean(state.ymd || state.weekday);
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

/**
 * Compare the day Mike spoke for this slot's window with the slot itself.
 * No transcript, or no day spoken, is not a mismatch.
 */
export function checkOfferedDay(
  params: Record<string, unknown>,
  turns: ConsentTurn[] = [],
  now: Date = new Date(),
): OfferedDayDecision {
  const slot = slotDay(params.startAt ?? params.slotId);
  if (!slot) return { ok: true };
  const text = turns.filter((turn) => turn.role === 'bot').map((turn) => turn.text).join('\n');
  if (!text.trim()) return { ok: true };

  const marks = collectMarks(text, now);
  let state: DayState | null = null;
  const offers: Array<{ hour: number; state: DayState }> = [];
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (mark.kind === 'window') {
      let attached = state && (state.weekday || state.ymd) ? state : null;
      if (!attached) {
        const upcoming = marks.slice(i + 1);
        const nextDay = upcoming.find((item) => item.kind !== 'window');
        const nextWindow = upcoming.find((item) => item.kind === 'window');
        if (nextDay && nextDay.kind !== 'window' && (!nextWindow || nextDay.index < nextWindow.index)) {
          attached = applyMark(state, nextDay);
        }
      }
      if (attached && (attached.weekday || attached.ymd)) offers.push({ hour: mark.hour, state: { ...attached } });
      continue;
    }
    state = applyMark(state, mark);
  }

  const matched = offers.filter((offer) => offer.hour === slot.hour24);
  const chosen = matched.length ? matched[matched.length - 1].state : state;
  if (!chosen || (!chosen.weekday && !chosen.ymd)) return { ok: true };
  if (dayMatches(chosen, slot)) return { ok: true };
  return refuse(chosen.spoken, slot);
}
