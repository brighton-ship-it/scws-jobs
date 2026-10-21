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
 * - Query.scheduledItems(filter: ScheduledItemsFilterAttributes!, first, after)
 *   returns ScheduledItemInterfaceConnection. Task implements that interface.
 *   scheduleItemType BASIC_TASK is the task type (VISIT, EVENT, ASSESSMENT
 *   are the others).
 * - occursWithin: DateRange! { startAt, endAt } is required. The window below
 *   is that required argument, not a business filter. includeUnscheduled is
 *   sent true so tasks with no start/end are not dropped.
 * - assignedTo: [EncodedId!] filters by user on Jobber's side. Results are
 *   checked again after the fetch.
 * - status: ScheduledItemStatus is ACTIVE, COMPLETED, OVERDUE, or REMAINING.
 *   open (default) sends REMAINING. completed sends COMPLETED. isComplete is
 *   checked again after the fetch.
 *
 * Task fields used: id, title, instructions (the description; Task has no
 * notes connection), isComplete, startAt, endAt, client { id name },
 * property { id address { street street1 street2 city province postalCode
 * country } }, assignedUsers { nodes { id name { full } } }.
 * Task has no color field and no label field. Those are returned as null
 * and are not selected.
 *
 * taskCreate, taskEdit, and taskDelete exist on Mutation and are not called.
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
export const LIST_TASKS_MAX_PAGES = 4;
export const TASK_ASSIGNEE_PAGE_SIZE = 10;

/**
 * ScheduledItemsFilterAttributes.occursWithin is non-null. This span is only
 * there to satisfy that argument. includeUnscheduled covers undated tasks.
 */
export const TASK_LIST_OCCURS_WITHIN = {
  startAt: '2000-01-01T00:00:00Z',
  endAt: '2100-01-01T00:00:00Z',
} as const;

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

export type TaskListOccursWithin = {
  startAt: string;
  endAt: string;
};

export type TaskListFilter = {
  scheduleItemType: 'BASIC_TASK';
  status: 'REMAINING' | 'COMPLETED';
  occursWithin: TaskListOccursWithin;
  includeUnscheduled: true;
  includeUnassigned: boolean;
  assignedTo?: [string];
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

export function buildTaskListFilter(input: {
  status: TaskListStatus;
  assigneeId?: string | null;
  occursWithin?: TaskListOccursWithin;
}): TaskListFilter {
  const assigneeId = input.assigneeId?.trim() || '';
  const filter: TaskListFilter = {
    scheduleItemType: 'BASIC_TASK',
    status: input.status === 'completed' ? 'COMPLETED' : 'REMAINING',
    occursWithin: input.occursWithin ?? TASK_LIST_OCCURS_WITHIN,
    includeUnscheduled: true,
    includeUnassigned: !assigneeId,
  };
  if (assigneeId) filter.assignedTo = [assigneeId];
  return filter;
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

function matchesAssignee(node: RawTaskNode, assigneeId: string | null): boolean {
  if (!assigneeId) return true;
  const assignees = summarizeAssignees(node);
  if (assignees.some((assignee) => assignee.id === assigneeId)) return true;
  return node.assignedUsers?.pageInfo?.hasNextPage === true;
}

function matchesStatus(task: JobberTaskSummary, status: TaskListStatus): boolean {
  return status === 'completed' ? task.isComplete : !task.isComplete;
}

export async function listTasks(input: ListTasksInput = {}, deps?: JobberDeps): Promise<ListTasksResult> {
  const status = normalizeTaskStatus(input.status);
  const limit = taskLimit(input.limit);
  const assigneeId = input.assigneeId?.trim() || null;
  const filter = buildTaskListFilter({ status, assigneeId });
  const tasks: JobberTaskSummary[] = [];
  let after: string | null = null;
  let truncated = false;

  for (let page = 0; page < LIST_TASKS_MAX_PAGES; page += 1) {
    const result = await graphql(
      LIST_TASKS_QUERY,
      { first: LIST_TASKS_PAGE_SIZE, after, filter },
      deps
    );
    assertNoJobberErrors(result, 'scheduledItems');
    const connection = result.data?.scheduledItems as TaskConnection | undefined;
    const nodes = connection?.nodes ?? [];
    let consumed = 0;
    for (const node of nodes) {
      consumed += 1;
      if (!node || !matchesAssignee(node, assigneeId)) continue;
      const summary = summarizeTask(node);
      if (!summary || !matchesStatus(summary, status)) continue;
      tasks.push(summary);
      if (tasks.length >= limit) break;
    }
    const pageInfo = connection?.pageInfo;
    const hasNext = Boolean(pageInfo?.hasNextPage && pageInfo.endCursor);
    if (tasks.length >= limit) {
      truncated = consumed < nodes.length || hasNext;
      break;
    }
    if (!hasNext) {
      truncated = false;
      break;
    }
    after = pageInfo?.endCursor ?? null;
    if (page === LIST_TASKS_MAX_PAGES - 1) truncated = true;
  }

  return {
    tasks: tasks.slice(0, limit),
    truncated,
    status,
    assigneeId,
    occursWithin: filter.occursWithin,
  };
}
