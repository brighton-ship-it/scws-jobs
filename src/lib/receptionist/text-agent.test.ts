import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTextAgent, scrubReply, offeredStarts, FALLBACK_REPLY, TOOL_RESULT_CHARS, type ChatModel, type ThreadMessage } from './text-agent.ts';

const NOW = new Date('2026-10-19T17:00:00Z');
function scripted(steps: Array<any>): ChatModel {
  let i = 0;
  return { complete: async () => steps[Math.min(i++, steps.length - 1)] };
}
const SLOT = '2026-10-20T15:00:00.000Z';
function tools(log: string[]) {
  return {
    lookupCustomer: async () => { log.push('lookup'); return { result: { found: false } }; },
    checkServiceArea: async () => { log.push('area'); return { result: { inServiceArea: true } }; },
    checkSchedule: async () => { log.push('schedule'); return { result: { openSlots: [{ startAt: SLOT, date: 'Tuesday, October 20', time: '8–10 AM', technician: 'Brian Eads' }] } }; },
    bookJob: async (i: any) => { log.push(`book:${i.startAt}`); return { result: { booked: true, canConfirm: true } }; },
    handOff: async (i: any) => { log.push(`handoff:${i.urgent}`); return { ok: true }; },
  };
}
const tc = (id: string, name: string, args: object) => ({ id, function: { name, arguments: JSON.stringify(args) } });

describe('runTextAgent', () => {
  it('refuses to book a slot that check_schedule never offered', async () => {
    const log: string[] = [];
    const model = scripted([
      { tool_calls: [tc('1', 'book_job', { name: 'A B', address: '1 Main', town: 'Ramona', startAt: '2026-10-19T18:00:00Z', problem: 'no water' })] },
      { content: 'Let me check the schedule first.' },
    ]);
    const r = await runTextAgent({ phone: '+16195550142', inbound: 'book me today', thread: [], now: NOW, model, tools: tools(log) });
    assert.equal(r.booked, false);
    assert.ok(!log.some((l) => l.startsWith('book:')));
    assert.match(r.thread.find((m) => m.name === 'book_job')!.content, /slot_not_offered/);
  });
  it('books only an offered slot, once', async () => {
    const log: string[] = [];
    const model = scripted([
      { tool_calls: [tc('1', 'check_schedule', { address: '1 Main', town: 'Ramona' })] },
      { tool_calls: [tc('2', 'book_job', { name: 'A B', address: '1 Main', town: 'Ramona', startAt: SLOT, problem: 'no water' }), tc('3', 'book_job', { name: 'A B', address: '1 Main', town: 'Ramona', startAt: SLOT, problem: 'again' })] },
      { content: "You're all set for Tuesday 8–10 AM with Brian. That's the $200 service call." },
    ]);
    const r = await runTextAgent({ phone: '+16195550142', inbound: 'yes tuesday works', thread: [], now: NOW, model, tools: tools(log) });
    assert.equal(r.booked, true);
    assert.equal(log.filter((l) => l.startsWith('book:')).length, 1);
    assert.match(r.reply, /\$200/);
  });
  it('falls back to the office when the model fails', async () => {
    const log: string[] = [];
    const model: ChatModel = { complete: async () => { throw new Error('down'); } };
    const r = await runTextAgent({ phone: '+16195550142', inbound: 'hello?', thread: [], now: NOW, model, tools: tools(log) });
    assert.equal(r.reply, FALLBACK_REPLY);
    assert.equal(r.handedOff, true);
    assert.deepEqual(log, ['handoff:false']);
  });
  it('scrubs prices other than $100/$200/$300 and caps length', () => {
    assert.equal(scrubReply('A pump is $2,500 and the visit is $200.'), 'A pump is a price and the visit is $200.');
    assert.equal(scrubReply('The first visit adds $100 for the drive.'), 'The first visit adds $100 for the drive.');
    assert.ok(scrubReply('x'.repeat(500)).length <= 320);
  });
  it('offeredStarts reads earlier check_schedule results in the thread', () => {
    const s = offeredStarts([{ role: 'tool', name: 'check_schedule', content: JSON.stringify({ openSlots: [{ startAt: SLOT }] }), at: '' }]);
    assert.ok(s.has(SLOT));
  });
});

const OFFERED = '2026-11-28T16:00:00.000Z';
const VISIT = '2026-11-01T16:00:00.000Z';
const INVENTED = '2026-12-01T16:00:00.000Z';

function offeredSlot(startAt: string) {
  return {
    startAt,
    endAt: '2026-11-28T18:00:00.000Z',
    date: 'Saturday, November 28',
    time: 'between 8:00 AM and 10:00 AM',
    technician: 'Jeremiah Biliunas',
    technicianId: 'user-jeremiah',
    slotId: startAt,
  };
}

/** Slots sit after a long field so the 4,000-character store drops every offered startAt. */
function longSchedule(startAt: string) {
  return {
    result: {
      lookupStatus: 'ok',
      found: true,
      hasAppointments: true,
      canConfirm: true,
      visits: [{ startAt: VISIT, endAt: null, allDay: false, service: 'Service Call', address: '9 Old Well Rd, Ramona', technicians: ['Brian Eads'], date: 'Sunday, November 1', time: '8:00 AM' }],
      message: 'Existing visit on file.',
      confirmationRule: 'Confirm only listed visits.',
      detail: 'd'.repeat(4500),
      mayBook: true,
      openSlots: [offeredSlot(startAt)],
      availableSlots: [offeredSlot(startAt)],
      bookingMessage: 'I have 1 open Jobber slot for a $200 service call.',
    },
  };
}

function longTools(log: string[]) {
  const base = tools(log);
  return {
    ...base,
    checkSchedule: async () => {
      log.push('schedule');
      return longSchedule(OFFERED);
    },
  };
}

function capturing(steps: Array<any>, seen: any[][]): ChatModel {
  let i = 0;
  return {
    complete: async (input) => {
      seen.push(input.messages);
      return steps[Math.min(i++, steps.length - 1)];
    },
  };
}

async function threadAfterLongSchedule(): Promise<ThreadMessage[]> {
  const model = scripted([
    { tool_calls: [tc('1', 'check_schedule', { address: '1 Main', town: 'Ramona' })] },
    { content: 'I can do Saturday, November 28, between 8:00 AM and 10:00 AM with Jeremiah Biliunas. That is a $200 service call.' },
  ]);
  const r = await runTextAgent({
    phone: '+16195550142', inbound: 'No water', thread: [], now: NOW, model, tools: longTools([]),
  });
  return r.thread;
}

describe('book_job after a trimmed check_schedule result', () => {
  it('books the offered slot when the customer accepts and the stored JSON was cut past 4000 characters', async () => {
    const thread = await threadAfterLongSchedule();
    const stored = thread.find((m) => m.name === 'check_schedule')!;
    const full = JSON.stringify(longSchedule(OFFERED).result);
    assert.ok(full.length > TOOL_RESULT_CHARS);
    assert.equal(stored.content.length, TOOL_RESULT_CHARS);
    assert.equal(stored.content.includes(OFFERED), false);
    assert.ok(stored.content.includes(VISIT));
    assert.throws(() => JSON.parse(stored.content));
    assert.deepEqual(stored.offeredStartAts, [OFFERED]);

    const seen: any[][] = [];
    const log: string[] = [];
    const model = capturing([
      { tool_calls: [tc('2', 'book_job', { name: 'A B', address: '1 Main', town: 'Ramona', startAt: OFFERED, problem: 'no water' })] },
      { content: "You're booked Saturday, November 28, between 8:00 AM and 10:00 AM with Jeremiah Biliunas. That's a $200 service call. If anything changes, just call or text us." },
    ], seen);
    const booked = await runTextAgent({
      phone: '+16195550142',
      inbound: 'Yes',
      thread,
      now: new Date('2026-11-27T17:45:00.000Z'),
      model,
      tools: longTools(log),
    });
    assert.equal(booked.booked, true);
    assert.deepEqual(log.filter((l) => l.startsWith('book:')), [`book:${OFFERED}`]);
    assert.equal(log.includes('schedule'), false);
    assert.match(seen[0].map((m) => m.content || '').join('\n'), new RegExp(`Offered startAt values: ${OFFERED}`));
  });

  it('rejects a startAt that was not offered, including a visit time left in the trimmed text', async () => {
    const thread = await threadAfterLongSchedule();
    for (const startAt of [VISIT, INVENTED]) {
      const log: string[] = [];
      const model = scripted([
        { tool_calls: [tc('2', 'book_job', { name: 'A B', address: '1 Main', town: 'Ramona', startAt, problem: 'no water' })] },
        { content: 'That time was not one I offered. The office will reach out.' },
      ]);
      const r = await runTextAgent({
        phone: '+16195550142',
        inbound: 'Yes',
        thread,
        now: new Date('2026-11-27T17:45:00.000Z'),
        model,
        tools: longTools(log),
      });
      assert.equal(r.booked, false, startAt);
      assert.ok(!log.some((l) => l.startsWith('book:')), startAt);
      assert.match(r.thread.find((m) => m.name === 'book_job')!.content, /slot_not_offered/);
    }
  });

  it('books from a legacy trimmed check_schedule message that has no offeredStartAts list', async () => {
    const raw = JSON.stringify({
      visits: [{ startAt: VISIT }],
      openSlots: [offeredSlot(OFFERED)],
      availableSlots: [offeredSlot(OFFERED)],
      tail: 't'.repeat(5000),
    });
    const content = raw.slice(0, TOOL_RESULT_CHARS);
    assert.throws(() => JSON.parse(content));
    assert.ok(content.includes(OFFERED));
    assert.ok(content.includes(VISIT));
    const thread: ThreadMessage[] = [{ role: 'tool', name: 'check_schedule', content, at: '2026-11-27T17:44:00.000Z' }];
    const starts = offeredStarts(thread);
    assert.ok(starts.has(OFFERED));
    assert.equal(starts.has(VISIT), false);

    const seen: any[][] = [];
    const log: string[] = [];
    const model = capturing([
      { tool_calls: [tc('2', 'book_job', { name: 'A B', address: '1 Main', town: 'Ramona', startAt: OFFERED, problem: 'no water' })] },
      { content: 'You are booked Saturday between 8:00 AM and 10:00 AM with Jeremiah. That is a $200 service call.' },
    ], seen);
    const r = await runTextAgent({
      phone: '+16195550142',
      inbound: 'Yes',
      thread,
      now: new Date('2026-11-27T17:45:00.000Z'),
      model,
      tools: tools(log),
    });
    assert.equal(r.booked, true);
    assert.deepEqual(log.filter((l) => l.startsWith('book:')), [`book:${OFFERED}`]);
    assert.match(seen[0].map((m) => m.content || '').join('\n'), new RegExp(`Offered startAt values: ${OFFERED}`));
  });

  it('keeps a cut-off startAt out of the offered set and prefers the saved list over the text', () => {
    const cut = '{"visits":[{"startAt":"2026-11-01T16:00:00.000Z"}],"openSlots":[{"startAt":"2026-11-28T16:00:00.000Z"},{"startAt":"2026-11-29T16:00';
    const recovered = offeredStarts([{ role: 'tool', name: 'check_schedule', content: cut, at: '' }]);
    assert.deepEqual([...recovered], [OFFERED]);

    const saved = offeredStarts([{
      role: 'tool',
      name: 'check_schedule',
      at: '',
      content: JSON.stringify({ openSlots: [{ startAt: VISIT }] }),
      offeredStartAts: [OFFERED],
    }]);
    assert.deepEqual([...saved], [OFFERED]);

    const empty = offeredStarts([{
      role: 'tool',
      name: 'check_schedule',
      at: '',
      content: JSON.stringify({ openSlots: [{ startAt: OFFERED }] }),
      offeredStartAts: [],
    }]);
    assert.equal(empty.size, 0);
  });
});
