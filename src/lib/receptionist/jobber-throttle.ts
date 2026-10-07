/**
 * Jobber GraphQL cost and throttle handling.
 *
 * A query whose requestedQueryCost is above maximumAvailable (10,000) is
 * rejected as "Throttled" even when the bucket is full, and retrying cannot
 * succeed. Connections omit `first`/`last` are priced as 100 nodes, and
 * nested connections multiply. See:
 * https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits/
 */

export const JOBBER_MAX_QUERY_COST = 10_000;
export const JOBBER_ASSUMED_PAGE_WITHOUT_LIMIT = 100;
export const JOBBER_DEFAULT_RESTORE_RATE = 500;

export const THROTTLE_MAX_ATTEMPTS = 3;
export const THROTTLE_MAX_WAIT_MS = 2_000;

export type JobberThrottleStatus = {
  maximumAvailable?: number;
  currentlyAvailable?: number;
  restoreRate?: number;
};

export type JobberCost = {
  requestedQueryCost?: number;
  actualQueryCost?: number | null;
  throttleStatus?: JobberThrottleStatus;
};

export type JobberGraphqlError = {
  message?: string;
  extensions?: { code?: string };
};

export type JobberGraphqlPayload = {
  data?: unknown;
  errors?: JobberGraphqlError[];
  extensions?: { cost?: JobberCost };
};

export function isJobberThrottled(payload: JobberGraphqlPayload | null | undefined): boolean {
  return (payload?.errors || []).some((error) => {
    if (error?.extensions?.code === 'THROTTLED') return true;
    return /^throttled$/i.test(error?.message || '');
  });
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * How long to wait before retrying a throttled query.
 * -1 means the query costs more than maximumAvailable and will never run.
 */
export function throttleBackoffMs(cost: JobberCost | undefined): number {
  const requested = finiteNumber(cost?.requestedQueryCost);
  const maximum = finiteNumber(cost?.throttleStatus?.maximumAvailable);
  const available = finiteNumber(cost?.throttleStatus?.currentlyAvailable);
  const restore = finiteNumber(cost?.throttleStatus?.restoreRate);

  if (requested != null && maximum != null && requested > maximum) return -1;
  if (requested == null || available == null) return 1_000;
  if (requested <= available) return 250;

  const rate = restore != null && restore > 0 ? restore : JOBBER_DEFAULT_RESTORE_RATE;
  const waitMs = Math.ceil((requested - available) / rate) * 1000;
  return Math.min(Math.max(waitMs, 250), THROTTLE_MAX_WAIT_MS);
}

/** Connection cost is page size times the cost of the fields on each node. `nodes` itself is free. */
export function connectionQueryCost(pageSize: number, fieldsPerNode: number): number {
  return pageSize * fieldsPerNode;
}

export const UPCOMING_JOBS_PAGE = 8;
export const UPCOMING_VISITS_PAGE = 5;
export const ASSIGNED_USERS_PAGE = 3;

/**
 * GetUpcomingVisits field cost, using Jobber's published rules:
 * each scalar or object field is 1, `nodes` is 0, and a connection is
 * `first` times the fields inside one node.
 *
 * assignedUsers { name { full } } is 2 fields.
 * A visit is startAt + endAt + allDay + that connection.
 * A job is title + property { address { street1 city } } (4) + visits.
 * The client field is 1.
 */
export function upcomingVisitsQueryCost(
  pages: { jobs: number; visits: number; assignedUsers: number } = {
    jobs: UPCOMING_JOBS_PAGE,
    visits: UPCOMING_VISITS_PAGE,
    assignedUsers: ASSIGNED_USERS_PAGE,
  }
): number {
  const assignedUsers = connectionQueryCost(pages.assignedUsers, 2);
  const visitFields = 3 + assignedUsers;
  const visits = connectionQueryCost(pages.visits, visitFields);
  const jobFields = 1 + 4 + visits;
  const jobs = connectionQueryCost(pages.jobs, jobFields);
  return 1 + jobs;
}

/**
 * The previous checkSchedule query: jobs(first: 20), visits(first: 10),
 * and assignedUsers with no `first` (priced as 100), plus visit id and client name.
 */
export function legacyUpcomingVisitsQueryCost(): number {
  const assignedUsers = connectionQueryCost(JOBBER_ASSUMED_PAGE_WITHOUT_LIMIT, 2);
  const visitFields = 4 + assignedUsers;
  const visits = connectionQueryCost(10, visitFields);
  const jobFields = 1 + 4 + visits;
  const jobs = connectionQueryCost(20, jobFields);
  return 2 + jobs;
}
