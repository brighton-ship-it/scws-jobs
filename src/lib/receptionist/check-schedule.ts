/**
 * Jobber schedule lookup for Sarah's checkSchedule tool.
 *
 * Confirmation is allowed only when this payload contains a real upcoming visit.
 * Matching an existing customer by phone is not proof of a visit.
 */

export const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
export const DEFAULT_JOBBER_GRAPHQL_VERSION = '2026-02-17';
export const PACIFIC_TZ = 'America/Los_Angeles';

export type ScheduleLookupStatus = 'ok' | 'error' | 'no_account';

export type ScheduleVisit = {
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  service: string | null;
  address: string | null;
  technicians: string[];
  date: string;
  time: string;
};

export type NextAppointment = {
  date: string;
  time: string;
  service: string | null;
  address: string | null;
  technicians: string[];
};

export type ScheduleLookupResult = {
  lookupStatus: ScheduleLookupStatus;
  found: boolean;
  hasAppointments: boolean;
  canConfirm: boolean;
  customerName?: string | null;
  visits: ScheduleVisit[];
  nextAppointment?: NextAppointment;
  totalUpcoming?: number;
  message: string;
  confirmationRule: string;
  error?: string;
};

export type CheckScheduleDeps = {
  fetchFn?: typeof fetch;
  now?: Date;
  accessToken?: string | null;
  graphqlVersion?: string;
};

export type CheckScheduleResponse = {
  result: ScheduleLookupResult;
};

const SEARCH_CLIENTS_QUERY = `
  query SearchClients($searchTerm: String!) {
    clients(searchTerm: $searchTerm, first: 5) {
      nodes {
        id
        name
        phones { number }
      }
    }
  }
`;

const UPCOMING_VISITS_QUERY = `
  query GetUpcomingVisits($clientId: EncodedId!) {
    client(id: $clientId) {
      name
      jobs(first: 20) {
        nodes {
          title
          property {
            address {
              street1
              city
            }
          }
          visits(first: 10) {
            nodes {
              id
              startAt
              endAt
              allDay
              assignedUsers {
                nodes {
                  name {
                    full
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const NO_VISIT_CONFIRMATION_RULE =
  'Do not confirm any date, time, or technician. Say you do not see that appointment. Offer an office callback. Matching this customer by phone is not proof of a visit.';

export const LOOKUP_ERROR_CONFIRMATION_RULE =
  'Do not confirm any appointment. Say you will have the office verify. Do not say you see it, you confirmed it, or that everything looks good.';

export const VISIT_CONFIRMATION_RULE =
  'You may confirm only the date, time, and technician names in visits / nextAppointment. If the caller names a date, time, or technician that is not listed, do not agree.';

export function normalizePhone10(phone: string): string {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

export function ptCalendarDate(date: Date, timeZone = PACIFIC_TZ): string {
  return date.toLocaleDateString('en-CA', { timeZone });
}

export function formatPtDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: PACIFIC_TZ,
  });
}

export function formatPtTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: PACIFIC_TZ,
  });
}

export function isOnOrAfterTodayPt(startAt: string, now: Date): boolean {
  const visit = new Date(startAt);
  if (Number.isNaN(visit.getTime())) return false;
  return ptCalendarDate(visit) >= ptCalendarDate(now);
}

/**
 * Jobber returns assignedUsers as a UserConnection. Older/broken shapes
 * (flat `{ name }` or `{ name: { full } }`) are accepted so a real visit
 * still surfaces technician names.
 */
export function technicianNamesFromAssignedUsers(assignedUsers: unknown): string[] {
  if (!assignedUsers) return [];

  const raw = assignedUsers as {
    nodes?: unknown[];
    name?: unknown;
  };

  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes
    : Array.isArray(assignedUsers)
      ? assignedUsers
      : [assignedUsers];

  const names: string[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const name = (node as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) {
      names.push(name.trim());
      continue;
    }
    if (name && typeof name === 'object') {
      const full = (name as { full?: unknown; first?: unknown }).full;
      const first = (name as { first?: unknown }).first;
      if (typeof full === 'string' && full.trim()) {
        names.push(full.trim());
        continue;
      }
      if (typeof first === 'string' && first.trim()) {
        names.push(first.trim());
      }
    }
  }
  return names;
}

export function formatVisitTime(startAt: string, endAt: string | null, allDay: boolean): string {
  if (allDay) return 'anytime during the day';

  const start = new Date(startAt);
  const startTime = formatPtTime(start);

  if (endAt) {
    const endTime = formatPtTime(new Date(endAt));
    return `between ${startTime} and ${endTime}`;
  }
  return `starting at ${startTime}`;
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

function noAccountResult(): ScheduleLookupResult {
  return {
    lookupStatus: 'no_account',
    found: false,
    hasAppointments: false,
    canConfirm: false,
    visits: [],
    message:
      "I don't see an account with this phone number in our system. Would you like me to take down your information and have someone call you back to schedule an appointment?",
    confirmationRule: NO_VISIT_CONFIRMATION_RULE,
  };
}

function noVisitsResult(customerName: string | null): ScheduleLookupResult {
  const nameBit = customerName ? `, ${customerName}` : '';
  return {
    lookupStatus: 'ok',
    found: true,
    hasAppointments: false,
    canConfirm: false,
    customerName,
    visits: [],
    totalUpcoming: 0,
    message: `I found your account${nameBit}, but I don't see any upcoming appointments. I'll have the office call you back.`,
    confirmationRule: NO_VISIT_CONFIRMATION_RULE,
  };
}

export function scheduleLookupError(message?: string): ScheduleLookupResult {
  return {
    lookupStatus: 'error',
    found: false,
    hasAppointments: false,
    canConfirm: false,
    visits: [],
    error: message || 'Failed to process request',
    message:
      "I'm not able to pull up the schedule right now. I'll have the office verify and call you back.",
    confirmationRule: LOOKUP_ERROR_CONFIRMATION_RULE,
  };
}

function collectVisits(jobs: any[], now: Date): ScheduleVisit[] {
  const visits: ScheduleVisit[] = [];

  for (const job of jobs) {
    for (const visit of job.visits?.nodes || []) {
      if (!visit?.startAt || !isOnOrAfterTodayPt(visit.startAt, now)) continue;

      const allDay = Boolean(visit.allDay ?? visit.anytime);
      const date = formatPtDate(new Date(visit.startAt));
      const time = formatVisitTime(visit.startAt, visit.endAt || null, allDay);
      const address = job.property?.address
        ? `${job.property.address.street1}, ${job.property.address.city}`
        : null;

      visits.push({
        startAt: visit.startAt,
        endAt: visit.endAt || null,
        allDay,
        service: job.title || null,
        address,
        technicians: technicianNamesFromAssignedUsers(visit.assignedUsers),
        date,
        time,
      });
    }
  }

  visits.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  return visits;
}

function visitsFoundResult(customerName: string | null, visits: ScheduleVisit[]): ScheduleLookupResult {
  const next = visits[0];
  let message = `Yes! I see you're scheduled for ${next.service || 'service'} on ${next.date}, ${next.time}.`;

  if (next.address) {
    message += ` The appointment is for ${next.address}.`;
  }
  if (next.technicians.length > 0) {
    message += ` ${next.technicians.join(' and ')} will be handling your service.`;
  }
  if (visits.length > 1) {
    message += ` You also have ${visits.length - 1} more appointment${visits.length > 2 ? 's' : ''} coming up.`;
  }

  return {
    lookupStatus: 'ok',
    found: true,
    hasAppointments: true,
    canConfirm: true,
    customerName,
    visits,
    nextAppointment: {
      date: next.date,
      time: next.time,
      service: next.service,
      address: next.address,
      technicians: next.technicians,
    },
    totalUpcoming: visits.length,
    message,
    confirmationRule: VISIT_CONFIRMATION_RULE,
  };
}

export async function lookupUpcomingVisits(
  phone: string,
  deps: CheckScheduleDeps = {}
): Promise<ScheduleLookupResult> {
  const token = deps.accessToken ?? process.env.JOBBER_ACCESS_TOKEN ?? null;
  if (!token) {
    return scheduleLookupError('JOBBER_ACCESS_TOKEN is not set');
  }

  const normalized = normalizePhone10(phone);
  if (normalized.length < 10) {
    return noAccountResult();
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? new Date();
  const version =
    deps.graphqlVersion ??
    process.env.JOBBER_GRAPHQL_VERSION?.trim() ??
    DEFAULT_JOBBER_GRAPHQL_VERSION;
  const searchTerm = normalized.slice(-7);

  const clientData = await jobberGraphql(
    token,
    SEARCH_CLIENTS_QUERY,
    { searchTerm },
    fetchFn,
    version
  );

  const clients = clientData?.data?.clients?.nodes || [];
  let clientId: string | null = null;
  let clientName: string | null = null;

  for (const client of clients) {
    for (const phoneObj of client.phones || []) {
      const clientPhone = normalizePhone10(phoneObj.number || '');
      if (clientPhone === normalized) {
        clientId = client.id;
        clientName = client.name || null;
        break;
      }
    }
    if (clientId) break;
  }

  if (!clientId) {
    return noAccountResult();
  }

  const scheduleData = await jobberGraphql(
    token,
    UPCOMING_VISITS_QUERY,
    { clientId },
    fetchFn,
    version
  );

  const jobs = scheduleData?.data?.client?.jobs?.nodes || [];
  const visits = collectVisits(jobs, now);

  if (visits.length === 0) {
    return noVisitsResult(clientName);
  }

  return visitsFoundResult(clientName, visits);
}

export async function handleCheckSchedule(
  phone: string,
  deps: CheckScheduleDeps = {}
): Promise<CheckScheduleResponse> {
  try {
    return { result: await lookupUpcomingVisits(phone, deps) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { result: scheduleLookupError(message) };
  }
}
