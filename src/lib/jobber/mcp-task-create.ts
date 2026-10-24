/**
 * Create one Jobber task for the MCP gateway.
 *
 * Schema (public introspection, hightreequency/jobberschema jobberapischema.json,
 * extensions.versioning.version 2025-01-20). The 2025-04-16 changelog's only
 * breaking change is JobCreateAttributes.jobFormIds. It does not change
 * taskCreate or Task. The gateway still sends X-JOBBER-GRAPHQL-VERSION
 * 2025-04-16.
 *
 * Mutation.taskCreate(clientId: EncodedId, propertyId: EncodedId, input: TaskCreateInput!)
 * returns { task, userErrors }. TaskCreateInput fields this module sends:
 * title, instructions, startAt, endAt, allDay, assignedTo, emailAssignments.
 * startAt and endAt are ISO8601DateTime, not LocalDateTimeAttributes. Tool
 * arguments use the same America/Los_Angeles wall-time convention as
 * create_visit / create_request, then this module converts them to an offset
 * ISO string. emailAssignments is forced false. teamReminderOffset and
 * recurrenceRule are omitted.
 *
 * Query.task(id) re-reads the created task. taskEdit and taskDelete are not
 * called. list_tasks stays on the read-only scheduledItems query.
 *
 * Nothing here emails, texts, or notifies the customer.
 */
import {
  assertNoJobberErrors,
  jobberGraphql,
  type JobberGraphqlResult,
} from './client.ts';
import { assertNoClientNotification, assertWriteDoesNotDeliver } from './mcp-notify.ts';
import { assertEndAfterStart, shopWallTimeToIso8601, toShopLocalDateTime } from './mcp-schedule.ts';
import type { JobberDeps } from './quotes.ts';

const TASK_FIELDS = `
  id
  title
  instructions
  startAt
  endAt
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
  assignedUsers(first: 10) {
    nodes { id name { full first last } }
  }
`;

export const TASK_CREATE_MUTATION = `
  mutation McpTaskCreate($input: TaskCreateInput!, $clientId: EncodedId, $propertyId: EncodedId) {
    taskCreate(clientId: $clientId, propertyId: $propertyId, input: $input) {
      task { ${TASK_FIELDS} }
      userErrors { message path }
    }
  }
`;

export const TASK_BY_ID_QUERY = `
  query McpTaskById($id: EncodedId!) {
    task(id: $id) { ${TASK_FIELDS} }
  }
`;

const ARG_KEYS = new Set([
  'title',
  'instructions',
  'description',
  'assigneeIds',
  'clientId',
  'propertyId',
  'startAt',
  'endAt',
  'start',
  'end',
  'dryRun',
]);

export type TaskCreateAttributes = {
  title: string;
  instructions?: string;
  startAt?: string;
  endAt?: string;
  allDay?: false;
  assignedTo: string[];
  emailAssignments: false;
};

export type TaskCreateVariables = {
  input: TaskCreateAttributes;
  clientId?: string;
  propertyId?: string;
};

export type CreateTaskInput = {
  title: string;
  instructions: string | null;
  assigneeIds: string[];
  clientId: string | null;
  propertyId: string | null;
  startAt: string | null;
  endAt: string | null;
  dryRun: boolean;
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

export type CreatedTaskAssignee = {
  id: string;
  name: string | null;
};

export type CreatedTask = {
  id: string;
  title: string | null;
  instructions: string | null;
  assignees: CreatedTaskAssignee[];
  client: { id: string | null; name: string | null } | null;
  property: { id: string | null; address: JobberTaskAddress | null } | null;
  startAt: string | null;
  endAt: string | null;
};

export type TaskUserError = {
  message: string;
  path: string[];
};

export type TaskCreateAuditEntry = {
  tool: 'create_task';
  actor: string;
  dryRun: boolean;
  ok: boolean;
  refused: false;
  force: false;
  reason: string;
  jobId: null;
  jobNumber: null;
  visitId: null;
  before: unknown;
  after: unknown;
  error?: string;
  at: string;
  notified: false;
  emailAssignments: false;
};

export type TaskCreateAuditResult = { console: boolean; supabase: boolean };

export type TaskCreateAuditSink = (entry: TaskCreateAuditEntry) => Promise<TaskCreateAuditResult> | TaskCreateAuditResult;

type CreateTaskBase = {
  notified: false;
  emailAssignments: false;
  mutation: 'taskCreate';
  audit: TaskCreateAuditResult;
};

export type CreateTaskResult =
  | (CreateTaskBase & {
      status: 'would_create';
      dryRun: true;
      would_create: {
        parsed: CreateTaskInput;
        mutation: 'taskCreate';
        variables: TaskCreateVariables;
      };
    })
  | (CreateTaskBase & {
      status: 'created';
      dryRun: false;
      id: string;
      title: string | null;
      instructions: string | null;
      assignees: CreatedTaskAssignee[];
      client: CreatedTask['client'];
      property: CreatedTask['property'];
      startAt: string | null;
      endAt: string | null;
      userErrors: [];
      readError: string | null;
    })
  | (CreateTaskBase & {
      status: 'failed';
      dryRun: false;
      id: string | null;
      userErrors: TaskUserError[];
      task: null;
    });

type PersonName = {
  full?: string | null;
  first?: string | null;
  last?: string | null;
};

type RawTask = {
  id?: string | null;
  title?: string | null;
  instructions?: string | null;
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
    nodes?: Array<{ id?: string | null; name?: string | PersonName | null } | null> | null;
  } | null;
};

function graphql(
  query: string,
  variables: Record<string, unknown>,
  deps?: JobberDeps
): Promise<JobberGraphqlResult> {
  if (/\btaskEdit\b|\btaskDelete\b/i.test(query)) {
    throw new Error('create_task only calls taskCreate');
  }
  assertWriteDoesNotDeliver(query);
  assertNoClientNotification(variables);
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function personName(name: { id?: string | null; name?: string | PersonName | null }['name']): string | null {
  if (!name) return null;
  if (typeof name === 'string') return name || null;
  if (typeof name.full === 'string' && name.full.trim()) return name.full;
  const joined = [name.first, name.last].filter((part): part is string => Boolean(part && part.trim())).join(' ');
  return joined || null;
}

export function summarizeCreatedTask(node: unknown): CreatedTask | null {
  if (!node || typeof node !== 'object') return null;
  const raw = node as RawTask;
  if (!raw.id) return null;
  const address = raw.property?.address;
  return {
    id: raw.id,
    title: nullableString(raw.title),
    instructions: nullableString(raw.instructions),
    assignees: (raw.assignedUsers?.nodes ?? [])
      .filter((user): user is NonNullable<typeof user> => Boolean(user?.id))
      .map((user) => ({ id: user.id as string, name: personName(user.name) })),
    client: raw.client ? { id: nullableString(raw.client.id), name: nullableString(raw.client.name) } : null,
    property: raw.property
      ? {
          id: nullableString(raw.property.id),
          address: address
            ? {
                street: nullableString(address.street),
                street1: nullableString(address.street1),
                street2: nullableString(address.street2),
                city: nullableString(address.city),
                province: nullableString(address.province),
                postalCode: nullableString(address.postalCode),
                country: nullableString(address.country),
              }
            : null,
        }
      : null,
    startAt: nullableString(raw.startAt),
    endAt: nullableString(raw.endAt),
  };
}

function readOptionalString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  return trimmed || null;
}

function aliasedString(args: Record<string, unknown>, primary: string, alias: string): string | null {
  const primaryValue = primary in args && args[primary] != null ? readOptionalString(args[primary], primary) : null;
  const aliasValue = alias in args && args[alias] != null ? readOptionalString(args[alias], alias) : null;
  if (primaryValue && aliasValue && primaryValue !== aliasValue) {
    throw new Error(`${primary} and ${alias} must be the same value when both are set`);
  }
  return primaryValue || aliasValue;
}

function optionalId(args: Record<string, unknown>, field: string): string | null {
  if (!(field in args) || args[field] == null) return null;
  if (typeof args[field] !== 'string' || !String(args[field]).trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return String(args[field]).trim();
}

export function parseCreateTaskArgs(args: Record<string, unknown>): CreateTaskInput {
  const extra = Object.keys(args).filter((key) => !ARG_KEYS.has(key));
  if (extra.length) throw new Error(`create_task does not accept ${extra.join(', ')}.`);
  if (typeof args.title !== 'string' || !args.title.trim()) throw new Error('title is required');
  if (!Array.isArray(args.assigneeIds) || args.assigneeIds.length === 0) {
    throw new Error('assigneeIds must be a non-empty array of user ids from list_users');
  }
  const assigneeIds = args.assigneeIds.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error(`assigneeIds[${index}] must be a user id`);
    return item.trim();
  });
  if ('dryRun' in args && args.dryRun != null && typeof args.dryRun !== 'boolean') {
    throw new Error('dryRun must be a boolean');
  }
  const startAt = aliasedString(args, 'startAt', 'start');
  const endAt = aliasedString(args, 'endAt', 'end');
  if (Boolean(startAt) !== Boolean(endAt)) {
    throw new Error('startAt and endAt are both required to schedule a task. start and end are aliases.');
  }
  return {
    title: args.title.trim(),
    instructions: aliasedString(args, 'instructions', 'description'),
    assigneeIds,
    clientId: optionalId(args, 'clientId'),
    propertyId: optionalId(args, 'propertyId'),
    startAt,
    endAt,
    dryRun: args.dryRun !== false,
  };
}

export function buildTaskCreateVariables(input: CreateTaskInput): TaskCreateVariables {
  const title = input.title.trim();
  if (!title) throw new Error('title is required');
  const assignedTo = (input.assigneeIds || []).map((id) => id.trim()).filter(Boolean);
  if (!assignedTo.length) throw new Error('assigneeIds must include at least one user id');
  const startRaw = input.startAt?.trim() || '';
  const endRaw = input.endAt?.trim() || '';
  if (Boolean(startRaw) !== Boolean(endRaw)) {
    throw new Error('startAt and endAt are both required to schedule a task');
  }
  const taskInput: TaskCreateAttributes = {
    title,
    assignedTo,
    emailAssignments: false,
  };
  const instructions = input.instructions?.trim();
  if (instructions) taskInput.instructions = instructions;
  if (startRaw) {
    const start = toShopLocalDateTime(startRaw, 'startAt');
    const end = toShopLocalDateTime(endRaw, 'endAt');
    assertEndAfterStart(start, end);
    taskInput.startAt = shopWallTimeToIso8601(start);
    taskInput.endAt = shopWallTimeToIso8601(end);
    taskInput.allDay = false;
  }
  const variables: TaskCreateVariables = { input: taskInput };
  const clientId = input.clientId?.trim();
  const propertyId = input.propertyId?.trim();
  if (clientId) variables.clientId = clientId;
  if (propertyId) variables.propertyId = propertyId;
  assertNoClientNotification(variables);
  if ('teamReminderOffset' in taskInput || 'recurrenceRule' in taskInput) {
    throw new Error('create_task does not set a reminder or a recurrence');
  }
  if (taskInput.emailAssignments !== false) {
    throw new Error('emailAssignments must stay off. This gateway does not notify the client.');
  }
  return variables;
}

function userErrorDetails(payload: unknown): TaskUserError[] {
  const raw = (payload as { userErrors?: Array<{ message?: string; path?: unknown }> } | null)?.userErrors ?? [];
  return raw
    .map((error) => ({
      message: error?.message?.trim() || '',
      path: Array.isArray(error?.path) ? error.path.filter((part): part is string => typeof part === 'string') : [],
    }))
    .filter((error) => error.message);
}

function taskIdFrom(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const id = (node as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : null;
}

export async function defaultTaskCreateAudit(entry: TaskCreateAuditEntry): Promise<TaskCreateAuditResult> {
  let consoleOk = false;
  try {
    console.log(`[mcp-write-audit] ${JSON.stringify(entry)}`);
    consoleOk = true;
  } catch {
    /* ignore */
  }
  let supabaseOk = false;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (url && key && url !== 'your-supabase-url') {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await client.from('mcp_write_audit').insert({
        tool: entry.tool,
        actor: entry.actor,
        dry_run: entry.dryRun,
        ok: entry.ok,
        refused: entry.refused,
        force: entry.force,
        reason: entry.reason,
        job_id: entry.jobId,
        job_number: entry.jobNumber,
        visit_id: entry.visitId,
        before_state: entry.before as never,
        after_state: entry.after as never,
        error: entry.error ?? null,
      });
      supabaseOk = !error;
    }
  } catch {
    /* table may not exist yet; console line is the durable record */
  }
  return { console: consoleOk, supabase: supabaseOk };
}

function auditBase(input: CreateTaskInput, dryRun: boolean): Omit<TaskCreateAuditEntry, 'ok' | 'before' | 'after' | 'at' | 'error'> {
  return {
    tool: 'create_task',
    actor: 'mcp',
    dryRun,
    refused: false,
    force: false,
    reason: input.title,
    jobId: null,
    jobNumber: null,
    visitId: null,
    notified: false,
    emailAssignments: false,
  };
}

export async function createTask(
  input: CreateTaskInput,
  deps?: JobberDeps,
  audit: TaskCreateAuditSink = defaultTaskCreateAudit
): Promise<CreateTaskResult> {
  const variables = buildTaskCreateVariables(input);
  if (input.dryRun) {
    const sink = await audit({
      ...auditBase(input, true),
      ok: true,
      before: variables,
      after: null,
      at: new Date().toISOString(),
    });
    return {
      status: 'would_create',
      dryRun: true,
      notified: false,
      emailAssignments: false,
      mutation: 'taskCreate',
      would_create: {
        parsed: input,
        mutation: 'taskCreate',
        variables,
      },
      audit: sink,
    };
  }

  try {
    const created = await graphql(TASK_CREATE_MUTATION, variables, deps);
    assertNoJobberErrors(created, 'taskCreate');
    const payload = created.data?.taskCreate as { task?: unknown; userErrors?: Array<{ message?: string; path?: unknown }> } | null;
    const userErrors = userErrorDetails(payload);
    if (userErrors.length) {
      const sink = await audit({
        ...auditBase(input, false),
        ok: false,
        before: variables,
        after: null,
        error: userErrors.map((error) => error.message).join('; '),
        at: new Date().toISOString(),
      });
      return {
        status: 'failed',
        dryRun: false,
        notified: false,
        emailAssignments: false,
        mutation: 'taskCreate',
        id: taskIdFrom(payload?.task),
        userErrors,
        task: null,
        audit: sink,
      };
    }

    const createdTask = summarizeCreatedTask(payload?.task);
    if (!createdTask) throw new Error('Jobber taskCreate returned no task');

    let task = createdTask;
    let readError: string | null = null;
    try {
      const read = await graphql(TASK_BY_ID_QUERY, { id: createdTask.id }, deps);
      assertNoJobberErrors(read, 'task');
      const fresh = summarizeCreatedTask(read.data?.task);
      if (!fresh) readError = 'task(id) returned no task';
      else task = fresh;
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }

    const sink = await audit({
      ...auditBase(input, false),
      ok: true,
      before: variables,
      after: task,
      error: readError ?? undefined,
      at: new Date().toISOString(),
    });
    return {
      status: 'created',
      dryRun: false,
      notified: false,
      emailAssignments: false,
      mutation: 'taskCreate',
      id: task.id,
      title: task.title,
      instructions: task.instructions,
      assignees: task.assignees,
      client: task.client,
      property: task.property,
      startAt: task.startAt,
      endAt: task.endAt,
      userErrors: [],
      readError,
      audit: sink,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await audit({
      ...auditBase(input, false),
      ok: false,
      before: variables,
      after: null,
      error: message,
      at: new Date().toISOString(),
    });
    throw error;
  }
}
