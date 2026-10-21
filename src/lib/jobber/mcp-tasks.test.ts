import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIST_TASKS_DEFAULT_LIMIT,
  LIST_TASKS_MAX_LIMIT,
  LIST_TASKS_QUERY,
  assertReadOnlyTaskQuery,
  buildTaskListFilter,
  listTasks,
  normalizeTaskStatus,
  taskLimit,
  taskOccursWithin,
  taskWindowRangeMs,
} from './mcp-tasks.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Jobber's error is "less than 1.5 years". 365.25 days covers a leap-year definition. */
const JOBBER_MAX_RANGE_MS = 1.5 * 365.25 * DAY_MS;

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const OPEN_TASK = {
  __typename: 'Task',
  id: 'task-1',
  title: 'Call suppliers',
  instructions: 'Ask about the pump seal.',
  isComplete: false,
  startAt: '2026-10-22T16:00:00Z',
  endAt: '2026-10-22T17:00:00Z',
  client: { id: 'client-1', name: 'Pat Example' },
  property: {
    id: 'prop-1',
    address: {
      street: '100 Oak Rd',
      street1: '100 Oak Rd',
      street2: null,
      city: 'Ramona',
      province: 'CA',
      postalCode: '92065',
      country: 'US',
    },
  },
  assignedUsers: {
    nodes: [{ id: 'user-1', name: { full: 'Brighton Scala', first: 'Brighton', last: 'Scala' } }],
    pageInfo: { hasNextPage: false },
  },
};

describe('task list query', () => {
  it('selects task fields and no mutation, color, or label', () => {
    assertReadOnlyTaskQuery(LIST_TASKS_QUERY);
    assert.match(LIST_TASKS_QUERY, /scheduledItems\(first: \$first, after: \$after, filter: \$filter\)/);
    assert.match(LIST_TASKS_QUERY, /\.\.\. on Task/);
    assert.match(LIST_TASKS_QUERY, /instructions/);
    assert.match(LIST_TASKS_QUERY, /isComplete/);
    assert.match(LIST_TASKS_QUERY, /client \{ id name \}/);
    assert.match(LIST_TASKS_QUERY, /street1/);
    assert.match(LIST_TASKS_QUERY, /assignedUsers\(first: 10\)/);
    assert.equal(/\bmutation\b|taskCreate|taskEdit|taskDelete/.test(LIST_TASKS_QUERY), false);
    assert.equal(/\bcolor\b|\blabel\b/.test(LIST_TASKS_QUERY), false);
    assert.throws(() => assertReadOnlyTaskQuery('mutation { taskCreate(input: {}) { task { id } } }'), /read-only/);
  });
});

describe('task list filters', () => {
  it('defaults to open and maps status onto Jobber enums', () => {
    const occursWithin = taskOccursWithin(new Date('2026-10-21T17:00:00.000Z'));
    assert.equal(normalizeTaskStatus(undefined), 'open');
    assert.equal(normalizeTaskStatus('  '), 'open');
    assert.equal(normalizeTaskStatus('Completed'), 'completed');
    assert.throws(() => normalizeTaskStatus('overdue'), /open or completed/);
    assert.equal(taskLimit(undefined), LIST_TASKS_DEFAULT_LIMIT);
    assert.equal(taskLimit(500), LIST_TASKS_MAX_LIMIT);
    assert.deepEqual(buildTaskListFilter({ status: 'open', occursWithin }), {
      scheduleItemType: 'BASIC_TASK',
      status: 'REMAINING',
      occursWithin,
      includeUnscheduled: true,
      schedulingAspects: ['ALL'],
      includeUnassigned: true,
    });
    assert.deepEqual(buildTaskListFilter({ status: 'completed', assigneeId: ' user-1 ', occursWithin }), {
      scheduleItemType: 'BASIC_TASK',
      status: 'COMPLETED',
      occursWithin,
      includeUnscheduled: true,
      schedulingAspects: ['ALL'],
      includeUnassigned: false,
      assignedTo: ['user-1'],
    });
  });

  it('keeps occursWithin under 1.5 years, including across a leap day', () => {
    for (const iso of ['2026-10-21T17:00:00.000Z', '2024-03-01T00:00:00.000Z', '2024-02-29T12:00:00.000Z']) {
      const window = taskOccursWithin(new Date(iso));
      const span = taskWindowRangeMs(window);
      assert.ok(span > 0, iso);
      assert.ok(span < JOBBER_MAX_RANGE_MS, `${iso} span ${span} is not under 1.5 years`);
      assert.equal(window.startAt.startsWith('2000-'), false);
      assert.equal(window.endAt.startsWith('2100-'), false);
    }
  });
});

describe('listTasks', () => {
  it('pages scheduled items, filters assignee and status, and returns task fields', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const parsed = JSON.parse(body) as { query?: string; variables?: { after?: string | null; filter?: { assignedTo?: string[] } } };
      assert.equal(/\bmutation\b/.test(parsed.query || ''), false);
      assert.equal(init?.method, 'POST');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('X-JOBBER-GRAPHQL-VERSION'), '2025-04-16');
      if (!parsed.variables?.after) {
        return jsonResponse({
          data: {
            scheduledItems: {
              nodes: [
                OPEN_TASK,
                { ...OPEN_TASK, id: 'task-visit', __typename: 'Visit', title: 'Not a task' },
                {
                  ...OPEN_TASK,
                  id: 'task-done',
                  isComplete: true,
                  title: 'Already done',
                },
                {
                  ...OPEN_TASK,
                  id: 'task-other',
                  title: 'Someone else',
                  assignedUsers: {
                    nodes: [{ id: 'user-2', name: { full: 'Other Tech' } }],
                    pageInfo: { hasNextPage: false },
                  },
                },
              ],
              pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          scheduledItems: {
            nodes: [
              {
                ...OPEN_TASK,
                id: 'task-2',
                title: 'Order fittings',
                instructions: '  ',
                startAt: null,
                endAt: null,
                client: null,
                property: null,
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    };

    const listed = await listTasks({ assigneeId: 'user-1', status: 'open', limit: 10 }, { fetchImpl, token: 'test' });
    assert.equal(listed.status, 'open');
    assert.equal(listed.assigneeId, 'user-1');
    assert.equal(listed.truncated, false);
    assert.deepEqual(
      listed.tasks.map((task) => task.id),
      ['task-1', 'task-2']
    );
    assert.equal(listed.tasks[0].title, 'Call suppliers');
    assert.equal(listed.tasks[0].description, 'Ask about the pump seal.');
    assert.equal(listed.tasks[0].color, null);
    assert.equal(listed.tasks[0].label, null);
    assert.deepEqual(listed.tasks[0].client, { id: 'client-1', name: 'Pat Example' });
    assert.equal(listed.tasks[0].property?.id, 'prop-1');
    assert.equal(listed.tasks[0].property?.address?.city, 'Ramona');
    assert.equal(listed.tasks[0].startAt, '2026-10-22T16:00:00Z');
    assert.equal(listed.tasks[0].endAt, '2026-10-22T17:00:00Z');
    assert.equal(listed.tasks[0].isComplete, false);
    assert.equal(listed.tasks[0].status, 'open');
    assert.deepEqual(listed.tasks[0].assignees, [{ id: 'user-1', name: 'Brighton Scala' }]);
    assert.equal(listed.tasks[1].description, null);
    assert.equal(listed.tasks[1].client, null);
    const first = JSON.parse(bodies[0]) as {
      variables: { filter: Record<string, unknown> & { occursWithin: { startAt: string; endAt: string } }; first: number };
    };
    assert.equal(first.variables.first, 25);
    assert.equal(first.variables.filter.scheduleItemType, 'BASIC_TASK');
    assert.equal(first.variables.filter.status, 'REMAINING');
    assert.deepEqual(first.variables.filter.assignedTo, ['user-1']);
    assert.equal(first.variables.filter.includeUnscheduled, true);
    assert.deepEqual(first.variables.filter.schedulingAspects, ['ALL']);
    assert.ok(taskWindowRangeMs(first.variables.filter.occursWithin) < JOBBER_MAX_RANGE_MS);
    assert.equal(listed.tasks[1].startAt, null);
    assert.equal(listed.tasks[1].endAt, null);
    const second = JSON.parse(bodies[1]) as { variables: { after: string } };
    assert.equal(second.variables.after, 'cursor-1');
  });

  it('marks truncated when the limit stops before the page is finished', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        data: {
          scheduledItems: {
            nodes: [OPEN_TASK, { ...OPEN_TASK, id: 'task-2', title: 'Second' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    const listed = await listTasks({ limit: 1 }, { fetchImpl, token: 'test' });
    assert.equal(listed.truncated, true);
    assert.equal(listed.tasks.length, 1);
    assert.equal(listed.status, 'open');
    assert.equal(listed.assigneeId, null);
  });

  it('requests completed tasks and keeps only completed rows', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body || ''));
      return jsonResponse({
        data: {
          scheduledItems: {
            nodes: [
              OPEN_TASK,
              { ...OPEN_TASK, id: 'task-done', isComplete: true, title: 'Done' },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    };
    const listed = await listTasks({ status: 'completed' }, { fetchImpl, token: 'test' });
    assert.deepEqual(listed.tasks.map((task) => task.id), ['task-done']);
    assert.equal(listed.tasks[0].isComplete, true);
    assert.equal(listed.tasks[0].status, 'completed');
    const parsed = JSON.parse(bodies[0]) as { variables: { filter: { status: string; assignedTo?: string[] } } };
    assert.equal(parsed.variables.filter.status, 'COMPLETED');
    assert.equal(parsed.variables.filter.assignedTo, undefined);
  });

  it('surfaces a Jobber GraphQL error', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ errors: [{ message: 'scheduledItems filter was rejected' }] });
    await assert.rejects(
      () => listTasks({}, { fetchImpl, token: 'test' }),
      /scheduledItems filter was rejected/
    );
  });
});
