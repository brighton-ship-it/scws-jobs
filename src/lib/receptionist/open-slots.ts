/**
 * Open service-call slots from the live Jobber calendar.
 *
 * Candidate windows are shop service-call hours on weekdays only
 * (Monday–Friday Pacific). Never Saturday or Sunday. A slot is returned
 * only when it does not overlap a Jobber visit for an allowlisted tech
 * (Ramona: Brian Eads; Anza: Doug Pollack or Cowin; plus fallback techs
 * Chris/Haze/Colton/Sergio only when strictly earlier and fully open). After-hours callers
 * (including Friday night) are offered the next weekday window. If neither
 * allowed tech has a window, return no slots. If Jobber is down, return no
 * slots — never invent times or assign Travis.
 *
 * Availability is computed from the CONTENTS of each tech's board, not from "any
 * visit on the day": a short service call leaves the other windows open, an all-day
 * drill/install (or any all-day visit we cannot identify as a short stop) closes the
 * day, travel time between sites is added, and a tech is capped at N service stops
 * per day (default 4, RECEPTIONIST_MAX_STOPS_PER_DAY).
 */

import {
  DEFAULT_JOBBER_GRAPHQL_VERSION,
  JOBBER_GRAPHQL_URL,
  PACIFIC_TZ,
  formatPtDate,
  formatVisitTime,
  ptCalendarDate,
  resolveReceptionistJobberToken,
} from './check-schedule.ts';
import {
  allowedTechSpokenName,
  assignShopTech,
  formatTechNames,
  isAllowlistedTechId,
  resolveFallbackTechs,
  resolveTechsForLocation,
  normalizePlace,
  type JobberUser,
  type ShopTech,
  userDisplayName,
} from './tech-assignment.ts';

export const SLOT_HOURS_PT = [8, 10, 13] as const;
export const SLOT_DURATION_MINUTES = 120;
export const MAX_OPEN_SLOTS = 6;
export const SLOT_LOOKAHEAD_DAYS = 14;
const MAX_VISIT_PAGES = 10;
/** Expected on-site time for the $200 service call we are placing. */
export const SERVICE_WORK_MINUTES = 90;
/** The tech may arrive up to this long after the window opens. */
export const ARRIVAL_SLACK_MINUTES = 30;
/** Default cap of scheduled stops per tech per day (override with RECEPTIONIST_MAX_STOPS_PER_DAY). */
export const DEFAULT_MAX_STOPS_PER_DAY = 4;
/** Visits seen this far before "now" are loaded so multi-day jobs already under way still block. */
const LOOKBACK_DAYS = 3;

export type OccupiedVisit = {
  startAt: string;
  endAt?: string | null;
  allDay?: boolean;
  technicianIds?: string[];
  technicianNames?: string[];
  /** Visit title, e.g. "Service Call". */
  title?: string | null;
  jobTitle?: string | null;
  jobType?: string | null;
  /** Property city, used for travel-time estimates. */
  city?: string | null;
};

export type VisitKind = 'drill_install' | 'service' | 'assessment' | 'other';

const DRILL_INSTALL_RE =
  /\b(drill\w*|new well|well install\w*|install\w*|rig|casing|hydro-?\s?frac\w*|frac\w*|abandon\w*|trench\w*|tank install\w*|pull(?:ing)?|fish(?:ing)?|tie-?\s?in|booster|upgrade|replace\w*|rehab\w*|well (?:cap|head|development)|pump (?:&|and) motor|conversion)\b/i;
const ASSESSMENT_RE = /\b(assess\w*|inspect\w*|estimate|quote|walk-?through|site visit|water test|consult\w*)\b/i;
const SERVICE_RE =
  /\b(service call|service|repair\w*|troubleshoot\w*|diagnos\w*|no water|low pressure|pressure|leak\w*|maintenance|check)\b/i;

export function classifyVisit(visit: Pick<OccupiedVisit, 'title' | 'jobTitle' | 'jobType'>): VisitKind {
  const text = [visit.title, visit.jobTitle].filter(Boolean).join(' | ');
  if (text && DRILL_INSTALL_RE.test(text)) return 'drill_install';
  if (text && ASSESSMENT_RE.test(text)) return 'assessment';
  if (text && SERVICE_RE.test(text)) return 'service';
  return 'other';
}

const DESERT_CITIES = new Set([
  'anza', 'aguanga', 'borrego springs', 'borrego', 'ocotillo wells', 'salton city', 'thermal',
  'indio', 'palm desert', 'coachella', 'mountain center', 'idyllwild', 'warner springs',
  'julian', 'santa ysabel',
]);

/** Rough drive-time estimate (minutes) between two sites by city / zone. */
export function estimateTravelMinutes(a?: string | null, b?: string | null): number {
  const ca = normalizePlace(a || '');
  const cb = normalizePlace(b || '');
  if (!ca || !cb) return 30;
  if (ca === cb) return 20;
  const za = DESERT_CITIES.has(ca) ? 'desert' : 'west';
  const zb = DESERT_CITIES.has(cb) ? 'desert' : 'west';
  return za === zb ? 40 : 60;
}

export function maxStopsPerDay(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.RECEPTIONIST_MAX_STOPS_PER_DAY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_MAX_STOPS_PER_DAY;
}

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
  allowlistedTechIds: string[];
  error?: string;
  /** Per-tech board (times/kind only, no customer info). Internal only; never returned by the public webhook (contains visit titles). */
  board?: Array<{ technician: string; visits: Array<{ startAt: string; endAt: string | null; allDay: boolean; kind: VisitKind; title: string | null; city: string | null }> }>;
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

function occupiedVisitsQuery(detail: 'rich' | 'mid' | 'base'): string {
  const extra =
    detail === 'base'
      ? ''
      : detail === 'mid'
        ? `
        title
        job { title jobType }`
        : `
        title
        job { title jobType property { address { city } } }`;
  return `
  query OccupiedVisits($startAfter: ISO8601DateTime!, $startBefore: ISO8601DateTime!, $cursor: String) {
    visits(first: ${detail === 'base' ? 100 : 50}, after: $cursor, filter: { startAt: { after: $startAfter, before: $startBefore } }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        startAt
        endAt
        allDay${extra}
        assignedUsers(first: 5) {
          nodes {
            id
            name { full first last }
          }
        }
      }
    }
  }
`;
}

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

export function ptWeekday(date: Date): number {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ,
    weekday: 'short',
  }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(label);
}

/** Jobber service-call visits may land Monday–Friday PT only. */
export function isWeekdayVisitStart(startAt: string | Date | null | undefined): boolean {
  if (!startAt) return false;
  const date = typeof startAt === 'string' ? new Date(startAt) : startAt;
  if (Number.isNaN(date.getTime())) return false;
  const weekday = ptWeekday(date);
  return weekday >= 1 && weekday <= 5;
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
    return visitCoversPtDay(visit, ptCalendarDate(slotStart));
  }

  const visitEnd = visit.endAt ? new Date(visit.endAt) : new Date(visitStart.getTime() + SLOT_DURATION_MINUTES * 60_000);
  return visitStart < slotEnd && visitEnd > slotStart;
}

/** PT calendar days (inclusive) an all-day / multi-day visit spans. */
function visitCoversPtDay(visit: OccupiedVisit, dateStr: string): boolean {
  const start = new Date(visit.startAt);
  if (Number.isNaN(start.getTime())) return false;
  const first = ptCalendarDate(start);
  let last = first;
  if (visit.endAt) {
    const end = new Date(visit.endAt);
    if (!Number.isNaN(end.getTime()) && end > start) {
      // An end exactly at local midnight does not touch the next day.
      last = ptCalendarDate(new Date(end.getTime() - 1));
    }
  }
  return dateStr >= first && dateStr <= last;
}

/**
 * An all-day ("anytime") visit closes the whole day only when it is heavy field work
 * (drilling, install, pump pull, fishing, tie-in, …) or spans several days. Service
 * calls and assessments count as one stop; other all-day jobs count as two.
 */
function stopWeight(visit: OccupiedVisit): number {
  if (!visit.allDay) return 1;
  return classifyVisit(visit) === 'other' ? 2 : 1;
}

function allDayVisitBlocksDay(visit: OccupiedVisit): boolean {
  if (!visit.allDay) return false;
  const kind = classifyVisit(visit);
  if (kind === 'service' || kind === 'assessment' || kind === 'other') {
    // Only heavy field work (drill/install/pull/fish/…) closes the day. Anything else
    // all-day is counted as a (heavier) stop. Multi-day entries are projects.
    const start = new Date(visit.startAt);
    const end = visit.endAt ? new Date(visit.endAt) : null;
    if (end && !Number.isNaN(end.getTime()) && end.getTime() - start.getTime() > 36 * 3_600_000) return true;
    return false;
  }
  return true;
}

/** Can this timed visit coexist with a service call at slotStart (work + travel)? */
function timedVisitAllowsSlot(visit: OccupiedVisit, slotStart: Date, siteCity?: string | null): boolean {
  const visitStart = new Date(visit.startAt);
  if (Number.isNaN(visitStart.getTime())) return true;
  const visitEnd = visit.endAt
    ? new Date(visit.endAt)
    : new Date(visitStart.getTime() + SLOT_DURATION_MINUTES * 60_000);
  const travelMs = estimateTravelMinutes(visit.city, siteCity) * 60_000;
  if (visitEnd <= slotStart) {
    return visitEnd.getTime() + travelMs <= slotStart.getTime() + ARRIVAL_SLACK_MINUTES * 60_000;
  }
  if (visitStart >= slotStart) {
    return slotStart.getTime() + SERVICE_WORK_MINUTES * 60_000 + travelMs <= visitStart.getTime();
  }
  return false; // visit spans the window start
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
  /** Caller's city, for travel-time estimates. */
  siteCity?: string | null;
  /** Cap of scheduled stops per tech per day. */
  maxStops?: number;
}): OpenSlot[] {
  const maxSlots = options.maxSlots ?? MAX_OPEN_SLOTS;
  const maxStops = options.maxStops ?? maxStopsPerDay();
  const slots: OpenSlot[] = [];
  const techOccupied = options.occupied.filter((visit) =>
    visitBelongsToTech(visit, options.technicianId, options.technicianName)
  );

  for (let day = 0; day <= SLOT_LOOKAHEAD_DAYS && slots.length < maxSlots; day++) {
    const dateStr = addPtDays(options.now, day);
    const weekdayDate = zonedDate(dateStr, 12, 0);
    if (!isWeekdayVisitStart(weekdayDate)) continue;

    // Whole-day closers: all-day drill/install (or unidentified all-day) visits.
    if (techOccupied.some((visit) => allDayVisitBlocksDay(visit) && visitCoversPtDay(visit, dateStr))) {
      continue;
    }
    // Stop cap: every visit that starts today (timed or anytime) is one stop.
    const stops = techOccupied
      .filter((visit) => visit.startAt && ptCalendarDate(new Date(visit.startAt)) === dateStr)
      .reduce((sum, visit) => sum + stopWeight(visit), 0);
    if (stops >= maxStops) continue;

    const timedToday = techOccupied.filter((visit) => !visit.allDay);

    for (const hour of SLOT_HOURS_PT) {
      const start = zonedDate(dateStr, hour, 0);
      const end = new Date(start.getTime() + SLOT_DURATION_MINUTES * 60_000);
      if (start <= options.now) continue;
      if (!isWeekdayVisitStart(start)) continue;

      const blocked = timedToday.some((visit) => {
        const vs = new Date(visit.startAt);
        if (Number.isNaN(vs.getTime())) return false;
        // Only visits near this window matter (same day, or a multi-day visit crossing it).
        const ve = visit.endAt ? new Date(visit.endAt) : new Date(vs.getTime() + SLOT_DURATION_MINUTES * 60_000);
        const nearStart = start.getTime() - 3 * 3_600_000;
        const nearEnd = end.getTime() + 3 * 3_600_000;
        if (ve.getTime() < nearStart || vs.getTime() > nearEnd) return false;
        return !timedVisitAllowsSlot(visit, start, options.siteCity);
      });
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

/** First allowlisted tech who is free at a window wins (Doug before Cowin on Anza). */
export function mergeOpenSlots(slotsByTech: OpenSlot[][], maxSlots = MAX_OPEN_SLOTS): OpenSlot[] {
  const byStart = new Map<string, OpenSlot>();
  for (const slots of slotsByTech) {
    for (const slot of slots) {
      if (!byStart.has(slot.startAt)) {
        byStart.set(slot.startAt, slot);
      }
    }
  }
  return [...byStart.values()]
    .filter((slot) => isWeekdayVisitStart(slot.startAt))
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(0, maxSlots);
}

/**
 * Primary pool wins. A fallback slot is kept only when it starts strictly before the
 * primary pool's first slot (or the primary pool has no slots at all).
 */
export function mergeWithFallbackSlots(
  primary: OpenSlot[],
  fallback: OpenSlot[],
  maxSlots = MAX_OPEN_SLOTS
): OpenSlot[] {
  const firstPrimary = primary.length
    ? primary.reduce((min, slot) => (slot.startAt < min ? slot.startAt : min), primary[0].startAt)
    : null;
  const earlier = fallback.filter(
    (slot) => firstPrimary === null || slot.startAt < firstPrimary
  );
  return mergeOpenSlots([primary, earlier], Math.max(maxSlots, 1));
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
    title: node?.title ?? null,
    jobTitle: node?.job?.title ?? null,
    jobType: node?.job?.jobType ?? null,
    city: node?.job?.property?.address?.city ?? node?.property?.address?.city ?? null,
    technicianIds: users.map((user: { id?: string }) => user?.id).filter(Boolean),
    technicianNames: users.map((user: JobberUser) => userDisplayName(user)).filter(Boolean),
  };
}

function emptyOpenSlots(
  assignedTechName: string,
  extra: { lookupStatus: 'ok' | 'error'; error?: string } = { lookupStatus: 'ok' }
): OpenSlotsResult {
  return {
    lookupStatus: extra.lookupStatus,
    openSlots: [],
    assignedTechName,
    assignedTechId: null,
    allowlistedTechIds: [],
    error: extra.error,
  };
}

export async function lookupOpenSlots(
  location: { city?: string; address?: string; zip?: string },
  deps: OpenSlotsDeps = {}
): Promise<OpenSlotsResult> {
  const spokenAllowed = allowedTechSpokenName(location);
  const resolvedToken = await resolveReceptionistJobberToken(deps.accessToken);
  if (!resolvedToken.ok) {
    return emptyOpenSlots(spokenAllowed, {
      lookupStatus: 'error',
      error: resolvedToken.error,
    });
  }
  const token = resolvedToken.token;

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
    const resolved = resolveTechsForLocation(location, users, deps.env ?? process.env);
    const primaryIds = new Set(resolved.map((tech) => tech.id));
    const fallbackResolved = resolveFallbackTechs(users, deps.env ?? process.env).filter(
      (tech) => !primaryIds.has(tech.id)
    );
    const assignedTechName = resolved.length
      ? formatTechNames(resolved.map((tech) => tech.name))
      : spokenAllowed;
    const allowlistedTechIds = resolved.map((tech) => tech.id);

    if (resolved.length === 0 && fallbackResolved.length === 0) {
      return emptyOpenSlots(assignedTechName, {
        lookupStatus: 'ok',
        error: `Allowlisted service tech not found in Jobber users (${spokenAllowed})`,
      });
    }

    const startAfter = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const startBefore = new Date(now.getTime() + (SLOT_LOOKAHEAD_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    const occupied: OccupiedVisit[] = [];
    let cursor: string | null = null;
    let complete = false;
    // Richest query first; if Jobber rejects a field or the cost, step down so slots still load.
    const ladder: Array<'rich' | 'mid' | 'base'> = ['rich', 'mid', 'base'];
    let level = 0;
    for (let page = 0; page < MAX_VISIT_PAGES; page++) {
      let visitsData: { data?: any } | null = null;
      while (!visitsData) {
        try {
          visitsData = await jobberGraphql(
            token,
            occupiedVisitsQuery(ladder[level]),
            { startAfter, startBefore, cursor },
            fetchFn,
            version
          );
        } catch (error) {
          if (level >= ladder.length - 1 || cursor) throw error;
          level += 1;
        }
      }
      occupied.push(...(visitsData?.data?.visits?.nodes || []).map(mapVisitNode));
      const pageInfo = visitsData?.data?.visits?.pageInfo;
      if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) {
        complete = true;
        break;
      }
      cursor = pageInfo.endCursor as string;
    }
    const siteCity = location.city || null;

    const perTechMax = SLOT_LOOKAHEAD_DAYS * SLOT_HOURS_PT.length;
    const slotsByTech = resolved.map((tech) =>
      computeOpenSlots({
        occupied,
        now,
        technicianId: tech.id,
        technicianName: tech.name,
        maxSlots: perTechMax,
        siteCity,
      }).filter((slot) => isAllowlistedTechId(slot.technicianId, allowlistedTechIds))
    );
    const primarySlots = mergeOpenSlots(slotsByTech, perTechMax * Math.max(resolved.length, 1));
    // Fallback techs need a COMPLETE view of the board; if visits were truncated, skip them.
    const fallbackSlots = complete
      ? mergeOpenSlots(
          fallbackResolved.map((tech) =>
            computeOpenSlots({
              occupied,
              now,
              technicianId: tech.id,
              technicianName: tech.name,
              maxSlots: perTechMax,
              siteCity,
            })
          ),
          perTechMax * Math.max(fallbackResolved.length, 1)
        )
      : [];
    const openSlots = mergeWithFallbackSlots(primarySlots, fallbackSlots).filter((slot) =>
      isWeekdayVisitStart(slot.startAt)
    );
    const allIds = [...allowlistedTechIds, ...(complete ? fallbackResolved.map((tech) => tech.id) : [])];

    return {
      lookupStatus: 'ok',
      openSlots,
      assignedTechName,
      assignedTechId: (resolved[0] ?? fallbackResolved[0]).id,
      allowlistedTechIds: allIds,
      board: [...resolved, ...(complete ? fallbackResolved : [])].map((tech) => ({
        technician: tech.name,
        visits: occupied
          .filter((visit) => visitBelongsToTech(visit, tech.id, tech.name))
          .map((visit) => ({
            startAt: visit.startAt,
            endAt: visit.endAt ?? null,
            allDay: Boolean(visit.allDay),
            kind: classifyVisit(visit),
            title: visit.title ?? null,
            city: visit.city ?? null,
          })),
      })),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return emptyOpenSlots(spokenAllowed, { lookupStatus: 'error', error: message });
  }
}

export function shopTechForLocation(location: {
  city?: string;
  address?: string;
  zip?: string;
}): ShopTech {
  return assignShopTech(location);
}
