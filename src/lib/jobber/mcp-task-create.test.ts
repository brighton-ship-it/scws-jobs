import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoClientNotification, assertNoNotifyArgs } from './mcp-notify.ts';
import { shopWallTimeToIso8601, toShopLocalDateTime } from './mcp-schedule.ts';
import { LIST_TASKS_QUERY, assertReadOnlyTaskQuery } from './mcp-tasks.ts';
import { callJobberMcpTool } from '../mcp/jobber-tools.ts';
import {
  TASK_BY_ID_QUERY,
  TASK_CREATE_MUTATION,
  buildTaskCreateVariables,
  createTask,
  parseCreateTaskArgs,
  type TaskCreateAuditEntry,
} from './mcp-task-create.ts';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TASK = {
  id: 'task-new',
  title: 'Call Pat back',
  instructions: 'Mike call log: callback after 3pm.',
  startAt: '2026-10-24T22:00:00Z',
  endAt: '2026-10-24T22:30:00Z',
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
  },
};

function recordingAudit() {
  const entries: TaskCreateAuditEntry[] = [];
  return {
    entries,
    audit: async (entry: TaskCreateAuditEntry) => {
      entries.push(entry);
      return { console: true, supabase: false };
    },
  };
}

describe('create_task args', () => {
  it('defaults dryRun to true and maps description onto instructions', () => {
    const parsed = parseCreateTaskArgs({
      title: '  Call Pat back  ',
      description: ' Mike call log ',
      assigneeIds: [' user-1 '],
    });
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.title, 'Call Pat back');
    assert.equal(parsed.instructions, 'Mike call log');
    assert.deepEqual(parsed.assigneeIds, ['user-1']);
    assert.equal(parsed.clientId, null);
    assert.equal(parsed.startAt, null);
    assert.equal(parseCreateTaskArgs({ title: 'A', instructions: 'B', assigneeIds: ['u'], dryRun: false }).dryRun, false);
    assert.equal(parseCreateTaskArgs({ title: 'A', assigneeIds: ['u'], dryRun: null }).dryRun, true);
  });

  it('accepts start and end as aliases of startAt and endAt', () => {
    const parsed = parseCreateTaskArgs({
      title: 'A',
      assigneeIds: ['u'],
      start: '2026-10-24T15:00:00',
      end: '2026-10-24T15:30:00',
      clientId: ' client-1 ',
      propertyId: 'prop-1',
    });
    assert.equal(parsed.startAt, '2026-10-24T15:00:00');
    assert.equal(parsed.endAt, '2026-10-24T15:30:00');
    assert.equal(parsed.clientId, 'client-1');
    assert.equal(parsed.propertyId, 'prop-1');
  });

  it('rejects unknown keys, notify args, empty assignees, and mismatched aliases', () => {
    assert.throws(() => parseCreateTaskArgs({ title: 'A', assigneeIds: ['u'], emailAssignments: true }), /does not accept emailAssignments/);
    assert.throws(() => parseCreateTaskArgs({ title: 'A', assigneeIds: ['u'], notifyTeam: true }), /does not accept notifyTeam/);
    assert.throws(() => parseCreateTaskArgs({ title: 'A', assigneeIds: ['u'], recurrenceRule: 'FREQ=DAILY' }), /recurrenceRule/);
    assert.throws(() => parseCreateTaskArgs({ title: 'A', assigneeIds: ['u'], teamReminderOffset: 30 }), /teamReminderOffset/);
    assert.throws(() => parseCreateTaskArgs({ title: 'A', assigneeIds: [] }), /non-empty array/);
    assert.throws(() => parseCreateTaskArgs({ title: 'A' }), /assigneeIds/);
    assert.throws(() => parseCreateTaskArgs({ assigneeIds: ['u'] }), /title is required/);
    assert.throws(() => parseCreateTaskArgs({ title: 'A', assigneeIds: ['u'], dryRun: 'false' }), /dryRun must be a boolean/);
    assert.throws(
      () => parseCreateTaskArgs({ title: 'A', assigneeIds: ['u'], instructions: 'one', description: 'two' }),
      /instructions and description/
    );
    assert.throws(
      () => parseCreateTaskArgs({ title: 'A', assigneeIds: ['u'], startAt: '2026-10-24T15:00:00' }),
      /both required/
    );
    assert.throws(() => assertNoNotifyArgs({ emailAssignments: true }), /emailAssignments/);
    assert.throws(() => assertNoClientNotification({ emailAssignments: true }), /emailAssignments must stay off/);
  });
});

describe('create_task payload', () => {
  it('converts Los Angeles wall time to an offset ISO string and forces email off', () => {
    const summer = shopWallTimeToIso8601(toShopLocalDateTime('2026-09-30T09:00:00', 'startAt'));
    assert.equal(summer, '2026-09-30T09:00:00-07:00');
    const winter = shopWallTimeToIso8601(toShopLocalDateTime('2026-01-15T09:00:00', 'startAt'));
    assert.equal(winter, '2026-01-15T09:00:00-08:00');
    const fromZ = shopWallTimeToIso8601(toShopLocalDateTime('2026-09-30T16:00:00Z', 'startAt'));
    assert.equal(fromZ, '2026-09-30T09:00:00-07:00');
    assert.throws(() => shopWallTimeToIso8601(toShopLocalDateTime('2026-03-08T02:30:00', 'startAt')), /daylight-saving/);

    const variables = buildTaskCreateVariables(
      parseCreateTaskArgs({
        title: 'Call Pat back',
        description: 'Callback after 3pm',
        assigneeIds: ['user-1'],
        clientId: 'client-1',
        startAt: '2026-10-24T15:00:00',
        endAt: '2026-10-24T15:30:00',
      })
    );
    assert.equal(variables.clientId, 'client-1');
    assert.equal(variables.propertyId, undefined);
    assert.equal(variables.input.emailAssignments, false);
    assert.equal(variables.input.allDay, false);
    assert.equal(variables.input.instructions, 'Callback after 3pm');
    assert.deepEqual(variables.input.assignedTo, ['user-1']);
    assert.equal(variables.input.startAt, '2026-10-24T15:00:00-07:00');
    assert.equal(variables.input.endAt, '2026-10-24T15:30:00-07:00');
    assert.equal('teamReminderOffset' in variables.input, false);
    assert.equal('recurrenceRule' in variables.input, false);
    assert.equal('notifyTeam' in variables.input, false);
    assert.doesNotMatch(JSON.stringify(variables), /"emailAssignments":true|notifyTeam":true|teamReminderOffset/);
    assertNoClientNotification(variables);
  });

  it('omits schedule fields when start and end are absent', () => {
    const variables = buildTaskCreateVariables(parseCreateTaskArgs({ title: 'Unscheduled', assigneeIds: ['user-1'] }));
    assert.equal(variables.input.startAt, undefined);
    assert.equal(variables.input.endAt, undefined);
    assert.equal(variables.input.allDay, undefined);
    assert.equal(variables.input.emailAssignments, false);
  });
});

describe('create_task writes', () => {
  it('keeps the list query read-only and does not call taskEdit or taskDelete', () => {
    assertReadOnlyTaskQuery(LIST_TASKS_QUERY);
    assert.equal(/\bmutation\b|taskCreate|taskEdit|taskDelete/.test(LIST_TASKS_QUERY), false);
    assert.throws(() => assertReadOnlyTaskQuery(TASK_CREATE_MUTATION), /read-only/);
    assert.match(TASK_CREATE_MUTATION, /taskCreate\(clientId: \$clientId, propertyId: \$propertyId, input: \$input\)/);
    assert.match(TASK_CREATE_MUTATION, /userErrors \{ message path \}/);
    assert.doesNotMatch(TASK_CREATE_MUTATION, /taskEdit|taskDelete|emailCreate|\bsms\b/);
    assert.match(TASK_BY_ID_QUERY, /task\(id: \$id\)/);
    assert.doesNotMatch(TASK_BY_ID_QUERY, /\bmutation\b|taskCreate|taskEdit|taskDelete|\bcolor\b|\blabel\b/);
  });

  it('dryRun returns would_create and does not call Jobber', async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return jsonResponse({ data: {} });
    };
    const sink = recordingAudit();
    const result = await createTask(
      parseCreateTaskArgs({
        title: 'Call Pat back',
        instructions: 'Callback after 3pm',
        assigneeIds: ['user-1'],
        start: '2026-10-24T15:00:00',
        end: '2026-10-24T15:30:00',
      }),
      { fetchImpl, token: 'test' },
      sink.audit
    );
    assert.equal(called, false);
    assert.equal(result.status, 'would_create');
    assert.equal(result.dryRun, true);
    assert.equal(result.notified, false);
    assert.equal(result.emailAssignments, false);
    if (result.status !== 'would_create') return;
    assert.equal(result.would_create.mutation, 'taskCreate');
    assert.equal(result.would_create.parsed.instructions, 'Callback after 3pm');
    assert.equal(result.would_create.parsed.dryRun, true);
    assert.equal(result.would_create.variables.input.emailAssignments, false);
    assert.equal(result.would_create.variables.input.startAt, '2026-10-24T15:00:00-07:00');
    assert.equal(sink.entries.length, 1);
    assert.equal(sink.entries[0].dryRun, true);
    assert.equal(sink.entries[0].ok, true);
    assert.equal(sink.entries[0].notified, false);
  });

  it('creates, re-reads task(id), and returns the task fields', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const parsed = JSON.parse(body) as {
        query?: string;
        variables?: {
          id?: string;
          clientId?: string;
          propertyId?: string;
          input?: { emailAssignments?: boolean; startAt?: string; teamReminderOffset?: number };
        };
      };
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('X-JOBBER-GRAPHQL-VERSION'), '2025-04-16');
      if (parsed.query?.includes('McpTaskCreate')) {
        assert.equal(parsed.variables?.input?.emailAssignments, false);
        assert.equal(parsed.variables?.clientId, 'client-1');
        assert.equal(parsed.variables?.propertyId, 'prop-1');
        assert.equal(parsed.variables?.input?.startAt, '2026-10-24T15:00:00-07:00');
        assert.equal(parsed.variables?.input?.teamReminderOffset, undefined);
        assert.equal(/\btaskEdit\b|\btaskDelete\b/.test(parsed.query), false);
        return jsonResponse({
          data: { taskCreate: { task: { id: 'task-new', title: 'Call Pat back' }, userErrors: [] } },
        });
      }
      if (parsed.query?.includes('McpTaskById')) {
        assert.equal(parsed.variables?.id, 'task-new');
        assert.equal(/\bmutation\b/.test(parsed.query), false);
        return jsonResponse({ data: { task: TASK } });
      }
      throw new Error(`unexpected query ${parsed.query}`);
    };
    const sink = recordingAudit();
    const result = await createTask(
      parseCreateTaskArgs({
        title: 'Call Pat back',
        description: 'Mike call log: callback after 3pm.',
        assigneeIds: ['user-1'],
        clientId: 'client-1',
        propertyId: 'prop-1',
        startAt: '2026-10-24T15:00:00',
        endAt: '2026-10-24T15:30:00',
        dryRun: false,
      }),
      { fetchImpl, token: 'test' },
      sink.audit
    );
    assert.equal(result.status, 'created');
    assert.equal(result.dryRun, false);
    assert.equal(result.notified, false);
    assert.equal(result.emailAssignments, false);
    if (result.status !== 'created') return;
    assert.equal(result.id, 'task-new');
    assert.equal(result.title, 'Call Pat back');
    assert.equal(result.instructions, 'Mike call log: callback after 3pm.');
    assert.deepEqual(result.assignees, [{ id: 'user-1', name: 'Brighton Scala' }]);
    assert.equal(result.client?.id, 'client-1');
    assert.equal(result.client?.name, 'Pat Example');
    assert.equal(result.property?.id, 'prop-1');
    assert.equal(result.property?.address?.city, 'Ramona');
    assert.equal(result.startAt, '2026-10-24T22:00:00Z');
    assert.equal(result.endAt, '2026-10-24T22:30:00Z');
    assert.deepEqual(result.userErrors, []);
    assert.equal(result.readError, null);
    assert.equal(bodies.length, 2);
    assert.match(bodies[0], /taskCreate/);
    assert.doesNotMatch(bodies[0], /taskEdit|taskDelete|teamReminderOffset/);
    assert.match(bodies[1], /McpTaskById/);
    assert.equal(sink.entries[0].ok, true);
    assert.equal(sink.entries[0].dryRun, false);
  });

  it('surfaces userErrors and does not re-read', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body || ''));
      return jsonResponse({
        data: {
          taskCreate: {
            task: null,
            userErrors: [{ message: 'Assigned user was not found', path: ['input', 'assignedTo'] }],
          },
        },
      });
    };
    const sink = recordingAudit();
    const result = await createTask(
      parseCreateTaskArgs({ title: 'Call Pat back', assigneeIds: ['missing'], dryRun: false }),
      { fetchImpl, token: 'test' },
      sink.audit
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.notified, false);
    assert.equal(result.emailAssignments, false);
    if (result.status !== 'failed') return;
    assert.equal(result.id, null);
    assert.equal(result.task, null);
    assert.deepEqual(result.userErrors, [{ message: 'Assigned user was not found', path: ['input', 'assignedTo'] }]);
    assert.equal(bodies.length, 1);
    assert.doesNotMatch(bodies[0], /McpTaskById/);
    assert.equal(sink.entries[0].ok, false);
    assert.match(sink.entries[0].error || '', /Assigned user was not found/);
  });

  it('returns a created id when the re-read fails', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const query = (JSON.parse(String(init?.body || '{}')) as { query?: string }).query || '';
      if (query.includes('McpTaskCreate')) {
        return jsonResponse({ data: { taskCreate: { task: TASK, userErrors: [] } } });
      }
      return jsonResponse({ errors: [{ message: 'task read failed' }] });
    };
    const result = await createTask(
      parseCreateTaskArgs({ title: 'Call Pat back', assigneeIds: ['user-1'], dryRun: false }),
      { fetchImpl, token: 'test' },
      async () => ({ console: true, supabase: false })
    );
    assert.equal(result.status, 'created');
    if (result.status !== 'created') return;
    assert.equal(result.id, 'task-new');
    assert.match(result.readError || '', /task read failed/);
  });
});

describe('create_task tool', () => {
  it('dryRun through the gateway does not mutate and a live call returns the task', async () => {
    const quiet = await callJobberMcpTool(
      'create_task',
      { title: 'Call Pat back', instructions: 'Callback', assigneeIds: ['user-1'] },
      {
        token: 'test',
        fetchImpl: async () => {
          throw new Error('dryRun must not call Jobber');
        },
      }
    );
    assert.equal(quiet.isError, undefined);
    const dry = JSON.parse(quiet.content[0].text) as {
      status: string;
      dryRun: boolean;
      notified: boolean;
      emailAssignments: boolean;
      would_create: { variables: { input: { emailAssignments: boolean; instructions: string } } };
      note: string;
    };
    assert.equal(dry.status, 'would_create');
    assert.equal(dry.dryRun, true);
    assert.equal(dry.notified, false);
    assert.equal(dry.emailAssignments, false);
    assert.equal(dry.would_create.variables.input.emailAssignments, false);
    assert.equal(dry.would_create.variables.input.instructions, 'Callback');
    assert.match(dry.note, /taskCreate was not called/);

    const live = await callJobberMcpTool(
      'create_task',
      {
        title: 'Call Pat back',
        description: 'Mike call log: callback after 3pm.',
        assigneeIds: ['user-1'],
        dryRun: false,
      },
      {
        token: 'test',
        fetchImpl: async (_url, init) => {
          const query = (JSON.parse(String(init?.body || '{}')) as { query?: string }).query || '';
          if (query.includes('McpTaskCreate')) {
            return jsonResponse({ data: { taskCreate: { task: { id: 'task-new' }, userErrors: [] } } });
          }
          return jsonResponse({ data: { task: TASK } });
        },
      }
    );
    assert.equal(live.isError, undefined);
    const created = JSON.parse(live.content[0].text) as { status: string; id: string; instructions: string | null; notified: boolean };
    assert.equal(created.status, 'created');
    assert.equal(created.id, 'task-new');
    assert.equal(created.instructions, 'Mike call log: callback after 3pm.');
    assert.equal(created.notified, false);

    const failed = await callJobberMcpTool(
      'create_task',
      { title: 'Call Pat back', assigneeIds: ['missing'], dryRun: false },
      {
        token: 'test',
        fetchImpl: async () =>
          jsonResponse({
            data: { taskCreate: { task: null, userErrors: [{ message: 'Assigned user was not found', path: ['input', 'assignedTo'] }] } },
          }),
      }
    );
    assert.equal(failed.isError, true);
    const failure = JSON.parse(failed.content[0].text) as { status: string; userErrors: Array<{ message: string }> };
    assert.equal(failure.status, 'failed');
    assert.equal(failure.userErrors[0].message, 'Assigned user was not found');
  });
});
