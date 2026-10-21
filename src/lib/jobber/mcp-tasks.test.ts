import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIST_TASKS_DEFAULT_LIMIT,
  LIST_TASKS_MAX_LIMIT,
  LIST_TASKS_PAGE_SIZE,
  LIST_TASKS_QUERY,
  LIST_TASKS_UNSCHEDULED_PAGE_SIZE,
  LIST_TASKS_WINDOW_COUNT,
  assertReadOnlyTaskQuery,
  buildDatedTaskFilter,
  buildUnscheduledAllFilter,
  buildUnscheduledTaskFilter,
  listTasks,
  normalizeTaskStatus,
  taskLimit,
  taskOccursWindows,
  taskOccursWithin,
  taskWindowRangeMs,
  type TaskListFilter,
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

function page(nodes: unknown[], pageInfo: { hasNextPage: boolean; endCursor: string | null } = { hasNextPage: false, endCursor: null }) {
  return jsonResponse({
    data: { scheduledItems: { nodes, pageInfo } },
  });
}

function emptyPage() {
  return page([]);
}

type SentFilter = TaskListFilter & { occursWithin: { startAt: string; endAt: string } };

function sentFilters(bodies: string[]): SentFilter[] {
  return bodies.map((body) => (JSON.parse(body) as { variables: { filter: SentFilter } }).variables.filter);
}

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
  it('defaults to open and splits dated and unscheduled filters', () => {
    const occursWithin = taskOccursWithin(new Date('2026-10-21T17:00:00.000Z'));
    assert.equal(normalizeTaskStatus(undefined), 'open');
    assert.equal(normalizeTaskStatus('  '), 'open');
    assert.equal(normalizeTaskStatus('Completed'), 'completed');
    assert.throws(() => normalizeTaskStatus('overdue'), /open or completed/);
    assert.equal(taskLimit(undefined), LIST_TASKS_DEFAULT_LIMIT);
    assert.equal(taskLimit(500), LIST_TASKS_MAX_LIMIT);
    assert.deepEqual(buildDatedTaskFilter({ status: 'open', assigneeId: ' user-1 ', occursWithin }), {
      scheduleItemType: 'BASIC_TASK',
      status: 'REMAINING',
      occursWithin,
      includeUnscheduled: false,
      includeUnassigned: false,
      assignedTo: ['user-1'],
    });
    assert.equal(buildDatedTaskFilter({ status: 'open', occursWithin }).schedulingAspects, undefined);
    assert.deepEqual(buildUnscheduledTaskFilter({ assigneeId: 'user-1', occursWithin }), {
      scheduleItemType: 'BASIC_TASK',
      occursWithin,
      includeUnscheduled: true,
      schedulingAspects: ['UNSCHEDULED'],
      includeUnassigned: false,
      assignedTo: ['user-1'],
    });
    assert.equal(buildUnscheduledTaskFilter({ assigneeId: 'user-1', occursWithin }).status, undefined);
    assert.deepEqual(buildUnscheduledTaskFilter({ assigneeId: 'user-1', occursWithin, ignoreAssignee: true }), {
      scheduleItemType: 'BASIC_TASK',
      occursWithin,
      includeUnscheduled: true,
      schedulingAspects: ['UNSCHEDULED'],
      includeUnassigned: true,
    });
    assert.deepEqual(buildUnscheduledAllFilter({ occursWithin }), {
      scheduleItemType: 'BASIC_TASK',
      occursWithin,
      includeUnscheduled: true,
      schedulingAspects: ['ALL'],
      includeUnassigned: true,
    });
    assert.equal(buildUnscheduledAllFilter({ occursWithin }).status, undefined);
    assert.equal(buildDatedTaskFilter({ status: 'completed', occursWithin }).status, 'COMPLETED');
  });

  it('keeps every window under 1.5 years and steps backward', () => {
    for (const iso of ['2026-10-21T17:00:00.000Z', '2024-03-01T00:00:00.000Z', '2024-02-29T12:00:00.000Z']) {
      const windows = taskOccursWindows(new Date(iso));
      assert.equal(windows.length, LIST_TASKS_WINDOW_COUNT);
      for (let index = 0; index < windows.length; index += 1) {
        const span = taskWindowRangeMs(windows[index]);
        assert.ok(span > 0, iso);
        assert.ok(span < JOBBER_MAX_RANGE_MS, `${iso} window ${index} span ${span} is not under 1.5 years`);
        assert.equal(windows[index].startAt.startsWith('2000-'), false);
        assert.equal(windows[index].endAt.startsWith('2100-'), false);
        if (index > 0) assert.equal(Date.parse(windows[index].endAt), Date.parse(windows[index - 1].startAt));
      }
      assert.ok(Date.parse(windows[windows.length - 1].startAt) < Date.parse(windows[0].startAt));
    }
  });
});

describe('listTasks', () => {
  it('merges an unscheduled call with dated windows and dedupes', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const parsed = JSON.parse(body) as { query?: string; variables?: { first?: number; filter?: SentFilter } };
      assert.equal(/\bmutation\b/.test(parsed.query || ''), false);
      assert.equal(init?.method, 'POST');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('X-JOBBER-GRAPHQL-VERSION'), '2025-04-16');
      const filter = parsed.variables?.filter;
      if (filter?.schedulingAspects?.[0] === 'UNSCHEDULED') {
        assert.equal(parsed.variables?.first, LIST_TASKS_UNSCHEDULED_PAGE_SIZE);
        return page([
          {
            ...OPEN_TASK,
            id: 'task-alpine',
            title: 'Look at notes for past due invoice please',
            instructions: 'Look at notes for past due invoice please',
            startAt: null,
            endAt: null,
            client: { id: 'client-alpine', name: 'Alpine Camp' },
          },
          {
            ...OPEN_TASK,
            id: 'task-dated',
            title: 'Tank & Materials',
            startAt: '2026-10-21T18:00:00Z',
            endAt: '2026-10-21T19:00:00Z',
          },
          { ...OPEN_TASK, id: 'task-visit', __typename: 'Visit', title: 'Not a task' },
          { ...OPEN_TASK, id: 'task-done', isComplete: true, title: 'Already done', startAt: null, endAt: null },
        ]);
      }
      if (filter?.status === 'REMAINING' && filter.occursWithin && bodies.filter((entry) => entry.includes('"REMAINING"')).length === 1) {
        assert.equal(parsed.variables?.first, LIST_TASKS_PAGE_SIZE);
        return page([
          {
            ...OPEN_TASK,
            id: 'task-dated',
            title: 'Tank & Materials',
            startAt: '2026-10-21T18:00:00Z',
            endAt: '2026-10-21T19:00:00Z',
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
        ]);
      }
      return emptyPage();
    };

    const listed = await listTasks({ assigneeId: 'user-1', status: 'open', limit: 10 }, { fetchImpl, token: 'test' });
    assert.equal(listed.status, 'open');
    assert.equal(listed.assigneeId, 'user-1');
    assert.deepEqual(
      listed.tasks.map((task) => task.id),
      ['task-alpine', 'task-dated']
    );
    assert.equal(listed.tasks[0].title, 'Look at notes for past due invoice please');
    assert.equal(listed.tasks[0].startAt, null);
    assert.equal(listed.tasks[0].endAt, null);
    assert.equal(listed.tasks[0].client?.name, 'Alpine Camp');
    assert.equal(listed.tasks[0].description, 'Look at notes for past due invoice please');
    assert.equal(listed.tasks[0].color, null);
    assert.equal(listed.tasks[0].label, null);
    assert.deepEqual(listed.tasks[0].assignees, [{ id: 'user-1', name: 'Brighton Scala' }]);
    assert.equal(listed.tasks[1].title, 'Tank & Materials');
    const filters = sentFilters(bodies);
    assert.equal(filters[0].schedulingAspects?.[0], 'UNSCHEDULED');
    assert.equal(filters[0].status, undefined);
    assert.equal(filters[0].includeUnscheduled, true);
    assert.deepEqual(filters[0].assignedTo, ['user-1']);
    assert.equal(filters.some((filter) => filter.schedulingAspects?.[0] === 'ALL'), false);
    assert.equal(filters.some((filter) => filter.includeUnassigned === true && filter.schedulingAspects?.[0] === 'UNSCHEDULED'), false);
    const dated = filters.filter((filter) => filter.status === 'REMAINING');
    assert.equal(dated.length, LIST_TASKS_WINDOW_COUNT);
    for (const filter of dated) {
      assert.equal(filter.includeUnscheduled, false);
      assert.equal(filter.schedulingAspects, undefined);
      assert.ok(taskWindowRangeMs(filter.occursWithin) < JOBBER_MAX_RANGE_MS);
      assert.deepEqual(filter.assignedTo, ['user-1']);
    }
    assert.equal(listed.queries[0]?.name, 'unscheduled');
    assert.equal(listed.queries[0]?.fetched, 4);
    assert.equal(listed.queries[0]?.kept, 2);
    assert.equal(listed.queries[0]?.error, null);
    assert.equal(listed.covered.datedWindows, LIST_TASKS_WINDOW_COUNT);
    assert.equal(listed.covered.datedWindowsRun, LIST_TASKS_WINDOW_COUNT);
    assert.equal(listed.covered.endAt, listed.occursWithin.endAt);
    assert.ok(Date.parse(listed.covered.startAt) < Date.parse(listed.occursWithin.startAt));
    assert.equal(listed.truncated, false);
  });

  it('retries unscheduled tasks without assignedTo when the assignee call keeps nothing', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const filter = (JSON.parse(body) as { variables: { filter: SentFilter } }).variables.filter;
      if (filter.schedulingAspects?.[0] === 'UNSCHEDULED' && filter.assignedTo) return emptyPage();
      if (filter.schedulingAspects?.[0] === 'UNSCHEDULED') {
        return page([
          {
            ...OPEN_TASK,
            id: 'task-alpine',
            title: 'Look at notes for past due invoice please',
            startAt: null,
            endAt: null,
            client: { id: 'c1', name: 'Alpine Camp' },
          },
          {
            ...OPEN_TASK,
            id: 'task-rancho',
            title: 'Can we please give him a call',
            startAt: null,
            endAt: null,
            client: { id: 'c2', name: 'Rancho BV LLC' },
            assignedUsers: { nodes: [], pageInfo: { hasNextPage: false } },
          },
          {
            ...OPEN_TASK,
            id: 'task-other',
            title: 'Someone else',
            startAt: null,
            endAt: null,
            assignedUsers: {
              nodes: [{ id: 'user-2', name: { full: 'Other Tech' } }],
              pageInfo: { hasNextPage: false },
            },
          },
          {
            ...OPEN_TASK,
            id: 'task-kehle',
            title: 'Can we give her a call',
            startAt: null,
            endAt: null,
            client: { id: 'c3', name: 'Kehle-Quinones/Burns' },
            assignedUsers: {
              nodes: [{ id: 'user-9', name: { full: 'Paged' } }],
              pageInfo: { hasNextPage: true },
            },
          },
        ]);
      }
      return emptyPage();
    };

    const listed = await listTasks({ assigneeId: 'user-1', status: 'open' }, { fetchImpl, token: 'test' });
    assert.deepEqual(
      listed.tasks.map((task) => task.title),
      ['Look at notes for past due invoice please', 'Can we give her a call']
    );
    assert.equal(listed.queries[0]?.name, 'unscheduled');
    assert.equal(listed.queries[0]?.kept, 0);
    assert.equal(listed.queries[1]?.name, 'unscheduled-any-assignee');
    assert.equal(listed.queries[1]?.assignedTo, null);
    assert.equal(listed.queries[1]?.fetched, 4);
    assert.equal(listed.queries[1]?.kept, 2);
    assert.equal(listed.queries.some((query) => query.name === 'unscheduled-all'), false);
    const filters = sentFilters(bodies);
    assert.deepEqual(filters[0].assignedTo, ['user-1']);
    assert.equal(filters[1].assignedTo, undefined);
    assert.equal(filters[1].includeUnassigned, true);
  });

  it('probes ALL with no status when UNSCHEDULED keeps nothing', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const filter = (JSON.parse(String(init?.body || '')) as { variables: { filter: SentFilter } }).variables.filter;
      if (filter.schedulingAspects?.[0] === 'ALL') {
        assert.equal(filter.status, undefined);
        assert.equal(filter.assignedTo, undefined);
        return page([
          {
            ...OPEN_TASK,
            id: 'task-alpine',
            title: 'Look at notes for past due invoice please',
            startAt: null,
            endAt: null,
          },
        ]);
      }
      if (filter.schedulingAspects?.[0] === 'UNSCHEDULED') return emptyPage();
      return emptyPage();
    };
    const listed = await listTasks({ assigneeId: 'user-1', status: 'open' }, { fetchImpl, token: 'test' });
    assert.deepEqual(listed.tasks.map((task) => task.id), ['task-alpine']);
    assert.equal(listed.queries.some((query) => query.name === 'unscheduled-all' && query.kept === 1), true);
    assert.equal(listed.queries.find((query) => query.name === 'unscheduled-all')?.status, null);
  });

  it('keeps a row with empty assignedUsers when assignedTo was sent', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const filter = (JSON.parse(String(init?.body || '')) as { variables: { filter: SentFilter } }).variables.filter;
      if (filter.schedulingAspects?.[0] === 'UNSCHEDULED' && filter.assignedTo) {
        return page([
          {
            ...OPEN_TASK,
            id: 'task-alpine',
            title: 'Look at notes for past due invoice please',
            startAt: null,
            endAt: null,
            assignedUsers: { nodes: [], pageInfo: { hasNextPage: false } },
          },
        ]);
      }
      return emptyPage();
    };
    const listed = await listTasks({ assigneeId: 'user-1', status: 'open' }, { fetchImpl, token: 'test' });
    assert.deepEqual(listed.tasks.map((task) => task.id), ['task-alpine']);
    assert.equal(listed.queries.some((query) => query.name === 'unscheduled-any-assignee'), false);
  });

  it('marks truncated when the limit stops before later windows run', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return page([OPEN_TASK, { ...OPEN_TASK, id: 'task-2', title: 'Second' }]);
    };
    const listed = await listTasks({ limit: 1 }, { fetchImpl, token: 'test' });
    assert.equal(listed.truncated, true);
    assert.equal(listed.tasks.length, 1);
    assert.equal(listed.assigneeId, null);
    assert.equal(calls, 1);
    assert.equal(listed.covered.datedWindowsRun, 0);
    assert.equal(listed.queries[0]?.kept, 1);
  });

  it('requests completed tasks on the dated calls and keeps only completed rows', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body || ''));
      return page([OPEN_TASK, { ...OPEN_TASK, id: 'task-done', isComplete: true, title: 'Done', startAt: null, endAt: null }]);
    };
    const listed = await listTasks({ status: 'completed' }, { fetchImpl, token: 'test' });
    assert.deepEqual(listed.tasks.map((task) => task.id), ['task-done']);
    assert.equal(listed.tasks[0].isComplete, true);
    assert.equal(listed.tasks[0].status, 'completed');
    const filters = sentFilters(bodies);
    assert.equal(filters[0].status, undefined);
    assert.equal(filters[0].schedulingAspects?.[0], 'UNSCHEDULED');
    assert.ok(filters.some((filter) => filter.status === 'COMPLETED' && filter.includeUnscheduled === false));
    assert.equal(filters.some((filter) => filter.assignedTo), false);
  });

  it('returns dated tasks when the unscheduled call errors', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const filter = (JSON.parse(String(init?.body || '')) as { variables: { filter: SentFilter } }).variables.filter;
      if (filter.schedulingAspects) {
        return jsonResponse({ errors: [{ message: 'unscheduled aspect was rejected' }] });
      }
      if (filter.status === 'REMAINING') return page([OPEN_TASK]);
      return emptyPage();
    };
    const listed = await listTasks({ status: 'open' }, { fetchImpl, token: 'test' });
    assert.deepEqual(listed.tasks.map((task) => task.id), ['task-1']);
    assert.equal(listed.truncated, true);
    assert.match(listed.queries[0]?.error || '', /unscheduled aspect was rejected/);
    assert.equal(listed.queries.find((query) => query.name === 'dated')?.error, null);
  });

  it('surfaces a Jobber GraphQL error when every call fails', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ errors: [{ message: 'scheduledItems filter was rejected' }] });
    await assert.rejects(() => listTasks({}, { fetchImpl, token: 'test' }), /scheduledItems filter was rejected/);
  });
});
