/**
 * Read-only Jobber task list for the MCP gateway.
 *
 * Schema (public introspection, hightreequency/jobberschema,
 * extensions.versioning.version 2025-01-20). The 2025-04-16 changelog's only
 * breaking change is JobCreateAttributes.jobFormIds ([ID!] → [EncodedId!]).
 * It does not add, remove, or retype Task or scheduledItems, so these fields
 * are the 2025-04-16 shape. This module does not introspect production and
 * does not refresh OAuth tokens.
 *
 * Listing:
 * - Query.tasks does not exist. Query.task(id) loads one task and cannot page.
 * - Client, Property, User, Request, and Account have no tasks connection.
 *   ClientCounts.tasks is an Int count only. There is no unscheduledItems
 *   field and no Query.node.
 * - Query.scheduledItems(filter: ScheduledItemsFilterAttributes!, first, after)
 *   is the only list. Task implements ScheduledItemInterface.
 *   scheduleItemType BASIC_TASK is the task type.
 * - occursWithin: DateRange! is required on every call, including a call
 *   whose schedulingAspects is UNSCHEDULED. Jobber rejects a span of 1.5
 *   years or more. Each call uses a window under that limit.
 * - Live calls showed includeUnscheduled: true plus schedulingAspects: [ALL]
 *   with status REMAINING does not return unscheduled tasks. Dated open
 *   tasks still come back from status REMAINING with includeUnscheduled
 *   false. Unscheduled tasks are therefore a separate call: schedulingAspects
 *   [UNSCHEDULED], includeUnscheduled true, and no status. isComplete is
 *   checked locally. If that call with assignedTo keeps nothing, a second
 *   call omits assignedTo and filters assignees locally. If both keep
 *   nothing, one more call sends schedulingAspects [ALL] with no status.
 * - Dated tasks are read with status REMAINING or COMPLETED and no
 *   schedulingAspects value. Several non-overlapping windows step backward
 *   from the primary window. The response covered range is the span those
 *   calls actually requested.
 * - assignedTo filters by user on Jobber's side. When assignedTo was sent
 *   and assignedUsers comes back empty, the row is kept. When assignedTo
 *   was not sent, assignees are checked locally.
 *
 * Task fields used: id, title, instructions (the description; Task has no
 * notes connection), isComplete, startAt, endAt, client { id name },
 * property { id address { street street1 street2 city province postalCode
 * country } }, assignedUsers { nodes { id name { full } } }.
 * Task has no color field and no label field. Those are returned as null
 * and are not selected.
 *
 * taskCreate, taskEdit, and taskDelete exist on Mutation. This list module
 * does not call them. taskCreate is mcp-task-create.ts. taskEdit and
 * taskDelete are not called.
 */

import {
  assertNoJobberErrors,
  jobberGraphql,
  type JobberGraphqlResult,
} from './client.ts';
import type { JobberDeps } from './quotes.ts';

export const LIST_TASKS_DEFAULT_LIMIT = 25;
export const LIST_TASKS_MAX_LIMIT = 50;
export const LIST_TASKS_PAGE_SIZE = 25;
export const LIST_TASKS_UNSCHEDULED_PAGE_SIZE = 50;
export const LIST_TASKS_MAX_PAGES = 4;
export const LIST_TASKS_WINDOW_COUNT = 4;
export const TASK_ASSIGNEE_PAGE_SIZE = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Jobber rejects occursWithin when end - start is 1.5 years or more.
 * 1.5 * 365 days, minus one day, stays under both a 365-day year and a
 * 365.25-day year, including when the past year contains Feb 29.
 */
export const TASK_LIST_MAX_RANGE_MS = Math.floor(1.5 * 365 * DAY_MS) - DAY_MS;

export function taskWindowRangeMs(window: TaskListOccursWithin): number {
  return Date.parse(window.endAt) - Date.parse(window.startAt);
}

/** Today minus 1 year through today plus 6 months, clamped under 1.5 years. */
export function taskOccursWithin(now: Date = new Date()): TaskListOccursWithin {
  const start = new Date(now.getTime());
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const end = new Date(now.getTime());
  end.setUTCMonth(end.getUTCMonth() + 6);
  const maxEnd = start.getTime() + TASK_LIST_MAX_RANGE_MS;
  if (end.getTime() > maxEnd) end.setTime(maxEnd);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

/**
 * Primary window first, then older windows of the same length stepping
 * backward. Each window stays under 1.5 years. Adjacent windows share a
 * boundary instant; listTasks dedupes by task id.
 */
export function taskOccursWindows(
  now: Date = new Date(),
  count = LIST_TASKS_WINDOW_COUNT
): TaskListOccursWithin[] {
  const primary = taskOccursWithin(now);
  const span = taskWindowRangeMs(primary);
  const windows: TaskListOccursWithin[] = [primary];
  const total = Math.max(1, Math.floor(count));
  let endMs = Date.parse(primary.startAt);
  for (let i = 1; i < total; i += 1) {
    const startMs = endMs - span;
    windows.push({
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
    });
    endMs = startMs;
  }
  return windows;
}

const READ_ONLY_TASK_QUERY = /\bmutation\b|taskCreate|taskEdit|taskDelete/i;

export const LIST_TASKS_QUERY = `
  query McpListTasks($first: Int!, $after: String, $filter: ScheduledItemsFilterAttributes!) {
    scheduledItems(first: $first, after: $after, filter: $filter) {
      nodes {
        __typename
        id
        title
        startAt
        endAt
        ... on Task {
          instructions
          isComplete
          client { id name }
          property {
            id
            address {
              street
              street1
              street2
              city
              province
              postalCode
              country
            }
          }
        }
        assignedUsers(first: ${TASK_ASSIGNEE_PAGE_SIZE}) {
          nodes { id name { full first last } }
          pageInfo { hasNextPage }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export type TaskListStatus = 'open' | 'completed';

export type TaskListQueryName = 'unscheduled' | 'unscheduled-any-assignee' | 'unscheduled-all' | 'dated';

export type TaskListOccursWithin = {
  startAt: string;
  endAt: string;
};

export type TaskListFilter = {
  scheduleItemType: 'BASIC_TASK';
  occursWithin: TaskListOccursWithin;
  includeUnscheduled: boolean;
  includeUnassigned: boolean;
  schedulingAspects?: ['UNSCHEDULED'] | ['ALL'];
  status?: 'REMAINING' | 'COMPLETED';
  assignedTo?: [string];
};

export type TaskListQueryReport = {
  name: TaskListQueryName;
  windowIndex: number | null;
  occursWithin: TaskListOccursWithin;
  includeUnscheduled: boolean;
  includeUnassigned: boolean;
  schedulingAspects: Array<'UNSCHEDULED' | 'ALL'> | null;
  status: 'REMAINING' | 'COMPLETED' | null;
  assignedTo: string[] | null;
  fetched: number;
  kept: number;
  error: string | null;
};

export type TaskListCoverage = {
  startAt: string;
  endAt: string;
  datedWindows: number;
  datedWindowsRun: number;
};

export type JobberTaskAddress = {
  street: string | null;
  street1: string | null;
  street2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
};

export type JobberTaskAssignee = {
  id: string;
  name: string | null;
};

export type JobberTaskSummary = {
  id: string;
  title: string | null;
  description: string | null;
  color: null;
  label: null;
  client: { id: string | null; name: string | null } | null;
  property: { id: string | null; address: JobberTaskAddress | null } | null;
  startAt: string | null;
  endAt: string | null;
  isComplete: boolean;
  status: TaskListStatus;
  assignees: JobberTaskAssignee[];
};

export type ListTasksInput = {
  assigneeId?: string | null;
  status?: string | null;
  limit?: number | null;
};

export type ListTasksResult = {
  tasks: JobberTaskSummary[];
  truncated: boolean;
  status: TaskListStatus;
  assigneeId: string | null;
  occursWithin: TaskListOccursWithin;
  covered: TaskListCoverage;
  queries: TaskListQueryReport[];
};

type PersonName = {
  full?: string | null;
  first?: string | null;
  last?: string | null;
};

type RawUser = {
  id?: string | null;
  name?: string | PersonName | null;
};

type RawTaskNode = {
  __typename?: string | null;
  id?: string | null;
  title?: string | null;
  instructions?: string | null;
  isComplete?: boolean | null;
  startAt?: string | null;
  endAt?: string | null;
  client?: { id?: string | null; name?: string | null } | null;
  property?: {
    id?: string | null;
    address?: {
      street?: string | null;
      street1?: string | null;
      street2?: string | null;
      city?: string | null;
      province?: string | null;
      postalCode?: string | null;
      country?: string | null;
    } | null;
  } | null;
  assignedUsers?: {
    nodes?: Array<RawUser | null> | null;
    pageInfo?: { hasNextPage?: boolean | null } | null;
  } | null;
};

type TaskConnection = {
  nodes?: Array<RawTaskNode | null> | null;
  pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
};

type AssigneeMode = 'server' | 'local' | 'none';

function graphql(
  query: string,
  variables: Record<string, unknown>,
  deps?: JobberDeps
): Promise<JobberGraphqlResult> {
  assertReadOnlyTaskQuery(query);
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

export function assertReadOnlyTaskQuery(query: string): void {
  if (READ_ONLY_TASK_QUERY.test(query)) {
    throw new Error('Task list is read-only');
  }
}

export function normalizeTaskStatus(status?: string | null): TaskListStatus {
  const value = (status ?? 'open').trim().toLowerCase();
  if (!value || value === 'open') return 'open';
  if (value === 'completed') return 'completed';
  throw new Error('status must be open or completed');
}

export function taskLimit(limit?: number | null): number {
  if (limit == null || !Number.isFinite(limit) || limit < 1) return LIST_TASKS_DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), LIST_TASKS_MAX_LIMIT);
}

export function buildDatedTaskFilter(input: {
  status: TaskListStatus;
  assigneeId?: string | null;
  occursWithin: TaskListOccursWithin;
}): TaskListFilter {
  const assigneeId = input.assigneeId?.trim() || '';
  const filter: TaskListFilter = {
    scheduleItemType: 'BASIC_TASK',
    status: input.status === 'completed' ? 'COMPLETED' : 'REMAINING',
    occursWithin: input.occursWithin,
    includeUnscheduled: false,
    includeUnassigned: !assigneeId,
  };
  if (assigneeId) filter.assignedTo = [assigneeId];
  return filter;
}

/** Unscheduled tasks. No status: REMAINING dropped them on live data. */
export function buildUnscheduledTaskFilter(input: {
  assigneeId?: string | null;
  occursWithin: TaskListOccursWithin;
  ignoreAssignee?: boolean;
}): TaskListFilter {
  const assigneeId = input.ignoreAssignee ? '' : input.assigneeId?.trim() || '';
  const filter: TaskListFilter = {
    scheduleItemType: 'BASIC_TASK',
    occursWithin: input.occursWithin,
    includeUnscheduled: true,
    schedulingAspects: ['UNSCHEDULED'],
    includeUnassigned: !assigneeId,
  };
  if (assigneeId) filter.assignedTo = [assigneeId];
  return filter;
}

/**
 * Last probe when UNSCHEDULED kept nothing. ALL previously failed live when
 * status was REMAINING, so this call omits status and omits assignedTo.
 */
export function buildUnscheduledAllFilter(input: { occursWithin: TaskListOccursWithin }): TaskListFilter {
  return {
    scheduleItemType: 'BASIC_TASK',
    occursWithin: input.occursWithin,
    includeUnscheduled: true,
    schedulingAspects: ['ALL'],
    includeUnassigned: true,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function personName(name: RawUser['name']): string | null {
  if (!name) return null;
  if (typeof name === 'string') return name || null;
  if (typeof name.full === 'string' && name.full.trim()) return name.full;
  const joined = [name.first, name.last].filter((part): part is string => Boolean(part && part.trim())).join(' ');
  return joined || null;
}

function summarizeAssignees(node: RawTaskNode): JobberTaskAssignee[] {
  const assignees: JobberTaskAssignee[] = [];
  for (const user of node.assignedUsers?.nodes ?? []) {
    if (!user?.id) continue;
    assignees.push({ id: user.id, name: personName(user.name) });
  }
  return assignees;
}

function summarizeTask(node: RawTaskNode | null | undefined): JobberTaskSummary | null {
  if (!node?.id) return null;
  if (node.__typename && node.__typename !== 'Task') return null;
  const isComplete = node.isComplete === true;
  const description = nullableString(node.instructions);
  const client = node.client
    ? { id: nullableString(node.client.id), name: nullableString(node.client.name) }
    : null;
  const property = node.property
    ? {
        id: nullableString(node.property.id),
        address: node.property.address
          ? {
              street: nullableString(node.property.address.street),
              street1: nullableString(node.property.address.street1),
              street2: nullableString(node.property.address.street2),
              city: nullableString(node.property.address.city),
              province: nullableString(node.property.address.province),
              postalCode: nullableString(node.property.address.postalCode),
              country: nullableString(node.property.address.country),
            }
          : null,
      }
    : null;
  return {
    id: node.id,
    title: nullableString(node.title),
    description: description && description.trim() ? description : null,
    color: null,
    label: null,
    client,
    property,
    startAt: nullableString(node.startAt),
    endAt: nullableString(node.endAt),
    isComplete,
    status: isComplete ? 'completed' : 'open',
    assignees: summarizeAssignees(node),
  };
}

function acceptAssignee(node: RawTaskNode, assigneeId: string | null, mode: AssigneeMode): boolean {
  if (mode === 'none' || !assigneeId) return true;
  const assignees = summarizeAssignees(node);
  const maybeBeyondPage = node.assignedUsers?.pageInfo?.hasNextPage === true;
  if (mode === 'server') {
    if (assignees.length === 0) return true;
    return assignees.some((assignee) => assignee.id === assigneeId) || maybeBeyondPage;
  }
  return assignees.some((assignee) => assignee.id === assigneeId) || maybeBeyondPage;
}

function matchesStatus(task: JobberTaskSummary, status: TaskListStatus): boolean {
  return status === 'completed' ? task.isComplete : !task.isComplete;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isHardStopError(message: string): boolean {
  return /unauthorized|unauthenticated|invalid token|HTTP 401|throttl/i.test(message);
}

function reportFor(name: TaskListQueryName, filter: TaskListFilter, windowIndex: number | null): TaskListQueryReport {
  return {
    name,
    windowIndex,
    occursWithin: filter.occursWithin,
    includeUnscheduled: filter.includeUnscheduled,
    includeUnassigned: filter.includeUnassigned,
    schedulingAspects: filter.schedulingAspects ? [...filter.schedulingAspects] : null,
    status: filter.status ?? null,
    assignedTo: filter.assignedTo ? [...filter.assignedTo] : null,
    fetched: 0,
    kept: 0,
    error: null,
  };
}

function coverageFrom(primary: TaskListOccursWithin, queries: TaskListQueryReport[], datedWindows: number): TaskListCoverage {
  const dated = queries.filter((query) => query.name === 'dated');
  const oldest = dated.length > 0 ? dated[dated.length - 1].occursWithin.startAt : primary.startAt;
  return {
    startAt: oldest,
    endAt: primary.endAt,
    datedWindows,
    datedWindowsRun: dated.length,
  };
}

export async function listTasks(input: ListTasksInput = {}, deps?: JobberDeps): Promise<ListTasksResult> {
  const status = normalizeTaskStatus(input.status);
  const limit = taskLimit(input.limit);
  const assigneeId = input.assigneeId?.trim() || null;
  const windows = taskOccursWindows();
  const primary = windows[0];
  const tasks: JobberTaskSummary[] = [];
  const seen = new Set<string>();
  const queries: TaskListQueryReport[] = [];
  let truncated = false;
  let anySuccess = false;
  let firstError: string | null = null;
  let hardStop = false;

  const runFilter = async (
    name: TaskListQueryName,
    filter: TaskListFilter,
    windowIndex: number | null,
    assigneeMode: AssigneeMode,
    pageSize: number
  ): Promise<void> => {
    const report = reportFor(name, filter, windowIndex);
    queries.push(report);
    if (hardStop || tasks.length >= limit) return;
    let after: string | null = null;
    try {
      for (let page = 0; page < LIST_TASKS_MAX_PAGES; page += 1) {
        const result = await graphql(LIST_TASKS_QUERY, { first: pageSize, after, filter }, deps);
        assertNoJobberErrors(result, 'scheduledItems');
        anySuccess = true;
        const connection = result.data?.scheduledItems as TaskConnection | undefined;
        const nodes = connection?.nodes ?? [];
        report.fetched += nodes.length;
        for (const node of nodes) {
          if (!node) continue;
          if (!acceptAssignee(node, assigneeId, assigneeMode)) continue;
          const summary = summarizeTask(node);
          if (!summary || !matchesStatus(summary, status)) continue;
          if (seen.has(summary.id)) continue;
          if (tasks.length >= limit) {
            truncated = true;
            return;
          }
          seen.add(summary.id);
          tasks.push(summary);
          report.kept += 1;
        }
        const pageInfo = connection?.pageInfo;
        const hasNext = Boolean(pageInfo?.hasNextPage && pageInfo.endCursor);
        if (tasks.length >= limit) {
          if (hasNext) truncated = true;
          return;
        }
        if (!hasNext) return;
        if (page === LIST_TASKS_MAX_PAGES - 1) {
          truncated = true;
          return;
        }
        after = pageInfo?.endCursor ?? null;
      }
    } catch (error) {
      report.error = errorMessage(error);
      if (!firstError) firstError = report.error;
      if (isHardStopError(report.error)) hardStop = true;
      truncated = true;
    }
  };

  await runFilter(
    'unscheduled',
    buildUnscheduledTaskFilter({ assigneeId, occursWithin: primary }),
    null,
    assigneeId ? 'server' : 'none',
    LIST_TASKS_UNSCHEDULED_PAGE_SIZE
  );

  const firstUnscheduled = queries[0];
  if (
    assigneeId &&
    !hardStop &&
    tasks.length < limit &&
    firstUnscheduled &&
    (firstUnscheduled.error || firstUnscheduled.kept === 0)
  ) {
    await runFilter(
      'unscheduled-any-assignee',
      buildUnscheduledTaskFilter({ assigneeId, occursWithin: primary, ignoreAssignee: true }),
      null,
      'local',
      LIST_TASKS_UNSCHEDULED_PAGE_SIZE
    );
  }

  const unscheduledKept = queries
    .filter((query) => query.name === 'unscheduled' || query.name === 'unscheduled-any-assignee')
    .reduce((sum, query) => sum + query.kept, 0);
  if (unscheduledKept === 0 && !hardStop && tasks.length < limit) {
    await runFilter(
      'unscheduled-all',
      buildUnscheduledAllFilter({ occursWithin: primary }),
      null,
      assigneeId ? 'local' : 'none',
      LIST_TASKS_UNSCHEDULED_PAGE_SIZE
    );
  }

  let datedWindowsRun = 0;
  for (let index = 0; index < windows.length && tasks.length < limit && !hardStop; index += 1) {
    datedWindowsRun += 1;
    await runFilter(
      'dated',
      buildDatedTaskFilter({ status, assigneeId, occursWithin: windows[index] }),
      index,
      assigneeId ? 'server' : 'none',
      LIST_TASKS_PAGE_SIZE
    );
  }
  if (datedWindowsRun < windows.length) truncated = true;

  if (!anySuccess) {
    throw new Error(firstError || 'scheduledItems failed');
  }

  return {
    tasks: tasks.slice(0, limit),
    truncated,
    status,
    assigneeId,
    occursWithin: primary,
    covered: coverageFrom(primary, queries, windows.length),
    queries,
  };
}
