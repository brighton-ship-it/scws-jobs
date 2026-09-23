import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_JOBBER_GRAPHQL_VERSION } from './client.ts';
import {
  assertReadOnlyTaskQuery,
  formatPropertyAddress,
  getTask,
  searchTasks,
  truncateInstructions,
  type JobberTaskDetail,
} from './mcp-tasks.ts';

const OPEN: JobberTaskDetail = {
  id: 'task-1',
  title: 'Call back on the quote',
  instructions: `${'Follow up with the customer about the well pump. '.repeat(20)}`,
  isComplete: false,
  startAt: '2026-09-24T15:00:00.000Z',
  createdAt: '2026-09-23T12:00:00.000Z',
  jobberWebUri: 'https://secure.getjobber.com/tasks/1',
  assignedUsers: { nodes: [{ id: 'user-trav', name: { full: 'Travis Example' } }] },
  client: { id: 'client-1', name: 'Pat Example' },
  property: {
    id: 'prop-1',
    address: { street1: '100 Oak Rd', city: 'Ramona', province: 'CA', postalCode: '92065' },
  },
};

const DONE: JobberTaskDetail = {
  ...OPEN,
  id: 'task-done',
  title: 'Already filed',
  instructions: 'Done yesterday',
  isComplete: true,
};

const OTHER: JobberTaskDetail = {
  ...OPEN,
  id: 'task-2',
  title: 'Order parts',
  instructions: 'Pick up the pressure switch',
  assignedUsers: { nodes: [{ id: 'user-bright', name: { full: 'Brighton Scala' } }] },
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tasksPage(nodes: JobberTaskDetail[], hasNextPage = false) {
  return {
    nodes,
    pageInfo: { hasNextPage, endCursor: nodes.length ? `c-${nodes[nodes.length - 1].id}` : null },
  };
}

function mockFetch(
  handlers: Array<(query: string, variables: Record<string, unknown>) => Response | null>
) {
  const bodies: string[] = [];
  const versions: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const headers = init?.headers as Record<string, string> | undefined;
    versions.push(headers?.['X-JOBBER-GRAPHQL-VERSION'] || '');
    const body = String(init?.body || '');
    bodies.push(body);
    const parsed = JSON.parse(body || '{}') as { query?: string; variables?: Record<string, unknown> };
    const query = parsed.query || '';
    for (const handler of handlers) {
      const match = handler(query, parsed.variables || {});
      if (match) return match;
    }
    return jsonResponse({ data: {} });
  };
  return { fetchImpl, bodies, versions };
}

describe('task helpers', () => {
  it('truncates instructions and formats a property address', () => {
    assert.equal(truncateInstructions('  short note  '), 'short note');
    const long = truncateInstructions('x'.repeat(450));
    assert.ok(long && long.length <= 400);
    assert.match(long || '', /…$/);
    assert.equal(
      formatPropertyAddress({ street1: '100 Oak Rd', city: 'Ramona', province: 'CA', postalCode: '92065' }),
      '100 Oak Rd, Ramona, CA 92065'
    );
  });

  it('refuses mutation documents', () => {
    assert.throws(
      () => assertReadOnlyTaskQuery('mutation TaskComplete { taskComplete(id: "x") { task { id } } }'),
      /read-only/
    );
  });
});

describe('searchTasks', () => {
  it('defaults to incomplete tasks and sends TaskFilterAttributes.isComplete false', async () => {
    const { fetchImpl, bodies, versions } = mockFetch([
      (query) =>
        query.includes('McpTasks')
          ? jsonResponse({ data: { tasks: tasksPage([OPEN, DONE]) } })
          : null,
    ]);

    const result = await searchTasks({}, { fetchImpl, token: 'test' });
    assert.deepEqual(
      result.tasks.map((task) => task.id),
      ['task-1']
    );
    assert.equal(result.tasks[0].isComplete, false);
    assert.equal(result.tasks[0].title, OPEN.title);
    assert.equal(result.tasks[0].startAt, OPEN.startAt);
    assert.equal(result.tasks[0].createdAt, OPEN.createdAt);
    assert.equal(result.tasks[0].client?.id, 'client-1');
    assert.equal(result.tasks[0].client?.name, 'Pat Example');
    assert.equal(result.tasks[0].property?.address, '100 Oak Rd, Ramona, CA 92065');
    assert.equal(result.tasks[0].jobberWebUri, OPEN.jobberWebUri);
    assert.deepEqual(result.tasks[0].assignedUsers, [{ id: 'user-trav', name: 'Travis Example' }]);
    assert.ok((result.tasks[0].instructions || '').length <= 400);
    assert.match(result.tasks[0].instructions || '', /…$/);
    const sent = JSON.parse(bodies.find((body) => body.includes('McpTasks')) || '{}') as {
      query?: string;
      variables?: { first?: number; filter?: { isComplete?: boolean } };
    };
    assert.match(sent.query || '', /TaskFilterAttributes/);
    assert.match(sent.query || '', /tasks\(/);
    assert.equal(sent.variables?.filter?.isComplete, false);
    assert.equal(sent.variables?.first, 50);
    assert.equal(versions[0], DEFAULT_JOBBER_GRAPHQL_VERSION);
    assert.equal(DEFAULT_JOBBER_GRAPHQL_VERSION, '2025-04-16');
    assert.equal(bodies.some((body) => /\bmutation\b/.test(body)), false);
    assert.equal(bodies.some((body) => /taskCreate|taskEdit|taskComplete|taskDelete/.test(body)), false);
  });

  it('resolves an assignee name to TaskFilterAttributes.assignedTo', async () => {
    const { fetchImpl, bodies } = mockFetch([
      (query) =>
        query.includes('McpTaskUsers')
          ? jsonResponse({
              data: {
                users: {
                  nodes: [
                    { id: 'user-trav', name: { full: 'Travis Example' } },
                    { id: 'user-bright', name: { full: 'Brighton Scala' } },
                  ],
                },
              },
            })
          : null,
      (query) =>
        query.includes('McpTasks')
          ? jsonResponse({ data: { tasks: tasksPage([OPEN, OTHER]) } })
          : null,
    ]);

    const result = await searchTasks({ assignee: 'travis', first: 25 }, { fetchImpl, token: 'test' });
    assert.deepEqual(
      result.tasks.map((task) => task.id),
      ['task-1']
    );
    const sent = JSON.parse(bodies.find((body) => body.includes('McpTasks')) || '{}') as {
      variables?: { first?: number; filter?: { isComplete?: boolean; assignedTo?: string[] } };
    };
    assert.equal(sent.variables?.first, 25);
    assert.equal(sent.variables?.filter?.isComplete, false);
    assert.deepEqual(sent.variables?.filter?.assignedTo, ['user-trav']);
    assert.match(bodies.find((body) => body.includes('McpTaskUsers')) || '', /name \{ full \}/);
  });

  it('passes an encoded user id as assignedTo and does not look up users', async () => {
    const userId = 'Z2lkOi8vSm9iYmVyL1VzZXIvMQ';
    const assigned = {
      ...OPEN,
      assignedUsers: { nodes: [{ id: userId, name: { full: 'Travis Example' } }] },
    };
    const { fetchImpl, bodies } = mockFetch([
      (query) =>
        query.includes('McpTasks')
          ? jsonResponse({ data: { tasks: tasksPage([assigned]) } })
          : null,
    ]);
    const result = await searchTasks({ assignee: userId }, { fetchImpl, token: 'test' });
    assert.equal(result.tasks[0].id, 'task-1');
    const sent = JSON.parse(bodies.find((body) => body.includes('McpTasks')) || '{}') as {
      variables?: { filter?: { assignedTo?: string[] } };
    };
    assert.deepEqual(sent.variables?.filter?.assignedTo, [userId]);
    assert.equal(bodies.some((body) => body.includes('McpTaskUsers')), false);
  });

  it('filters title and instructions locally and can include completed tasks', async () => {
    const { fetchImpl, bodies } = mockFetch([
      (query) =>
        query.includes('McpTasks')
          ? jsonResponse({ data: { tasks: tasksPage([OPEN, DONE, OTHER]) } })
          : null,
    ]);
    const result = await searchTasks(
      { query: 'pressure switch', incompleteOnly: false, first: 10 },
      { fetchImpl, token: 'test' }
    );
    assert.deepEqual(
      result.tasks.map((task) => task.id),
      ['task-2']
    );
    const sent = JSON.parse(bodies.find((body) => body.includes('McpTasks')) || '{}') as {
      query?: string;
      variables?: { filter?: { isComplete?: boolean } };
    };
    assert.equal(sent.variables?.filter, undefined);
    assert.equal(/\$filter:\s*TaskFilterAttributes/.test(sent.query || ''), false);
  });

  it('retries assignedTo as a single EncodedId when the list form is rejected', async () => {
    const userId = 'Z2lkOi8vSm9iYmVyL1VzZXIvMQ';
    let attempts = 0;
    const { fetchImpl, bodies } = mockFetch([
      (query) => {
        if (!query.includes('McpTasks')) return null;
        attempts += 1;
        if (attempts === 1) {
          return jsonResponse({
            errors: [
              {
                message:
                  'Variable "$filter" got invalid value at "filter.assignedTo"; Expected type "EncodedId" to be a string.',
              },
            ],
          });
        }
        return jsonResponse({
          data: {
            tasks: tasksPage([
              {
                ...OPEN,
                assignedUsers: { nodes: [{ id: userId, name: { full: 'Travis Example' } }] },
              },
            ]),
          },
        });
      },
    ]);
    const result = await searchTasks({ assignee: userId, first: 5 }, { fetchImpl, token: 'test' });
    assert.equal(result.tasks.length, 1);
    const taskBodies = bodies.filter((body) => body.includes('McpTasks')).map((body) => JSON.parse(body) as {
      variables?: { filter?: { assignedTo?: unknown } };
    });
    assert.deepEqual(taskBodies[0].variables?.filter?.assignedTo, [userId]);
    assert.equal(taskBodies[1].variables?.filter?.assignedTo, userId);
  });

  it('caps first at 100', async () => {
    const { fetchImpl, bodies } = mockFetch([
      (query) => (query.includes('McpTasks') ? jsonResponse({ data: { tasks: tasksPage([]) } }) : null),
    ]);
    await searchTasks({ first: 500 }, { fetchImpl, token: 'test' });
    const sent = JSON.parse(bodies.find((body) => body.includes('McpTasks')) || '{}') as {
      variables?: { first?: number };
    };
    assert.equal(sent.variables?.first, 100);
  });
});

describe('getTask', () => {
  it('loads one task by encoded id', async () => {
    const { fetchImpl, bodies } = mockFetch([
      (query) =>
        query.includes('McpTaskById')
          ? jsonResponse({ data: { task: { ...OPEN, instructions: 'Short instructions' } } })
          : null,
    ]);
    const task = await getTask({ taskId: 'Z2lkOi8vSm9iYmVyL1Rhc2svMQ' }, { fetchImpl, token: 'test' });
    assert.equal(task.id, 'task-1');
    assert.equal(task.instructions, 'Short instructions');
    assert.equal(task.property?.address, '100 Oak Rd, Ramona, CA 92065');
    assert.equal(bodies.some((body) => /\bmutation\b/.test(body)), false);
  });

  it('requires a task id', async () => {
    await assert.rejects(() => getTask({ taskId: '  ' }, { token: 'test' }), /taskId is required/);
  });
});
