/**
 * Read-only Jobber task lookups for the MCP gateway.
 * Same GraphQL client and version header as jobs (2025-04-16 via client.ts).
 *
 * Query.tasks + TaskFilterAttributes (isComplete, assignedTo).
 * No create, update, complete, or delete mutations live here.
 */

import {
  assertNoJobberErrors,
  jobberGraphql,
  type JobberGraphqlResult,
} from './client.ts';
import type { JobberDeps } from './quotes.ts';

export const MCP_TASK_PAGE_SIZE = 50;
export const MCP_TASK_MAX_PAGE_SIZE = 100;
export const MCP_TASK_MAX_SCAN_PAGES = 4;
export const MCP_TASK_INSTRUCTION_LIMIT = 400;
export const MCP_TASK_DETAIL_INSTRUCTION_LIMIT = 2000;
export const MCP_TASK_ASSIGNED_LIMIT = 10;

const READ_ONLY_TASK_QUERY =
  /\bmutation\b|taskCreate|taskEdit|taskComplete|taskDelete|taskClose|tasksCreate|tasksEdit/i;

export type JobberTaskAddress = {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
};

export type JobberTaskUser = {
  id?: string | null;
  name?: unknown;
};

export type JobberTaskUserConnection = {
  nodes?: Array<JobberTaskUser | null> | null;
  edges?: Array<{ node?: JobberTaskUser | null } | null> | null;
};

export type JobberTaskDetail = {
  id: string;
  title?: string | null;
  instructions?: string | null;
  isComplete?: boolean | null;
  startAt?: string | null;
  createdAt?: string | null;
  jobberWebUri?: string | null;
  assignedUsers?: JobberTaskUserConnection | null;
  client?: { id?: string | null; name?: string | null } | null;
  property?: { id?: string | null; address?: JobberTaskAddress | null } | null;
};

export type JobberTaskSummary = {
  id: string;
  title: string | null;
  instructions: string | null;
  isComplete: boolean;
  startAt: string | null;
  createdAt: string | null;
  assignedUsers: Array<{ id: string | null; name: string | null }>;
  client: { id: string | null; name: string | null } | null;
  property: { id: string | null; address: string | null } | null;
  jobberWebUri: string | null;
};

export type JobberTaskPageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

export type SearchTasksInput = {
  assignee?: string | null;
  incompleteOnly?: boolean;
  query?: string | null;
  first?: number;
};

export type SearchTasksResult = {
  tasks: JobberTaskSummary[];
  pageInfo: JobberTaskPageInfo;
  note?: string;
};

type QueryShape = {
  nodes: boolean;
  nameObject: boolean;
  nameSettled: boolean;
  jobberWebUri: boolean;
  createdAt: boolean;
  property: boolean;
};

type TaskFilterState = {
  useFilter: boolean;
  sendIsComplete: boolean;
  sendAssignedTo: boolean;
  assignedToList: boolean;
  assignedToCardinalitySettled: boolean;
  assignedToIds: string[];
  incompleteOnly: boolean;
};

function graphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  assertReadOnlyTaskQuery(query);
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

export function assertReadOnlyTaskQuery(query: string): void {
  if (READ_ONLY_TASK_QUERY.test(query)) {
    throw new Error('Task tools are read-only');
  }
}

function errorText(result: JobberGraphqlResult): string {
  return (result.errors || []).map((error) => error.message || '').join(' ');
}

export function taskPageSize(first?: number): number {
  const n = first ?? MCP_TASK_PAGE_SIZE;
  if (!Number.isFinite(n) || n < 1) return MCP_TASK_PAGE_SIZE;
  return Math.min(Math.floor(n), MCP_TASK_MAX_PAGE_SIZE);
}

export function looksLikeEncodedUserId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /^\d+$/.test(trimmed) || /\s/.test(trimmed)) return false;
  return /^[A-Za-z0-9+/_=-]{12,}$/.test(trimmed);
}

export function displayUserName(name: unknown): string | null {
  if (typeof name === 'string') {
    const trimmed = name.trim();
    return trimmed || null;
  }
  if (!name || typeof name !== 'object') return null;
  const record = name as { full?: unknown; first?: unknown; last?: unknown };
  if (typeof record.full === 'string' && record.full.trim()) return record.full.trim();
  const parts = [record.first, record.last].filter(
    (part): part is string => typeof part === 'string' && Boolean(part.trim())
  );
  const joined = parts.map((part) => part.trim()).join(' ');
  return joined || null;
}

export function truncateInstructions(
  value: string | null | undefined,
  limit = MCP_TASK_INSTRUCTION_LIMIT
): string | null {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

export function formatPropertyAddress(address: JobberTaskAddress | null | undefined): string | null {
  if (!address) return null;
  const street = [address.street1, address.street2]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ');
  const region = [address.province, address.postalCode]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ');
  const locality = [address.city?.trim(), region].filter((part): part is string => Boolean(part)).join(', ');
  const formatted = [street, locality].filter(Boolean).join(', ');
  return formatted || null;
}

function mentionsField(message: string, field: string): boolean {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`['"]${escaped}['"]`, 'i').test(message);
}

function initialShape(): QueryShape {
  return {
    nodes: true,
    nameObject: true,
    nameSettled: false,
    jobberWebUri: true,
    createdAt: true,
    property: true,
  };
}

function filterState(input: { incompleteOnly: boolean; assignedToIds: string[] }): TaskFilterState {
  return {
    useFilter: true,
    sendIsComplete: input.incompleteOnly,
    sendAssignedTo: input.assignedToIds.length > 0,
    assignedToList: true,
    assignedToCardinalitySettled: false,
    assignedToIds: input.assignedToIds,
    incompleteOnly: input.incompleteOnly,
  };
}

function taskFilterPayload(filter: TaskFilterState): Record<string, unknown> | null {
  if (!filter.useFilter) return null;
  const payload: Record<string, unknown> = {};
  if (filter.sendIsComplete && filter.incompleteOnly) payload.isComplete = false;
  if (filter.sendAssignedTo && filter.assignedToIds.length) {
    if (filter.assignedToList) payload.assignedTo = [...filter.assignedToIds];
    else if (filter.assignedToIds.length === 1) payload.assignedTo = filter.assignedToIds[0];
  }
  return Object.keys(payload).length ? payload : null;
}

function applySchemaFallback(message: string, shape: QueryShape, filter: TaskFilterState): boolean {
  let changed = false;

  if (
    !shape.nameSettled &&
    shape.nameObject &&
    /name/i.test(message) &&
    /must not have a selection|subselection not allowed/i.test(message)
  ) {
    shape.nameObject = false;
    shape.nameSettled = true;
    changed = true;
  } else if (
    !shape.nameSettled &&
    !shape.nameObject &&
    mentionsField(message, 'name') &&
    /must have a selection/i.test(message)
  ) {
    shape.nameObject = true;
    shape.nameSettled = true;
    changed = true;
  }

  if (shape.nodes && mentionsField(message, 'nodes') && /TaskConnection/i.test(message)) {
    shape.nodes = false;
    changed = true;
  }
  if (shape.jobberWebUri && mentionsField(message, 'jobberWebUri')) {
    shape.jobberWebUri = false;
    changed = true;
  }
  if (shape.createdAt && mentionsField(message, 'createdAt') && /field|exist|defined|Task/i.test(message)) {
    shape.createdAt = false;
    changed = true;
  }
  if (shape.property && mentionsField(message, 'property') && /field|exist|defined|Task/i.test(message)) {
    shape.property = false;
    changed = true;
  }

  if (!filter.assignedToCardinalitySettled && filter.sendAssignedTo && /assignedTo/i.test(message)) {
    if (filter.assignedToList && /Expected type ['"]EncodedId!?['"]/i.test(message)) {
      filter.assignedToList = false;
      filter.assignedToCardinalitySettled = true;
      if (filter.assignedToIds.length !== 1) filter.sendAssignedTo = false;
      changed = true;
    } else if (!filter.assignedToList && /\[EncodedId!?\]/i.test(message)) {
      filter.assignedToList = true;
      filter.assignedToCardinalitySettled = true;
      changed = true;
    }
  } else if (
    filter.sendAssignedTo &&
    mentionsField(message, 'assignedTo') &&
    /argument|unknown|defined|doesn't exist|not defined|TaskFilter/i.test(message)
  ) {
    filter.sendAssignedTo = false;
    changed = true;
  }

  if (
    filter.sendIsComplete &&
    mentionsField(message, 'isComplete') &&
    /argument|unknown|defined|doesn't exist|not defined|TaskFilter|Input/i.test(message)
  ) {
    filter.sendIsComplete = false;
    changed = true;
  }

  if (
    filter.useFilter &&
    /unknown type ['"]TaskFilterAttributes['"]|TaskFilterAttributes['"]? doesn't exist|argument ['"]filter['"]/i.test(
      message
    )
  ) {
    filter.useFilter = false;
    filter.sendIsComplete = false;
    filter.sendAssignedTo = false;
    changed = true;
  }

  return changed;
}

function userNameSelection(shape: QueryShape): string {
  return shape.nameObject ? 'name { full }' : 'name';
}

function taskNodeFields(shape: QueryShape): string {
  return `
    id
    title
    instructions
    isComplete
    startAt
    ${shape.createdAt ? 'createdAt' : ''}
    ${shape.jobberWebUri ? 'jobberWebUri' : ''}
    assignedUsers(first: ${MCP_TASK_ASSIGNED_LIMIT}) {
      nodes { id ${userNameSelection(shape)} }
    }
    client { id name }
    ${
      shape.property
        ? 'property { id address { street1 street2 city province postalCode } }'
        : ''
    }`;
}

function tasksConnectionSelection(shape: QueryShape): string {
  const fields = taskNodeFields(shape);
  if (shape.nodes) return `nodes { ${fields} }`;
  return `edges { cursor node { ${fields} } }`;
}

function tasksQuery(shape: QueryShape, filter: TaskFilterState): string {
  const useFilter = Boolean(taskFilterPayload(filter));
  const filterDecl = useFilter ? ', $filter: TaskFilterAttributes' : '';
  const filterArg = useFilter ? ', filter: $filter' : '';
  return `
    query McpTasks($first: Int!, $after: String${filterDecl}) {
      tasks(first: $first, after: $after${filterArg}) {
        ${tasksConnectionSelection(shape)}
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
}

function taskByIdQuery(shape: QueryShape): string {
  return `
    query McpTaskById($id: EncodedId!) {
      task(id: $id) { ${taskNodeFields(shape)} }
    }
  `;
}

function usersQuery(shape: QueryShape): string {
  return `
    query McpTaskUsers {
      users(first: 50) {
        nodes { id ${userNameSelection(shape)} }
      }
    }
  `;
}

async function queryWithFallback(
  build: (shape: QueryShape, filter: TaskFilterState) => string,
  variablesFor: (shape: QueryShape, filter: TaskFilterState) => Record<string, unknown>,
  shape: QueryShape,
  filter: TaskFilterState,
  deps: JobberDeps | undefined,
  operation: string
): Promise<JobberGraphqlResult> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await graphql(build(shape, filter), variablesFor(shape, filter), deps);
    if (!result.errors?.length) return result;
    const changed = applySchemaFallback(errorText(result), shape, filter);
    if (!changed) assertNoJobberErrors(result, operation);
  }
  throw new Error(`Jobber ${operation} query failed`);
}

function readAssigned(connection: JobberTaskUserConnection | null | undefined): JobberTaskUser[] {
  if (Array.isArray(connection?.nodes)) {
    return connection.nodes.filter((node): node is JobberTaskUser => Boolean(node));
  }
  if (Array.isArray(connection?.edges)) {
    return connection.edges
      .map((edge) => edge?.node)
      .filter((node): node is JobberTaskUser => Boolean(node));
  }
  return [];
}

function readTasks(connection: {
  nodes?: Array<JobberTaskDetail | null> | null;
  edges?: Array<{ node?: JobberTaskDetail | null } | null> | null;
  pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
} | null | undefined): { tasks: JobberTaskDetail[]; pageInfo: JobberTaskPageInfo } {
  const pageInfo: JobberTaskPageInfo = {
    hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
    endCursor: connection?.pageInfo?.endCursor ?? null,
  };
  const fromEdges = Array.isArray(connection?.edges)
    ? connection.edges.map((edge) => edge?.node)
    : [];
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes : fromEdges;
  return {
    pageInfo,
    tasks: nodes.filter((node): node is JobberTaskDetail => Boolean(node?.id)),
  };
}

function readUsers(data: { users?: { nodes?: Array<{ id?: string | null; name?: unknown } | null> | null } | null } | undefined) {
  const nodes = Array.isArray(data?.users?.nodes) ? data.users.nodes : [];
  return nodes
    .map((node) => ({
      id: typeof node?.id === 'string' ? node.id : '',
      name: displayUserName(node?.name) || '',
    }))
    .filter((user) => user.id);
}

export function summarizeTask(
  task: JobberTaskDetail,
  instructionLimit = MCP_TASK_INSTRUCTION_LIMIT
): JobberTaskSummary {
  const assignedUsers = readAssigned(task.assignedUsers)
    .map((user) => ({
      id: user.id?.trim() || null,
      name: displayUserName(user.name),
    }))
    .filter((user) => user.id || user.name);
  const address = formatPropertyAddress(task.property?.address);
  const client =
    task.client && (task.client.id || task.client.name)
      ? { id: task.client.id ?? null, name: task.client.name?.trim() || null }
      : null;
  const property =
    task.property?.id || address ? { id: task.property?.id ?? null, address } : null;
  return {
    id: task.id,
    title: task.title?.trim() || null,
    instructions: truncateInstructions(task.instructions, instructionLimit),
    isComplete: task.isComplete === true,
    startAt: task.startAt ?? null,
    createdAt: task.createdAt ?? null,
    assignedUsers,
    client,
    property,
    jobberWebUri: task.jobberWebUri ?? null,
  };
}

function taskMatches(
  task: JobberTaskDetail,
  input: {
    incompleteOnly: boolean;
    query: string;
    assigneeIds: string[];
    assigneeName: string | null;
    assigneeFilteredOnServer: boolean;
  }
): boolean {
  if (input.incompleteOnly && task.isComplete === true) return false;
  if (input.assigneeIds.length) {
    const users = readAssigned(task.assignedUsers);
    // When Jobber already filtered assignedTo and the user connection is absent,
    // keep the row. When users are present, still require an id match.
    if (users.length || !input.assigneeFilteredOnServer) {
      const ids = new Set(input.assigneeIds);
      if (!users.some((user) => user.id && ids.has(user.id))) return false;
    }
  } else if (input.assigneeName) {
    const needle = input.assigneeName.toLowerCase();
    const users = readAssigned(task.assignedUsers);
    const hit = users.some((user) => {
      const name = displayUserName(user.name)?.toLowerCase() || '';
      const id = (user.id || '').toLowerCase();
      return name.includes(needle) || id.includes(needle);
    });
    if (!hit) return false;
  }
  if (input.query) {
    const hay = `${task.title || ''} ${task.instructions || ''}`.toLowerCase();
    if (!hay.includes(input.query.toLowerCase())) return false;
  }
  return true;
}

async function resolveAssignee(
  assignee: string,
  shape: QueryShape,
  deps?: JobberDeps
): Promise<{ ids: string[]; nameFallback: string | null }> {
  if (!assignee) return { ids: [], nameFallback: null };
  if (looksLikeEncodedUserId(assignee)) return { ids: [assignee], nameFallback: null };
  try {
    const result = await queryWithFallback(
      (current) => usersQuery(current),
      () => ({}),
      shape,
      filterState({ incompleteOnly: false, assignedToIds: [] }),
      deps,
      'users'
    );
    const needle = assignee.toLowerCase();
    const ids = readUsers(result.data)
      .filter((user) => user.name.toLowerCase().includes(needle) || user.id.toLowerCase() === needle)
      .map((user) => user.id);
    if (ids.length) return { ids, nameFallback: null };
  } catch {
    // Name fragment still filters the tasks that come back.
  }
  return { ids: [], nameFallback: assignee };
}

function taskVariables(filter: TaskFilterState, first: number, after: string | null): Record<string, unknown> {
  const variables: Record<string, unknown> = { first, after };
  const payload = taskFilterPayload(filter);
  if (payload) variables.filter = payload;
  return variables;
}

export async function searchTasks(input: SearchTasksInput, deps?: JobberDeps): Promise<SearchTasksResult> {
  const want = taskPageSize(input.first);
  const incompleteOnly = input.incompleteOnly !== false;
  const query = input.query?.trim() || '';
  const assignee = input.assignee?.trim() || '';
  const shape = initialShape();
  const resolved = await resolveAssignee(assignee, shape, deps);
  const filter = filterState({ incompleteOnly, assignedToIds: resolved.ids });
  let broaden = Boolean(query || resolved.nameFallback);
  const collected: JobberTaskDetail[] = [];
  let after: string | null = null;
  let hasNextPage = false;
  let endCursor: string | null = null;
  let note: string | undefined;

  for (let page = 0; page < MCP_TASK_MAX_SCAN_PAGES && collected.length < want; page++) {
    const pageSize = broaden ? MCP_TASK_MAX_PAGE_SIZE : want;
    const result = await queryWithFallback(
      (current, currentFilter) => tasksQuery(current, currentFilter),
      (_current, currentFilter) => taskVariables(currentFilter, pageSize, after),
      shape,
      filter,
      deps,
      'tasks'
    );
    const payload = taskFilterPayload(filter);
    if (
      query ||
      resolved.nameFallback ||
      (incompleteOnly && payload?.isComplete !== false) ||
      (resolved.ids.length > 0 && !payload?.assignedTo)
    ) {
      broaden = true;
    }
    const parsed = readTasks(result.data?.tasks);
    const assigneeFilteredOnServer = Boolean(payload?.assignedTo);
    let consumed = 0;
    for (const task of parsed.tasks) {
      consumed += 1;
      if (
        !taskMatches(task, {
          incompleteOnly,
          query,
          assigneeIds: resolved.ids,
          assigneeName: resolved.nameFallback,
          assigneeFilteredOnServer,
        })
      ) {
        continue;
      }
      collected.push(task);
      if (collected.length >= want) break;
    }
    const moreOnPage = consumed < parsed.tasks.length && collected.length >= want;
    hasNextPage = moreOnPage || parsed.pageInfo.hasNextPage;
    endCursor = parsed.pageInfo.endCursor;
    if (collected.length >= want || !parsed.pageInfo.hasNextPage || !parsed.pageInfo.endCursor) break;
    after = parsed.pageInfo.endCursor;
    if (page + 1 >= MCP_TASK_MAX_SCAN_PAGES && parsed.pageInfo.hasNextPage) {
      note = 'Search stopped after a bounded scan. Narrow assignee or query to see the rest.';
    }
  }

  if (hasNextPage && !note) {
    note = 'More tasks matched than first. Raise first (max 100) to see a larger page.';
  }
  if (!shape.jobberWebUri) {
    note = [note, 'Jobber did not return jobberWebUri on tasks.'].filter(Boolean).join(' ');
  }
  if (resolved.nameFallback && !taskFilterPayload(filter)?.assignedTo) {
    note = [
      note,
      'Assignee was matched on task user names because no Jobber user id was resolved.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  return {
    tasks: collected.slice(0, want).map((task) => summarizeTask(task)),
    pageInfo: { hasNextPage, endCursor },
    note,
  };
}

export async function getTask(
  input: { taskId?: string | null },
  deps?: JobberDeps
): Promise<JobberTaskSummary> {
  const taskId = input.taskId?.trim() || '';
  if (!taskId) throw new Error('taskId is required');
  const shape = initialShape();
  const filter = filterState({ incompleteOnly: false, assignedToIds: [] });
  const result = await queryWithFallback(
    (current) => taskByIdQuery(current),
    () => ({ id: taskId }),
    shape,
    filter,
    deps,
    'task'
  );
  const task = result.data?.task as JobberTaskDetail | undefined;
  if (!task?.id) throw new Error(`Jobber task ${taskId} not found`);
  return summarizeTask(task, MCP_TASK_DETAIL_INSTRUCTION_LIMIT);
}
