import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTextAgent, scrubReply, offeredStarts, FALLBACK_REPLY, type ChatModel } from './text-agent.ts';

const NOW = new Date('2026-10-19T17:00:00Z');
function scripted(steps: Array<any>, seen?: any[][]): ChatModel {
  let i = 0;
  return {
    complete: async (input) => {
      seen?.push(input.messages);
      return steps[Math.min(i++, steps.length - 1)];
    },
  };
}
const SLOT = '2026-10-20T15:00:00.000Z';
const LATE = '2026-11-12T18:00:00.000Z';
const VISIT_MARKER = 'VISIT-PADDING-NOT-A-SLOT';
const TECH_ID_MARKER = 'TECHID-SHOULD-NOT-BE-STORED';
function tools(log: string[], schedule?: unknown) {
  return {
    lookupCustomer: async () => { log.push('lookup'); return { result: { found: false } }; },
    checkServiceArea: async () => { log.push('area'); return { result: { inServiceArea: true } }; },
    checkSchedule: async () => {
      log.push('schedule');
      return { result: schedule ?? { openSlots: [{ startAt: SLOT, date: 'Tuesday, October 20', time: '8–10 AM', technician: 'Brian Eads' }] } };
    },
    bookJob: async (i: any) => { log.push(`book:${i.startAt}`); return { result: { booked: true, canConfirm: true } }; },
    handOff: async (i: any) => { log.push(`handoff:${i.urgent}`); return { ok: true }; },
  };
}
const tc = (id: string, name: string, args: object) => ({ id, function: { name, arguments: JSON.stringify(args) } });
const bookArgs = (startAt: string) => ({ name: 'Shawn Ahringhoff', address: '1 Main', town: 'Ramona', startAt, problem: 'no water' });

/** A check_schedule payload whose raw JSON is far past 4000 chars, with the accepted slot last. */
function largeSchedule() {
  const visits = Array.from({ length: 25 }, (_, i) => ({
    startAt: `2026-08-01T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
    address: `${VISIT_MARKER} ${'x'.repeat(180)} ${i}`,
    service: 'Service Call',
    technicians: ['Brian Eads'],
    date: 'Saturday, August 1',
    time: 'between 8:00 AM and 10:00 AM',
  }));
  const filler = Array.from({ length: 36 }, (_, i) => {
    const startAt = `2026-11-${String(1 + Math.floor(i / 8)).padStart(2, '0')}T${String(8 + (i % 8)).padStart(2, '0')}:00:00.000Z`;
    return {
      startAt,
      endAt: startAt,
      date: 'Wednesday, November 11',
      time: 'between 8:00 AM and 10:00 AM',
      technician: 'Brian Eads',
      technicianId: `${TECH_ID_MARKER}-${i}`,
      slotId: startAt,
    };
  });
  const late = {
    startAt: LATE,
    endAt: '2026-11-12T20:00:00.000Z',
    date: 'Thursday, November 12',
    time: 'between 10:00 AM and 12:00 PM',
    technician: 'Jeremiah Biliunas',
    technicianId: TECH_ID_MARKER,
    slotId: LATE,
  };
  const openSlots = [...filler, late];
  return {
    visits,
    confirmationRule: 'Do not invent a time. '.repeat(80),
    message: 'Customer history '.repeat(40),
    openSlots,
    availableSlots: openSlots.map((slot) => ({ ...slot })),
    mayBook: true,
    bookingMessage: 'I have open Jobber slots for a $200 service call.',
    driveSurchargeUsd: 100,
    driveSpoken: 'The first visit adds $100 per hour of drive past 1 hour.',
    earlierSlots: [{ startAt: '2026-11-11T16:00:00.000Z', date: 'Wednesday, November 11', time: 'between 8:00 AM and 10:00 AM', technician: 'Brian Eads' }],
  };
}

async function withErrors(run: (errors: string[]) => Promise<void>) {
  const errors: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map((part) => String(part)).join(' ')); };
  try {
    await run(errors);
  } finally {
    console.error = orig;
  }
}

describe('runTextAgent', () => {
  it('refuses to book a slot that check_schedule never offered', async () => {
    const log: string[] = [];
    const startAt = '2026-10-19T18:00:00Z';
    const model = scripted([
      { tool_calls: [tc('1', 'book_job', { name: 'A B', address: '1 Main', town: 'Ramona', startAt, problem: 'no water' })] },
      { content: 'Let me check the schedule first.' },
    ]);
    const agentTools = tools(log);
    let handed: any = null;
    const handOff = agentTools.handOff;
    agentTools.handOff = async (i: any) => { handed = i; return handOff(i); };
    await withErrors(async (errors) => {
      const r = await runTextAgent({ phone: '+16195550142', inbound: 'book me today', thread: [], now: NOW, model, tools: agentTools });
      assert.equal(r.booked, false);
      assert.equal(r.handedOff, true);
      assert.ok(!log.some((l) => l.startsWith('book:')));
      assert.match(r.thread.find((m) => m.name === 'book_job')!.content, /slot_not_offered/);
      assert.match(errors.join('\n'), new RegExp(`startAt=${startAt}`));
      assert.match(errors.join('\n'), /reason=slot_not_offered/);
      assert.equal(handed.reason, 'SMS booking failed');
      assert.match(handed.summary, new RegExp(startAt));
      assert.match(handed.summary, /slot_not_offered/);
      assert.equal(handed.urgent, false);
    });
  });
  it('books only an offered slot, once', async () => {
    const log: string[] = [];
    const model = scripted([
      { tool_calls: [tc('1', 'check_schedule', { address: '1 Main', town: 'Ramona' })] },
      { tool_calls: [tc('2', 'book_job', { name: 'A B', address: '1 Main', town: 'Ramona', startAt: SLOT, problem: 'no water' }), tc('3', 'book_job', { name: 'A B', address: '1 Main', town: 'Ramona', startAt: SLOT, problem: 'again' })] },
      { content: "You're all set for Tuesday 8–10 AM with Brian. That's the $200 service call." },
    ]);
    await withErrors(async (errors) => {
      const r = await runTextAgent({ phone: '+16195550142', inbound: 'yes tuesday works', thread: [], now: NOW, model, tools: tools(log) });
      assert.equal(r.booked, true);
      assert.equal(r.handedOff, false);
      assert.equal(log.filter((l) => l.startsWith('book:')).length, 1);
      assert.equal(log.some((l) => l.startsWith('handoff:')), false);
      assert.match(r.reply, /\$200/);
      assert.equal(errors.some((line) => line.includes('book_job rejected')), false);
    });
  });
  it('books a slot from a check_schedule result larger than 4000 characters', async () => {
    const schedule = largeSchedule();
    const raw = JSON.stringify(schedule);
    assert.ok(raw.length > 4000);
    assert.equal(raw.slice(0, 4000).includes(LATE), false);
    assert.throws(() => JSON.parse(raw.slice(0, 4000)));
    const log: string[] = [];
    const offerSeen: any[][] = [];
    const offer = await runTextAgent({
      phone: '+19512339374',
      inbound: 'No water at 1 Main in Ramona',
      thread: [],
      now: NOW,
      model: scripted([
        { tool_calls: [tc('1', 'check_schedule', { address: '1 Main', town: 'Ramona' })] },
        { content: 'I can do Thursday 10am-12pm with Jeremiah. That is the $200 service call.' },
      ], offerSeen),
      tools: tools(log, schedule),
    });
    const stored = offer.thread.find((m) => m.name === 'check_schedule')!.content;
    const parsed = JSON.parse(stored);
    const offered = parsed.openSlots.find((slot: any) => slot.startAt === LATE);
    assert.ok(stored.length > 4000);
    assert.ok(stored.length < raw.length);
    assert.equal(offered.technician, 'Jeremiah Biliunas');
    assert.match(offered.date, /November 12/);
    assert.match(offered.time, /10:00 AM/);
    assert.equal(parsed.driveSurchargeUsd, 100);
    assert.ok(parsed.earlierSlots.some((slot: any) => slot.startAt === '2026-11-11T16:00:00.000Z'));
    assert.equal(stored.includes(VISIT_MARKER), false);
    assert.equal(stored.includes(TECH_ID_MARKER), false);
    assert.equal(stored.includes('confirmationRule'), false);
    const offeredToModel = JSON.stringify(offerSeen[1]);
    assert.ok(offeredToModel.includes(LATE));
    assert.equal(offeredToModel.includes(VISIT_MARKER), false);

    const acceptSeen: any[][] = [];
    const accepted = await runTextAgent({
      phone: '+19512339374',
      inbound: 'Yes, Thursday works',
      thread: offer.thread,
      now: new Date('2026-11-12T00:24:00Z'),
      model: scripted([
        { tool_calls: [tc('2', 'book_job', bookArgs(LATE))] },
        { content: 'You are booked Thursday 10am-12pm with Jeremiah. If anything changes, just call or text us.' },
      ], acceptSeen),
      tools: tools(log, schedule),
    });
    assert.equal(accepted.booked, true);
    assert.equal(accepted.handedOff, false);
    assert.ok(log.includes(`book:${LATE}`));
    assert.equal(log.filter((line) => line.startsWith('book:')).length, 1);
    assert.equal(log.some((line) => line.startsWith('handoff:')), false);
    const replay = JSON.stringify(acceptSeen[0]);
    assert.ok(replay.includes(LATE));
    assert.ok(replay.includes('Jeremiah Biliunas'));
    assert.equal(replay.includes(VISIT_MARKER), false);
  });
  it('rejects a visit time from a large schedule and hands the text to the office', async () => {
    const schedule = largeSchedule();
    const visitStart = schedule.visits[0].startAt;
    const log: string[] = [];
    const offered = await runTextAgent({
      phone: '+19512339374',
      inbound: 'No water',
      thread: [],
      now: NOW,
      model: scripted([
        { tool_calls: [tc('1', 'check_schedule', { address: '1 Main', town: 'Ramona' })] },
        { content: 'Thursday 10am-12pm with Jeremiah is open.' },
      ]),
      tools: tools(log, schedule),
    });
    const agentTools = tools(log, schedule);
    let handed: any = null;
    const handOff = agentTools.handOff;
    agentTools.handOff = async (i: any) => { handed = i; return handOff(i); };
    await withErrors(async (errors) => {
      const r = await runTextAgent({
        phone: '+19512339374',
        inbound: 'book that old visit',
        thread: offered.thread,
        now: NOW,
        model: scripted([
          { tool_calls: [tc('2', 'book_job', bookArgs(visitStart))] },
          { content: 'The office will reach out.' },
        ]),
        tools: agentTools,
      });
      assert.equal(r.booked, false);
      assert.equal(r.handedOff, true);
      assert.ok(!log.some((line) => line.startsWith('book:')));
      assert.match(r.thread.find((m) => m.name === 'book_job')!.content, /slot_not_offered/);
      assert.match(errors.join('\n'), new RegExp(`startAt=${visitStart.replace(/[.]/g, '\\.')}`));
      assert.match(errors.join('\n'), /reason=slot_not_offered/);
      assert.match(handed.summary, new RegExp(visitStart.replace(/[.]/g, '\\.')));
    });
  });
  it('hands off when the offered slot still does not book', async () => {
    const log: string[] = [];
    const agentTools = tools(log);
    agentTools.bookJob = async (i: any) => { log.push(`book:${i.startAt}`); return { result: { booked: false, error: 'slot_taken' } }; };
    let handed: any = null;
    const handOff = agentTools.handOff;
    agentTools.handOff = async (i: any) => { handed = i; return handOff(i); };
    await withErrors(async (errors) => {
      const r = await runTextAgent({
        phone: '+19512339374',
        inbound: 'Yes',
        thread: [],
        now: NOW,
        model: scripted([
          { tool_calls: [tc('1', 'check_schedule', { address: '1 Main', town: 'Ramona' })] },
          { tool_calls: [tc('2', 'book_job', bookArgs(SLOT))] },
          { content: 'The office will reach out to finish booking that.' },
        ]),
        tools: agentTools,
      });
      assert.equal(r.booked, false);
      assert.equal(r.handedOff, true);
      assert.ok(log.includes(`book:${SLOT}`));
      assert.match(r.reply, /office/i);
      assert.match(errors.join('\n'), new RegExp(`startAt=${SLOT.replace(/[.]/g, '\\.')}`));
      assert.match(errors.join('\n'), /reason=slot_taken/);
      assert.equal(handed.reason, 'SMS booking failed');
      assert.match(handed.summary, /2026-10-20T15:00:00\.000Z/);
      assert.match(handed.summary, /slot_taken/);
      assert.equal(log.filter((line) => line.startsWith('handoff:')).length, 1);
    });
  });
  it('does not hand off when a later attempt in the same text books', async () => {
    const log: string[] = [];
    const missed = '2026-10-19T18:00:00Z';
    await withErrors(async (errors) => {
      const r = await runTextAgent({
        phone: '+16195550142',
        inbound: 'yes',
        thread: [],
        now: NOW,
        model: scripted([
          { tool_calls: [tc('1', 'book_job', bookArgs(missed))] },
          { tool_calls: [tc('2', 'check_schedule', { address: '1 Main', town: 'Ramona' })] },
          { tool_calls: [tc('3', 'book_job', bookArgs(SLOT))] },
          { content: 'You are booked Tuesday 8-10 AM with Brian.' },
        ]),
        tools: tools(log),
      });
      assert.equal(r.booked, true);
      assert.equal(r.handedOff, false);
      assert.deepEqual(log.filter((line) => line.startsWith('book:')), [`book:${SLOT}`]);
      assert.equal(log.some((line) => line.startsWith('handoff:')), false);
      assert.match(errors.join('\n'), /reason=slot_not_offered/);
    });
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
    const s = offeredStarts([{ role: 'tool', name: 'check_schedule', content: JSON.stringify({ openSlots: [{ startAt: SLOT }], earlierSlots: [{ slotId: '2026-10-21T15:00:00.000Z' }] }), at: '' }]);
    assert.ok(s.has(SLOT));
    assert.ok(s.has('2026-10-21T15:00:00.000Z'));
  });
  it('refreshes a truncated saved schedule and then books the accepted slot', async () => {
    const schedule = largeSchedule();
    const cut = JSON.stringify(schedule).slice(0, 4000);
    const seen: any[][] = [];
    const log: string[] = [];
    const r = await runTextAgent({
      phone: '+19512339374',
      inbound: 'Yes, Thursday works',
      thread: [
        { role: 'assistant', content: 'I can do Thursday 10am-12pm with Jeremiah.', at: NOW.toISOString() },
        { role: 'tool', name: 'check_schedule', content: cut, at: NOW.toISOString() },
      ],
      now: NOW,
      model: scripted([
        { tool_calls: [tc('1', 'check_schedule', { address: '1 Main', town: 'Ramona' })] },
        { tool_calls: [tc('2', 'book_job', bookArgs(LATE))] },
        { content: 'You are booked Thursday 10am-12pm with Jeremiah.' },
      ], seen),
      tools: tools(log, schedule),
    });
    assert.equal(JSON.stringify(seen[0]).includes(VISIT_MARKER), false);
    assert.match(JSON.stringify(seen[0]), /Call check_schedule again/);
    assert.equal(r.booked, true);
    assert.equal(r.handedOff, false);
    assert.ok(log.includes(`book:${LATE}`));
  });
  it('offeredStarts does not scrape startAt out of a truncated check_schedule payload', () => {
    const raw = JSON.stringify(largeSchedule());
    const cut = raw.slice(0, 4000);
    assert.throws(() => JSON.parse(cut));
    assert.match(cut, /"startAt":"2026-/);
    const s = offeredStarts([{ role: 'tool', name: 'check_schedule', content: cut, at: '' }]);
    assert.equal(s.size, 0);
  });
});
