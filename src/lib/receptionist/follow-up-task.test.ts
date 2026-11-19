import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildTaskCreateVariables } from '../jobber/mcp-task-create.ts';
import type { JobberUserSummary } from '../jobber/mcp-client-writes.ts';
import { LIST_TASKS_QUERY, assertReadOnlyTaskQuery } from '../jobber/mcp-tasks.ts';
import { assignReceptionistFollowUp } from './follow-up-task-jobber.ts';
import {
  FOLLOW_UP_ASSIGNEES,
  FOLLOW_UP_DEDUPE_MS,
  decideFollowUp,
  followUpDedupeFilter,
  followUpTaskWrites,
  matchingOpenTask,
  type FollowUpInput,
  type OpenTaskHint,
} from './follow-up-task.ts';

const NOW = new Date('2026-11-19T20:00:00.000Z');
const PHONE = '7605550142';

function call(over: Partial<FollowUpInput> = {}): FollowUpInput {
  return {
    source: 'mike',
    phone: PHONE,
    name: 'Pat Lee',
    serviceNeeded: '',
    summary: '',
    callerText: 'The pump stopped and we have no water.',
    ...over,
  };
}

function task(over: Partial<OpenTaskHint> = {}): OpenTaskHint {
  return {
    id: 'task-open',
    title: 'Follow up with Pat Lee',
    description: 'The pump stopped.\n+17605550142',
    clientName: 'Pat Lee',
    startAt: '2026-11-19T08:00:00.000Z',
    endAt: '2026-11-20T07:59:59.000Z',
    isComplete: false,
    ...over,
  };
}

test('pump, service, ambiguous, and urgent no-water go to Brian', () => {
  const cases = [
    call(),
    call({ callerText: 'Can someone come out and look at the pressure tank?' }),
    call({ callerText: 'I just need a quote.', serviceNeeded: '' }),
    call({ callerText: 'hello', summary: '', urgent: true, serviceNeeded: '' }),
    call({ callerText: '', summary: 'Caller has no water at the house.', serviceNeeded: 'Phone Inquiry' }),
  ];
  for (const input of cases) {
    const decision = decideFollowUp(input, [], NOW);
    assert.equal(decision.action, 'create', JSON.stringify(input));
    if (decision.action !== 'create') continue;
    assert.equal(decision.lane, 'pump');
    assert.equal(decision.assigneeName, 'Brian Schroeder');
    assert.equal(decision.assigneeEmail, FOLLOW_UP_ASSIGNEES.pump.email);
    assert.equal(decision.title, 'Follow up with Pat Lee');
    assert.match(decision.instructions, /\+17605550142/);
    assert.match(decision.instructions, /Do not text or email the customer/);
    assert.doesNotMatch(decision.instructions, /travis@/i);
  }
});

test('new drill, deepen, and abandon go to Damian', () => {
  const lines = [
    'We want a new well drilled.',
    'Can you drill a well on the parcel?',
    'We need to deepen the well.',
    'Looking at well abandonment.',
    'Please abandon the well.',
  ];
  for (const callerText of lines) {
    const decision = decideFollowUp(call({ callerText, summary: callerText }), [], NOW);
    assert.equal(decision.action, 'create', callerText);
    if (decision.action !== 'create') continue;
    assert.equal(decision.lane, 'drill', callerText);
    assert.equal(decision.assigneeName, 'Damian Famania');
    assert.equal(decision.assigneeEmail, FOLLOW_UP_ASSIGNEES.drill.email);
  }
});

test('skips do not assign Brian or Damian', () => {
  const skips: Array<[Partial<FollowUpInput>, string]> = [
    [{ phone: '555' }, 'no-phone'],
    [{ phone: '7608237963', callerText: 'Pump is out' }, 'test-ani'],
    [{ phone: '8773863995', callerText: 'Need a new well' }, 'test-ani'],
    [{ testCaller: true, callerText: 'Pump is out' }, 'test-ani'],
    [{ callerText: 'STOP' }, 'stop-dnc'],
    [{ callerText: 'Please do not call this number' }, 'stop-dnc'],
    [{ booked: true, callerText: 'Pump is out' }, 'already-booked'],
    [{ callerText: 'Liam at Oasis sent us over. The pump is out.' }, 'oasis-liam'],
    [{ leadSource: 'Lead source: Oasis-Liam referral', callerText: 'Need service' }, 'oasis-liam'],
    [{ callerText: 'I have a question about my invoice.' }, 'billing-only'],
    [{ callerText: 'We need a well certification for escrow.' }, 'well-certification'],
    [{ callerText: 'Can you come test the water?' }, 'water-testing'],
    [{ callerText: 'hello', summary: 'The call was only a greeting.', serviceNeeded: 'Phone Inquiry', durationSec: 4 }, 'no-ask'],
    [{ callerText: '', summary: 'No response from the caller.', serviceNeeded: '', durationSec: 30 }, 'no-ask'],
    [{ callerText: 'The caller abandoned the call.', summary: 'abandoned the call' }, 'no-ask'],
  ];
  for (const [over, reason] of skips) {
    const decision = decideFollowUp(call(over), [], NOW);
    assert.equal(decision.action, 'skip', `${reason} ${JSON.stringify(over)}`);
    if (decision.action === 'skip') assert.equal(decision.reason, reason);
  }
});

test('bill resend and send-invoice asks skip as billing-only and do not create a task', async () => {
  const phrases = [
    'resend my bill',
    'send my bill',
    'bill resent',
    'bill re-sent',
    'resend bill',
    'send the bill',
    'send me the bill',
    'my bill again',
    'please resend the invoice',
    'send my invoice',
    'resent my bill',
    'Please resend my bill. How can I help?',
  ];
  let writes = 0;
  for (const callerText of phrases) {
    const input = call({ name: 'Brian Mitchell', callerText, summary: callerText });
    const decision = decideFollowUp(input, [], NOW);
    assert.equal(decision.action, 'skip', callerText);
    if (decision.action === 'skip') assert.equal(decision.reason, 'billing-only', callerText);
    const result = await assignReceptionistFollowUp(input, {
      now: NOW,
      listRecentTasks: async () => [],
      createTask: (async () => {
        writes += 1;
        throw new Error('should not create');
      }) as never,
    });
    assert.equal(result.created, false, callerText);
    assert.equal(result.reason, 'billing-only', callerText);
    assert.equal(result.customerNotified, false, callerText);
  }
  assert.equal(writes, 0);
  const withPump = decideFollowUp(call({ callerText: 'The pump is broken. Please resend my bill.' }), [], NOW);
  assert.equal(withPump.action, 'create');
  if (withPump.action === 'create') assert.equal(withPump.lane, 'pump');
});

test('urgent no-water stays with Brian when a new well is also mentioned', () => {
  const decision = decideFollowUp(
    call({ callerText: 'We have no water. If you cannot fix the pump we may need a new well.' }),
    [],
    NOW,
  );
  assert.equal(decision.action, 'create');
  if (decision.action === 'create') assert.equal(decision.lane, 'pump');
});

test('water test or certification with a pump failure still goes to Brian', () => {
  const water = decideFollowUp(call({ callerText: 'The water test was bad and now the pump is dead.' }), [], NOW);
  const cert = decideFollowUp(call({ callerText: 'We need the well certification, and we have no water.' }), [], NOW);
  assert.equal(water.action, 'create');
  assert.equal(cert.action, 'create');
  if (water.action === 'create') assert.equal(water.lane, 'pump');
  if (cert.action === 'create') assert.equal(cert.lane, 'pump');
});

test('the company name in a greeting is not a service ask', () => {
  const silent = decideFollowUp(
    call({
      callerText: '',
      summary: 'The AI receptionist at Southern California Well Service gave a greeting and the caller hung up.',
      serviceNeeded: 'Phone Inquiry',
      durationSec: 8,
    }),
    [],
    NOW,
  );
  assert.equal(silent.action, 'skip');
  if (silent.action === 'skip') assert.equal(silent.reason, 'no-ask');
  const asked = decideFollowUp(call({ callerText: 'I need well service out here.' }), [], NOW);
  assert.equal(asked.action, 'create');
  if (asked.action === 'create') assert.equal(asked.lane, 'pump');
});

test('Desert Oasis without Liam is a normal pump call', () => {
  const decision = decideFollowUp(
    call({ callerText: 'This is Desert Oasis HOA. The pump is out.', name: 'Desert Oasis HOA' }),
    [],
    NOW,
  );
  assert.equal(decision.action, 'create');
  if (decision.action === 'create') assert.equal(decision.lane, 'pump');
});

test('dedupes an hourly Follow up task for the same phone inside 48 hours', () => {
  const decision = decideFollowUp(call(), [task()], NOW);
  assert.equal(decision.action, 'skip');
  if (decision.action === 'skip') {
    assert.equal(decision.reason, 'duplicate-open-task');
    assert.equal(decision.existingTaskId, 'task-open');
  }
});

test('dedupes the same name when the open task has no phone, and ignores a different phone', () => {
  const byName = matchingOpenTask(
    [task({ description: 'Hourly catch-up. No number on the task.', title: 'Follow up with Pat Lee' })],
    call(),
    NOW,
  );
  assert.equal(byName?.id, 'task-open');
  const otherPhone = matchingOpenTask(
    [task({ description: 'Different person\n+17605550999', title: 'Follow up with Pat Lee', clientName: 'Pat Lee' })],
    call(),
    NOW,
  );
  assert.equal(otherPhone, null);
});

test('an open task outside 48 hours does not block a new one', () => {
  const old = task({
    startAt: new Date(NOW.getTime() - FOLLOW_UP_DEDUPE_MS - 60_000).toISOString(),
    endAt: new Date(NOW.getTime() - FOLLOW_UP_DEDUPE_MS - 30_000).toISOString(),
  });
  const decision = decideFollowUp(call(), [old], NOW);
  assert.equal(decision.action, 'create');
  const done = task({ isComplete: true });
  assert.equal(decideFollowUp(call(), [done], NOW).action, 'create');
});

test('dedupe filter is a read-only 48-hour dated open-task window', () => {
  assertReadOnlyTaskQuery(LIST_TASKS_QUERY);
  const filter = followUpDedupeFilter(NOW);
  assert.equal(filter.scheduleItemType, 'BASIC_TASK');
  assert.equal(filter.status, 'REMAINING');
  assert.equal(filter.includeUnscheduled, false);
  assert.equal(filter.assignedTo, undefined);
  const span = Date.parse(filter.occursWithin.endAt) - Date.parse(filter.occursWithin.startAt);
  assert.equal(span, FOLLOW_UP_DEDUPE_MS * 2);
});

test('writes are taskCreate only', () => {
  assert.deepEqual(followUpTaskWrites(), ['taskCreate']);
});

const BRIAN: JobberUserSummary = {
  id: 'user-brian',
  name: 'Brian Schroeder',
  firstName: 'Brian',
  lastName: 'Schroeder',
  email: 'bschroeder@scwellservice.com',
  status: 'ACTIVATED',
};
const DAMIAN: JobberUserSummary = {
  id: 'user-damian',
  name: 'Damian Famania ',
  firstName: 'Damian',
  lastName: 'Famania',
  email: 'damian@scwellservice.com',
  status: 'ACTIVATED',
};
const TRAVIS: JobberUserSummary = {
  id: 'user-travis',
  name: 'Travis C Sego',
  firstName: 'Travis',
  lastName: 'Sego',
  email: 'travis@scwellservice.com',
  status: 'ACTIVATED',
};

test('create assigns Brian or Damian, dryRun false, and does not notify', async () => {
  const seen: Array<ReturnType<typeof buildTaskCreateVariables>> = [];
  const pump = await assignReceptionistFollowUp(call(), {
    now: NOW,
    listUsers: async () => ({ users: [TRAVIS, BRIAN, DAMIAN], truncated: false }),
    listRecentTasks: async () => [],
    createTask: async (payload) => {
      const variables = buildTaskCreateVariables(payload);
      seen.push(variables);
      assert.equal(payload.dryRun, false);
      return {
        status: 'created',
        dryRun: false,
        notified: false,
        emailAssignments: false,
        mutation: 'taskCreate',
        id: 'task-new',
        title: payload.title,
        instructions: payload.instructions,
        assignees: [{ id: payload.assigneeIds[0], name: 'Brian Schroeder' }],
        client: null,
        property: null,
        startAt: null,
        endAt: null,
        userErrors: [],
        readError: null,
        audit: { console: true, supabase: false },
      };
    },
  });
  assert.equal(pump.created, true);
  assert.equal(pump.assigneeName, 'Brian Schroeder');
  assert.equal(pump.customerNotified, false);
  assert.equal(pump.dedupeChecked, true);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].input.assignedTo, ['user-brian']);
  assert.equal(seen[0].input.emailAssignments, false);
  assert.equal('teamReminderOffset' in seen[0].input, false);
  assert.equal(seen[0].input.title, 'Follow up with Pat Lee');

  const drill = await assignReceptionistFollowUp(call({ callerText: 'Please drill a new well.' }), {
    now: NOW,
    listUsers: async () => ({ users: [BRIAN, DAMIAN], truncated: false }),
    listRecentTasks: async () => [],
    createTask: async (payload) => {
      assert.deepEqual(payload.assigneeIds, ['user-damian']);
      assert.equal(payload.dryRun, false);
      return {
        status: 'created',
        dryRun: false,
        notified: false,
        emailAssignments: false,
        mutation: 'taskCreate',
        id: 'task-drill',
        title: payload.title,
        instructions: payload.instructions,
        assignees: [{ id: 'user-damian', name: 'Damian Famania' }],
        client: null,
        property: null,
        startAt: null,
        endAt: null,
        userErrors: [],
        readError: null,
        audit: { console: true, supabase: false },
      };
    },
  });
  assert.equal(drill.created, true);
  assert.equal(drill.lane, 'drill');
  assert.equal(drill.customerNotified, false);
});

test('skip and duplicate do not call taskCreate', async () => {
  let writes = 0;
  const createTask = async () => {
    writes += 1;
    throw new Error('should not create');
  };
  const skip = await assignReceptionistFollowUp(call({ callerText: 'Just calling about an invoice.' }), {
    now: NOW,
    listRecentTasks: async () => [],
    createTask: createTask as never,
  });
  assert.equal(skip.created, false);
  assert.equal(skip.reason, 'billing-only');
  const duplicate = await assignReceptionistFollowUp(call(), {
    now: NOW,
    listRecentTasks: async () => [task()],
    createTask: createTask as never,
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.reason, 'duplicate-open-task');
  assert.equal(duplicate.taskId, 'task-open');
  assert.equal(writes, 0);
});

test('a failed dedupe read still creates, and a missing assignee does not', async () => {
  let writes = 0;
  const created = await assignReceptionistFollowUp(call(), {
    now: NOW,
    listUsers: async () => ({ users: [BRIAN], truncated: false }),
    listRecentTasks: async () => {
      throw new Error('throttled');
    },
    createTask: async (payload) => {
      writes += 1;
      assert.equal(payload.dryRun, false);
      return {
        status: 'created',
        dryRun: false,
        notified: false,
        emailAssignments: false,
        mutation: 'taskCreate',
        id: 'task-anyway',
        title: payload.title,
        instructions: payload.instructions,
        assignees: [],
        client: null,
        property: null,
        startAt: null,
        endAt: null,
        userErrors: [],
        readError: null,
        audit: { console: true, supabase: false },
      };
    },
  });
  assert.equal(created.created, true);
  assert.equal(created.dedupeChecked, false);
  assert.equal(writes, 1);

  const missing = await assignReceptionistFollowUp(call(), {
    now: NOW,
    listUsers: async () => ({ users: [TRAVIS], truncated: false }),
    listRecentTasks: async () => [],
    createTask: async () => {
      writes += 1;
      throw new Error('should not create');
    },
  });
  assert.equal(missing.created, false);
  assert.equal(missing.reason, 'assignee-not-found');
  assert.equal(writes, 1);
});

test('mike and sarah webhooks do not insert public.tasks or look up Travis', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  for (const relative of ['src/app/api/receptionist/webhook/route.ts', 'src/app/api/receptionist/sarah/route.ts']) {
    const source = readFileSync(join(root, relative), 'utf8');
    assert.equal(source.includes("from('tasks')"), false, relative);
    assert.equal(source.includes('from("tasks")'), false, relative);
    assert.equal(source.includes('travis@scwellservice.com'), false, relative);
    assert.match(source, /assignReceptionistFollowUp/);
  }
  const jobber = readFileSync(join(root, 'src/lib/receptionist/follow-up-task-jobber.ts'), 'utf8');
  assert.equal(jobber.includes('sendEmail'), false);
  assert.equal(jobber.includes('twilio'), false);
  assert.match(jobber, /dryRun: false/);
  assert.match(jobber, /emailAssignments/);
});
