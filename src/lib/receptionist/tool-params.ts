/**
 * Normalizes Vapi tool arguments so older/newer prompt vocab both work.
 *
 * Old Vapi tool/prompt: availableSlots, slotId, callerName, preferredDate/preferredTime.
 * Server vocab:         openSlots, startAt, name.
 * Either is accepted here, so a stale assistant config cannot silently break booking.
 */

import { ptCalendarDate } from './check-schedule.ts';
import type { OpenSlot } from './open-slots.ts';

type Params = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** startAt from startAt | slotId | slot | slot_id | start | preferredDate when it is a full ISO datetime. */
export function pickStartAt(params: Params): string {
  const direct = str(params.startAt) || str(params.slotId) || str(params.slot_id) || str(params.slot) || str(params.start);
  if (direct) return direct;
  const date = str(params.preferredDate);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(date)) return date;
  return '';
}

export function normalizeBookJobParams(params: Params, callPhone = ''): Params {
  return {
    ...params,
    phone: str(params.phone) || callPhone,
    name: str(params.name) || str(params.callerName) || str(params.customerName),
    startAt: pickStartAt(params),
    notes: str(params.notes) || str(params.reason) || str(params.serviceType),
  };
}

export function normalizeCheckScheduleParams(params: Params): Params {
  const intent = str(params.intent).toLowerCase();
  return {
    ...params,
    intent: intent || (str(params.city) || str(params.address) || str(params.zip) ? 'book' : ''),
  };
}

function parseClock(text: string): number | null {
  const m = text.toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3]?.replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 6) h += 12; // slots are 8, 10, 1pm: bare 1-6 means afternoon
  return h * 60 + min;
}

/**
 * Resolve preferredDate (YYYY-MM-DD or the slot's date label) + preferredTime to one
 * of the real open slots. Returns '' unless exactly one slot matches.
 */
export function resolveSlotFromPreference(slots: OpenSlot[], preferredDate?: unknown, preferredTime?: unknown): string {
  const date = str(preferredDate).toLowerCase();
  const time = str(preferredTime);
  if (!date && !time) return '';
  const wantMinutes = time ? parseClock(time) : null;
  const matches = slots.filter((slot) => {
    if (date) {
      const iso = ptCalendarDate(new Date(slot.startAt));
      if (!(iso === date || slot.date.toLowerCase().includes(date) || date.includes(slot.date.toLowerCase()))) return false;
    }
    if (wantMinutes != null) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
      }).formatToParts(new Date(slot.startAt));
      const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
      const mi = Number(parts.find((p) => p.type === 'minute')?.value || 0);
      if (Math.abs(h * 60 + mi - wantMinutes) > 30) return false;
    }
    return true;
  });
  return matches.length === 1 ? matches[0].startAt : '';
}
