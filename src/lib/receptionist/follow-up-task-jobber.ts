/**
 * Create the Jobber follow-up chosen by decideFollowUp.
 *
 * Uses the gateway createTask helper (taskCreate only, dryRun false here).
 * emailAssignments stays false. Nothing in this module texts or emails.
 * The hourly Mike → Jobber Ops job is not started or replaced; a dated open
 * task for the same phone or name inside 48 hours blocks a second create.
 */
import { assertNoJobberErrors, jobberGraphql } from '../jobber/client.ts';
import { listUsers, type JobberUserSummary } from '../jobber/mcp-client-writes.ts';
import { SHOP_TIMEZONE, instantInTimeZone } from '../jobber/mcp-schedule.ts';
import { buildTaskCreateVariables, createTask, type CreateTaskInput } from '../jobber/mcp-task-create.ts';
import { LIST_TASKS_QUERY, assertReadOnlyTaskQuery } from '../jobber/mcp-tasks.ts';
import type { JobberDeps } from '../jobber/quotes.ts';
import {
  FOLLOW_UP_ASSIGNEES,
  decideFollowUp,
  followUpDedupeFilter,
  type FollowUpInput,
  type FollowUpLane,
  type FollowUpSkipReason,
  type OpenTaskHint,
} from './follow-up-task.ts';

const USER_CACHE_MS = 10 * 60 * 1000;
const DEDUPE_PAGE_SIZE = 50;
const DEDUPE_MAX_PAGES = 4;

let userCache: { at: number; users: JobberUserSummary[] } | null = null;

export type FollowUpAssignResult = {
  created: boolean;
  reason: FollowUpSkipReason | 'assignee-not-found' | 'jobber-error' | null;
  taskId: string | null;
  assigneeName: string | null;
  lane: FollowUpLane | null;
  dedupeChecked: boolean;
  /** This path never texts or emails the customer. */
  customerNotified: false;
};

type TaskConnection = {
  nodes?: Array<Record<string, unknown> | null> | null;
  pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
};

export type FollowUpJobberDeps = JobberDeps & {
  now?: Date;
  listUsers?: typeof listUsers;
  listRecentTasks?: (now: Date) => Promise<OpenTaskHint[]>;
  createTask?: typeof createTask;
};

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function hintFromScheduledNode(node: Record<string, unknown> | null | undefined): OpenTaskHint | null {
  if (!node || typeof node.id !== 'string' || !node.id) return null;
  if (typeof node.__typename === 'string' && node.__typename !== 'Task') return null;
  const client = node.client && typeof node.client === 'object' ? (node.client as { name?: unknown }) : null;
  return {
    id: node.id,
    title: nullableString(node.title),
    description: nullableString(node.instructions),
    clientName: nullableString(client?.name),
    startAt: nullableString(node.startAt),
    endAt: nullableString(node.endAt),
    isComplete: node.isComplete === true,
  };
}

export async function listRecentOpenTasks(now: Date, deps?: JobberDeps): Promise<OpenTaskHint[]> {
  assertReadOnlyTaskQuery(LIST_TASKS_QUERY);
  const filter = followUpDedupeFilter(now);
  const tasks: OpenTaskHint[] = [];
  let after: string | null = null;
  for (let page = 0; page < DEDUPE_MAX_PAGES; page += 1) {
    const result = await jobberGraphql<{ scheduledItems?: TaskConnection }>(
      LIST_TASKS_QUERY,
      { first: DEDUPE_PAGE_SIZE, after, filter },
      deps,
    );
    assertNoJobberErrors(result, 'scheduledItems');
    const connection = result.data?.scheduledItems;
    for (const node of connection?.nodes || []) {
      const hint = hintFromScheduledNode(node);
      if (hint && !hint.isComplete) tasks.push(hint);
    }
    const pageInfo = connection?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }
  return tasks;
}

function pickAssignee(users: JobberUserSummary[], lane: FollowUpLane): JobberUserSummary | null {
  const want = FOLLOW_UP_ASSIGNEES[lane];
  const email = want.email.toLowerCase();
  const byEmail = users.filter((user) => (user.email || '').toLowerCase() === email);
  const activeEmail = byEmail.find((user) => !user.status || user.status.toUpperCase() === 'ACTIVATED');
  if (activeEmail) return activeEmail;
  const name = want.name.toLowerCase();
  return (
    users.find((user) => {
      const theirs = (user.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
      return theirs === name && (!user.status || user.status.toUpperCase() === 'ACTIVATED');
    }) || null
  );
}

async function loadUsers(deps: FollowUpJobberDeps): Promise<JobberUserSummary[]> {
  if (deps.listUsers) return (await deps.listUsers(null, deps)).users;
  const now = Date.now();
  if (userCache && now - userCache.at < USER_CACHE_MS) return userCache.users;
  const listed = await listUsers(null, deps);
  userCache = { at: now, users: listed.users };
  return listed.users;
}

function scheduleWindow(now: Date): { startAt: string; endAt: string } {
  const start = instantInTimeZone(now, SHOP_TIMEZONE);
  const end = instantInTimeZone(new Date(now.getTime() + 30 * 60 * 1000), SHOP_TIMEZONE);
  return {
    startAt: `${start.date}T${start.time}`,
    endAt: `${end.date}T${end.time}`,
  };
}

function skipped(
  reason: FollowUpAssignResult['reason'],
  extra: Partial<FollowUpAssignResult> = {},
): FollowUpAssignResult {
  return {
    created: false,
    reason,
    taskId: extra.taskId ?? null,
    assigneeName: extra.assigneeName ?? null,
    lane: extra.lane ?? null,
    dedupeChecked: extra.dedupeChecked ?? true,
    customerNotified: false,
  };
}

/**
 * Decide, dedupe against open Jobber tasks, and create one task when needed.
 * A dedupe read failure still creates (same-call latency). A missing assignee
 * does not create and does not fall back to an in-app task.
 */
export async function assignReceptionistFollowUp(
  input: FollowUpInput,
  deps: FollowUpJobberDeps = {},
): Promise<FollowUpAssignResult> {
  const now = deps.now ?? new Date();
  const preliminary = decideFollowUp(input, [], now);
  if (preliminary.action === 'skip') return skipped(preliminary.reason);

  let openTasks: OpenTaskHint[] = [];
  let dedupeChecked = true;
  try {
    openTasks = deps.listRecentTasks ? await deps.listRecentTasks(now) : await listRecentOpenTasks(now, deps);
  } catch (error) {
    dedupeChecked = false;
    console.error(
      '[follow-up-task] open Jobber task read failed; creating anyway',
      error instanceof Error ? error.message : error,
    );
  }
  const decision = decideFollowUp(input, openTasks, now);
  if (decision.action === 'skip') {
    return skipped(decision.reason, { taskId: decision.existingTaskId ?? null, dedupeChecked });
  }

  let assignee: JobberUserSummary | null = null;
  try {
    assignee = pickAssignee(await loadUsers(deps), decision.lane);
  } catch (error) {
    console.error(
      '[follow-up-task] Jobber user list failed',
      error instanceof Error ? error.message : error,
    );
    return skipped('assignee-not-found', { lane: decision.lane, assigneeName: decision.assigneeName, dedupeChecked });
  }
  if (!assignee) {
    return skipped('assignee-not-found', { lane: decision.lane, assigneeName: decision.assigneeName, dedupeChecked });
  }

  const window = scheduleWindow(now);
  const payload: CreateTaskInput = {
    title: decision.title,
    instructions: decision.instructions,
    assigneeIds: [assignee.id],
    clientId: null,
    propertyId: null,
    startAt: window.startAt,
    endAt: window.endAt,
    dryRun: false,
  };
  const variables = buildTaskCreateVariables(payload);
  if (variables.input.emailAssignments !== false) {
    throw new Error('emailAssignments must stay off');
  }

  const write = deps.createTask ?? createTask;
  try {
    const created = await write(payload, deps);
    if (created.status !== 'created' || created.dryRun) {
      const message = created.status === 'failed' ? created.userErrors.map((error) => error.message).join('; ') : created.status;
      console.error('[follow-up-task] taskCreate did not create', message);
      return skipped('jobber-error', { lane: decision.lane, assigneeName: assignee.name, dedupeChecked });
    }
    return {
      created: true,
      reason: null,
      taskId: created.id,
      assigneeName: assignee.name,
      lane: decision.lane,
      dedupeChecked,
      customerNotified: false,
    };
  } catch (error) {
    console.error('[follow-up-task] taskCreate failed', error instanceof Error ? error.message : error);
    return skipped('jobber-error', { lane: decision.lane, assigneeName: assignee.name, dedupeChecked });
  }
}
