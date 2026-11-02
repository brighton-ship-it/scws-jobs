import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BOOK_JOB_TOOL, SARAH_AFTER_HOURS_BOOKING } from './booking-prompt.ts';

describe('booking prompt text', () => {
  it('no longer forbids offering Monday to weekend no-water callers', () => {
    const all = `${BOOK_JOB_TOOL.description}\n${SARAH_AFTER_HOURS_BOOKING}`;
    assert.equal(/never auto-book monday/i.test(all), false);
    assert.equal(/do not book monday/i.test(all), false);
    assert.match(all, /next weekday/i);
  });

  it('treats lost pressure today the same as no water, and confirms street and city', () => {
    const all = `${BOOK_JOB_TOOL.description}\n${SARAH_AFTER_HOURS_BOOKING}`;
    assert.match(all, /pressure is completely gone|pressure completely gone/i);
    assert.match(all, /zero or no pressure/i);
    assert.match(all, /today or ASAP/i);
    assert.match(all, /do not offer only a later weekday/i);
    assert.match(all, /confirm the street address and the city/i);
    assert.match(all, /even for an existing customer/i);
    assert.match(all, /do not assume the city from the line they called/i);
  });

  it('tells Mike how to handle a declined slot', () => {
    assert.match(SARAH_AFTER_HOURS_BOOKING, /too far out/i);
    assert.match(SARAH_AFTER_HOURS_BOOKING, /hold that spot/i);
    assert.match(SARAH_AFTER_HOURS_BOOKING, /flagEmergency (exactly )?once/i);
  });
});
