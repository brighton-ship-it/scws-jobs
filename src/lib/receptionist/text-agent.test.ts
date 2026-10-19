import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTextAgent, scrubReply, offeredStarts, FALLBACK_REPLY, type ChatModel } from './text-agent.ts';

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
  it('scrubs prices other than $200/$300 and caps length', () => {
    assert.equal(scrubReply('A pump is $2,500 and the visit is $200.'), 'A pump is a price and the visit is $200.');
    assert.ok(scrubReply('x'.repeat(500)).length <= 320);
  });
  it('offeredStarts reads earlier check_schedule results in the thread', () => {
    const s = offeredStarts([{ role: 'tool', name: 'check_schedule', content: JSON.stringify({ openSlots: [{ startAt: SLOT }] }), at: '' }]);
    assert.ok(s.has(SLOT));
  });
});
