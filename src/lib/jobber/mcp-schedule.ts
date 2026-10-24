/**
 * Visit and assessment times for the shop.
 *
 * ScheduledItemAttributes.startAt / endAt are LocalDateTimeAttributes
 * (date, time, timezone), validated against the public Jobber introspection
 * at API version 2025-01-20. The gateway still sends X-JOBBER-GRAPHQL-VERSION
 * 2025-04-16. notifyTeam is always false and is not a tool argument.
 */

import { assertNoClientNotification } from './mcp-notify.ts';

export const SHOP_TIMEZONE = 'America/Los_Angeles';

export type ShopLocalDateTime = {
  date: string;
  time: string;
  timezone: string;
};

const NAIVE_DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function toShopLocalDateTime(
  value: string,
  field = 'startAt',
  timezone = SHOP_TIMEZONE
): ShopLocalDateTime {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);

  if (!HAS_ZONE.test(trimmed)) {
    const naive = NAIVE_DATE_TIME.exec(trimmed);
    if (!naive) {
      throw new Error(
        `${field} must be a datetime. A value without a zone is read as ${timezone} wall time (YYYY-MM-DDTHH:mm).`
      );
    }
    return {
      date: naive[1],
      time: `${naive[2]}:${naive[3]}:${naive[4] || '00'}`,
      timezone,
    };
  }

  const instant = new Date(trimmed);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`${field} is not a valid datetime`);
  }
  return instantInTimeZone(instant, timezone);
}

export function instantInTimeZone(instant: Date, timezone: string): ShopLocalDateTime {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((part) => [part.type, part.value]));
  let hour = parts.hour || '00';
  if (hour === '24') hour = '00';
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}:${parts.second}`,
    timezone,
  };
}

export function assertEndAfterStart(start: ShopLocalDateTime, end: ShopLocalDateTime): void {
  if (`${end.date}T${end.time}` <= `${start.date}T${start.time}`) {
    throw new Error('endAt must be after startAt');
  }
}

/**
 * TaskCreateInput.startAt / endAt are ISO8601DateTime, not
 * LocalDateTimeAttributes. Convert a shop wall time to an offset ISO string
 * so a zone-less "09:00" stays 09:00 in America/Los_Angeles.
 * A repeated fall-back hour uses the earlier (daylight) instant.
 * A spring-forward gap throws.
 */
export function shopWallTimeToIso8601(local: ShopLocalDateTime): string {
  const wallAsUtc = wallComponentsToUtcMs(local.date, local.time);
  let utcMs = wallAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shown = instantInTimeZone(new Date(utcMs), local.timezone);
    const shownAsUtc = wallComponentsToUtcMs(shown.date, shown.time);
    const delta = wallAsUtc - shownAsUtc;
    if (delta === 0) break;
    utcMs += delta;
  }
  const shown = instantInTimeZone(new Date(utcMs), local.timezone);
  if (shown.date !== local.date || shown.time !== local.time) {
    throw new Error(
      `${local.date}T${local.time} is not a valid ${local.timezone} wall time (daylight-saving gap).`
    );
  }
  const offsetMinutes = Math.round((wallAsUtc - utcMs) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `${local.date}T${local.time}${sign}${hours}:${minutes}`;
}

function wallComponentsToUtcMs(date: string, time: string): number {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const [hour, minute, second] = time.split(':').map((part) => Number(part));
  return Date.UTC(year, month - 1, day, hour, minute || 0, second || 0);
}

/**
 * ScheduledItemAttributes. notifyTeam is forced off.
 * teamReminderOffset is omitted so this does not schedule a reminder.
 */
export function buildScheduledItemAttributes(input: {
  startAt: string;
  endAt: string;
  assigneeIds?: string[];
}): Record<string, unknown> {
  const startAt = toShopLocalDateTime(input.startAt, 'startAt');
  const endAt = toShopLocalDateTime(input.endAt, 'endAt');
  assertEndAfterStart(startAt, endAt);
  const schedule: Record<string, unknown> = {
    notifyTeam: false,
    startAt,
    endAt,
  };
  if (input.assigneeIds?.length) {
    schedule.teamMemberIdsToAssign = input.assigneeIds;
  }
  assertNoClientNotification(schedule);
  return schedule;
}
