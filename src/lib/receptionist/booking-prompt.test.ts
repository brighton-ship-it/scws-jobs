import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BOOK_JOB_TOOL, MIKE_CALLBACK_BOOKING, SARAH_AFTER_HOURS_BOOKING, withCallbackBookingPrompt } from './booking-prompt.ts';

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

  it('tells callback Mike to book a $200 service call instead of troubleshooting or taking a message', () => {
    assert.match(MIKE_CALLBACK_BOOKING, /\$200 service call/);
    assert.match(MIKE_CALLBACK_BOOKING, /what's going on with their well/i);
    assert.match(MIKE_CALLBACK_BOOKING, /do not troubleshoot/i);
    assert.match(MIKE_CALLBACK_BOOKING, /two earliest times/i);
    assert.match(MIKE_CALLBACK_BOOKING, /call no tools/);
    assert.match(MIKE_CALLBACK_BOOKING, /bookJob/);
    assert.match(MIKE_CALLBACK_BOOKING, /Do not take a message/);
    assert.match(MIKE_CALLBACK_BOOKING, /when openSlots has times/);
    assert.match(MIKE_CALLBACK_BOOKING, /\{\{customerPhone\}\}/);
    assert.match(MIKE_CALLBACK_BOOKING, /Wait for them to speak first/);
    assert.match(MIKE_CALLBACK_BOOKING, /returning your call\. What's going on with your well/);
    assert.match(MIKE_CALLBACK_BOOKING, /one or two short sentences/);
    assert.match(MIKE_CALLBACK_BOOKING, /Never a third sentence/);
    assert.match(MIKE_CALLBACK_BOOKING, /say these two sentences/);
    assert.match(MIKE_CALLBACK_BOOKING, /Never say the customer's name/);
    assert.match(MIKE_CALLBACK_BOOKING, /What town is the well in/);
    assert.match(MIKE_CALLBACK_BOOKING, /any water at all/);
    assert.match(MIKE_CALLBACK_BOOKING, /no second greeting/);
    assert.match(MIKE_CALLBACK_BOOKING, /do not sound like you are shouting/i);
    assert.match(MIKE_CALLBACK_BOOKING, /a little slower than a conversational pace/);
    assert.match(MIKE_CALLBACK_BOOKING, /short natural pause between sentences/);
    assert.doesNotMatch(MIKE_CALLBACK_BOOKING, /one short greeting may play/);
    assert.match(MIKE_CALLBACK_BOOKING, /call checkSchedule immediately/i);
    assert.match(MIKE_CALLBACK_BOOKING, /Is \[the address\] right/);
    assert.match(MIKE_CALLBACK_BOOKING, /failed twice/);
    assert.match(MIKE_CALLBACK_BOOKING, /caller declines/);
    assert.match(MIKE_CALLBACK_BOOKING, /Do not createCallback on the first failure/);
    assert.doesNotMatch(MIKE_CALLBACK_BOOKING, /Only if checkSchedule returns no openSlots/);
    const combined = withCallbackBookingPrompt('## STEP ZERO\nLook up the caller.');
    assert.match(combined, /overrides STEP ZERO/);
    assert.ok(combined.indexOf('Missed-call callback') < combined.indexOf('STEP ZERO'));
  });
});
