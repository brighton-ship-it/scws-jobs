/**
 * Open service-call slots from the live Jobber calendar.
 *
 * Candidate windows are shop service-call hours. A slot is returned only
 * when it does not overlap a Jobber visit for the assigned tech.
 * If Jobber is down, return no slots — never invent times.
 */

import {
  DEFAULT_JOBBER_GRAPHQL_VERSION,
  JOBBER_GRAPHQL_URL,
  PACIFIC_TZ,
  formatPtDate,
  formatVisitTime,
  ptCalendarDate,
} from './check-schedule.ts';
import {
  assignShopTech,
  resolveTechUserId,
  type JobberUser,
  type ShopTech,
  userDisplayName,
} from './tech-assignment.ts';

export const SLOT_HOURS_PT = [8, 10, 13] as const;
export const SLOT_DURATION_MINUTES = 120;
export const MAX_OPEN_SLOTS = 6;
export const SLOT_LOOKAHEAD_DAYS = 14;

export type OccupiedVisit = {
  startAt: string;
  endAt?: string | null;
  allDay?: boolean;
  technicianIds?: string[];
  technicianNames?: string[];
};

export type OpenSlot = {
  startAt: string;
  endAt: string;
  date: string;
  time: string;
  technician: string;
  technicianId: string;
};

export type OpenSlotsDeps = {
  fetchFn?: typeof fetch;
  now?: Date;
  accessToken?: string | null;
  graphqlVersion?: string;
  env?: NodeJS.ProcessEnv;
};

export type OpenSlotsResult = {
  lookupStatus: 'ok' | 'error';
  openSlots: OpenSlot[];
  assignedTechName: string;
  assignedTechId: string | null;
  error?: string;
};

const USERS_QUERY = `
  query ShopUsers {
    users(first: 50) {
      nodes {
        id
        name { full first last }
        email { raw }
      }
    }
  }
`;

const USERS_QUERY_BARE = `
  query ShopUsers {
    users(first: 50) {
      nodes {
        id
        name { full first last }
      }
    }
  }
`;

const OCCUPIED_VISITS_QUERY = `
  query OccupiedVisits($startAfter: ISO8601DateTime!, $startBefore: ISO8601DateTime!) {
    visits(first: 100, filter: { startAt: { after: $startAfter, before: $startBefore } }) {
      nodes {
        id
        startAt
        endAt
        allDay
        assignedUsers {
          nodes {
            id
            name { full first last }
          }
        }
      }
    }
  }
`;

function jobberHeaders(token: string, version: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-JOBBER-GRAPHQL-VERSION': version,
  };
}

async function jobberGraphql(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  fetchFn: typeof fetch,
  version: string
): Promise<{ data?: any; errors?: Array<{ message?: string }> }> {
  const response = await fetchFn(JOBBER_GRAPHQL_URL, {
    method: 'POST',
    headers: jobberHeaders(token, version),
    body: JSON.stringify({ query, variables }),
  });

  let json: { data?: any; errors?: Array<{ message?: string }> };
  try {
    json = (await response.json()) as typeof json;
  } catch {
    throw new Error(`Jobber GraphQL HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`Jobber GraphQL HTTP ${response.status}`);
  }

  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || 'Jobber GraphQL error');
  }

  return json;
}

function zonedDate(dateStr: string, hour: number, minute: number): Date {
  const asUtcGuess = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-08:00`);
  const shown = ptClockMinutes(asUtcGuess);
  const wanted = hour * 60 + minute;
  return new Date(asUtcGuess.getTime() + (wanted - shown) * 60_000);
}

function ptClockMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || '0');
  return hour * 60 + minute;
}

function ptWeekday(date: Date): number {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ,
    weekday: 'short',
  }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(label);
}

function addPtDays(now: Date, days: number): string {
  const dateStr = ptCalendarDate(now);
  const [year, month, day] = dateStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return ptCalendarDate(shifted);
}

export function visitsOverlapSlot(
  visit: OccupiedVisit,
  slotStart: Date,
  slotEnd: Date
): boolean {
  if (!visit.startAt) return false;
  const visitStart = new Date(visit.startAt);
  if (Number.isNaN(visitStart.getTime())) return false;

  if (visit.allDay) {
    return ptCalendarDate(visitStart) === ptCalendarDate(slotStart);
  }

  const visitEnd = visit.endAt ? new Date(visit.endAt) : new Date(visitStart.getTime() + SLOT_DURATION_MINUTES * 60_000);
  return visitStart < slotEnd && visitEnd > slotStart;
}

export function visitBelongsToTech(
  visit: OccupiedVisit,
  techId: string,
  techName: string
): boolean {
  if (visit.technicianIds?.includes(techId)) return true;
  const needle = techName.trim().toLowerCase();
  return (visit.technicianNames || []).some((name) => {
    const hay = name.toLowerCase();
    return hay.includes(needle) || needle.includes(hay);
  });
}

export function computeOpenSlots(options: {
  occupied: OccupiedVisit[];
  now: Date;
  technicianId: string;
  technicianName: string;
  maxSlots?: number;
}): OpenSlot[] {
  const maxSlots = options.maxSlots ?? MAX_OPEN_SLOTS;
  const slots: OpenSlot[] = [];
  const techOccupied = options.occupied.filter((visit) =>
    visitBelongsToTech(visit, options.technicianId, options.technicianName)
  );

  for (let day = 0; day <= SLOT_LOOKAHEAD_DAYS && slots.length < maxSlots; day++) {
    const dateStr = addPtDays(options.now, day);
    const weekdayDate = zonedDate(dateStr, 12, 0);
    const weekday = ptWeekday(weekdayDate);
    if (weekday === 0 || weekday === 6) continue;

    for (const hour of SLOT_HOURS_PT) {
      const start = zonedDate(dateStr, hour, 0);
      const end = new Date(start.getTime() + SLOT_DURATION_MINUTES * 60_000);
      if (start <= options.now) continue;

      const blocked = techOccupied.some((visit) => visitsOverlapSlot(visit, start, end));
      if (blocked) continue;

      slots.push({
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        date: formatPtDate(start),
        time: formatVisitTime(start.toISOString(), end.toISOString(), false),
        technician: options.technicianName,
        technicianId: options.technicianId,
      });
      if (slots.length >= maxSlots) break;
    }
  }

  return slots;
}

export function slotMatchesRequest(slot: OpenSlot, requestedStartAt: string): boolean {
  if (!requestedStartAt) return false;
  if (slot.startAt === requestedStartAt) return true;

  const requested = new Date(requestedStartAt);
  const slotStart = new Date(slot.startAt);
  if (Number.isNaN(requested.getTime()) || Number.isNaN(slotStart.getTime())) return false;

  return (
    ptCalendarDate(requested) === ptCalendarDate(slotStart) &&
    Math.abs(requested.getTime() - slotStart.getTime()) <= 30 * 60_000
  );
}

function mapVisitNode(node: any): OccupiedVisit {
  const users = node?.assignedUsers?.nodes || [];
  return {
    startAt: node?.startAt,
    endAt: node?.endAt || null,
    allDay: Boolean(node?.allDay),
    technicianIds: users.map((user: { id?: string }) => user?.id).filter(Boolean),
    technicianNames: users.map((user: JobberUser) => userDisplayName(user)).filter(Boolean),
  };
}

export async function lookupOpenSlots(
  location: { city?: string; address?: string; zip?: string },
  deps: OpenSlotsDeps = {}
): Promise<OpenSlotsResult> {
  const tech = assignShopTech(location);
  const token = deps.accessToken ?? process.env.JOBBER_ACCESS_TOKEN ?? null;
  if (!token) {
    return {
      lookupStatus: 'error',
      openSlots: [],
      assignedTechName: tech.name,
      assignedTechId: null,
      error: 'JOBBER_ACCESS_TOKEN is not set',
    };
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? new Date();
  const version =
    deps.graphqlVersion ??
    process.env.JOBBER_GRAPHQL_VERSION?.trim() ??
    DEFAULT_JOBBER_GRAPHQL_VERSION;

  try {
    let usersData: { data?: any };
    try {
      usersData = await jobberGraphql(token, USERS_QUERY, {}, fetchFn, version);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/email/i.test(message)) {
        usersData = await jobberGraphql(token, USERS_QUERY_BARE, {}, fetchFn, version);
      } else {
        throw error;
      }
    }
    const users = (usersData?.data?.users?.nodes || []) as JobberUser[];
    const resolved = resolveTechUserId(tech, users, deps.env ?? process.env);
    if (!resolved) {
      return {
        lookupStatus: 'error',
        openSlots: [],
        assignedTechName: tech.name,
        assignedTechId: null,
        error: `Jobber user not found for ${tech.name}`,
      };
    }

    const startAfter = now.toISOString();
    const startBefore = new Date(now.getTime() + (SLOT_LOOKAHEAD_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    const visitsData = await jobberGraphql(
      token,
      OCCUPIED_VISITS_QUERY,
      { startAfter, startBefore },
      fetchFn,
      version
    );

    const occupied = (visitsData?.data?.visits?.nodes || []).map(mapVisitNode);
    const openSlots = computeOpenSlots({
      occupied,
      now,
      technicianId: resolved.id,
      technicianName: resolved.name,
    });

    return {
      lookupStatus: 'ok',
      openSlots,
      assignedTechName: resolved.name,
      assignedTechId: resolved.id,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      lookupStatus: 'error',
      openSlots: [],
      assignedTechName: tech.name,
      assignedTechId: null,
      error: message,
    };
  }
}

export function shopTechForLocation(location: {
  city?: string;
  address?: string;
  zip?: string;
}): ShopTech {
  return assignShopTech(location);
}
