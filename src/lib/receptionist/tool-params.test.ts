import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBookJobParams,
  normalizeCheckScheduleParams,
  pickStartAt,
  resolveSlotFromPreference,
} from './tool-params.ts';

const slots = [
  { startAt: '2026-10-12T15:00:00.000Z', endAt: '2026-10-12T17:00:00.000Z', date: 'Monday, October 12', time: '8:00 AM', technician: 'Brian Eads', technicianId: 'b' },
  { startAt: '2026-10-12T17:00:00.000Z', endAt: '2026-10-12T19:00:00.000Z', date: 'Monday, October 12', time: '10:00 AM', technician: 'Brian Eads', technicianId: 'b' },
  { startAt: '2026-10-13T15:00:00.000Z', endAt: '2026-10-13T17:00:00.000Z', date: 'Tuesday, October 13', time: '8:00 AM', technician: 'Brian Eads', technicianId: 'b' },
];

describe('tool param aliases', () => {
  it('book_job accepts startAt or slotId (either name works)', () => {
    assert.equal(pickStartAt({ startAt: 'A' }), 'A');
    assert.equal(pickStartAt({ slotId: 'B' }), 'B');
    assert.equal(pickStartAt({ slot_id: 'C' }), 'C');
    assert.equal(pickStartAt({ startAt: 'A', slotId: 'B' }), 'A');
    assert.equal(pickStartAt({ preferredDate: '2026-10-12T15:00:00.000Z' }), '2026-10-12T15:00:00.000Z');
    assert.equal(pickStartAt({ preferredDate: '2026-10-12' }), '');
  });

  it('book_job maps callerName/reason to name/notes and falls back to call phone', () => {
    const out = normalizeBookJobParams({ callerName: 'Pat Wells', reason: 'no water', slotId: 'X' }, '+17605550100');
    assert.equal(out.name, 'Pat Wells');
    assert.equal(out.notes, 'no water');
    assert.equal(out.startAt, 'X');
    assert.equal(out.phone, '+17605550100');
  });

  it('checkSchedule defaults intent to book whenever a location is sent', () => {
    assert.equal(normalizeCheckScheduleParams({ phone: '1', city: 'Ramona' }).intent, 'book');
    assert.equal(normalizeCheckScheduleParams({ phone: '1', city: 'Ramona', intent: 'check' }).intent, 'check');
    assert.equal(normalizeCheckScheduleParams({ phone: '1' }).intent, '');
  });

  it('resolves preferredDate + preferredTime to a real open slot only when unambiguous', () => {
    assert.equal(resolveSlotFromPreference(slots, '2026-10-12', '10:00 AM'), slots[1].startAt);
    assert.equal(resolveSlotFromPreference(slots, 'Tuesday, October 13', '8 AM'), slots[2].startAt);
    assert.equal(resolveSlotFromPreference(slots, '2026-10-12', ''), '');
    assert.equal(resolveSlotFromPreference(slots, '2026-10-14', '8 AM'), '');
  });
});

import { readFileSync } from 'node:fs';

describe('debugBoard is not public', () => {
  it('normalizeCheckScheduleParams strips debugBoard', () => {
    const out = normalizeCheckScheduleParams({ phone: '1', city: 'Ramona', debugBoard: true });
    assert.equal('debugBoard' in out, false);
    assert.equal(out.intent, 'book');
  });
  it('webhook and checkSchedule no longer reference debugBoard or return board', () => {
    const route = readFileSync(new URL('../../app/api/receptionist/webhook/route.ts', import.meta.url), 'utf8');
    const cs = readFileSync(new URL('./check-schedule.ts', import.meta.url), 'utf8');
    assert.equal(/params\.debugBoard/.test(route), false);
    assert.equal(/debugBoard|board:/.test(cs), false);
  });
});
