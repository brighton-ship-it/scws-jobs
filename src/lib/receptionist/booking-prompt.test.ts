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

  it('tells Mike how to handle a declined slot', () => {
    assert.match(SARAH_AFTER_HOURS_BOOKING, /too far out/i);
    assert.match(SARAH_AFTER_HOURS_BOOKING, /hold that spot/i);
    assert.match(SARAH_AFTER_HOURS_BOOKING, /flagEmergency (exactly )?once/i);
  });
});
