import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkOfferedDay, slotDay, type SlotDay } from './offered-day.ts';

const MONDAY = new Date('2026-11-09T19:40:00.000Z');
const WED_10 = '2026-11-11T18:00:00.000Z';

const spiegel = [
  { role: 'bot' as const, text: 'I can get someone out today Monday between 1 PM and 3 PM or Monday between 4 PM and 6 PM. Which works better for you?' },
  { role: 'user' as const, text: 'Today works. 1 to 3.' },
  { role: 'bot' as const, text: 'Just to confirm, the well is at 2266 East Mission Road out in Fallbrook?' },
  { role: 'user' as const, text: "That's correct. But actually, can we do something tomorrow maybe?" },
  { role: 'bot' as const, text: 'No problem, Clay. I have Tuesday open as well. The earliest for tomorrow is between 8 AM and 10 AM, or I can do 10 AM to 12 PM.' },
  { role: 'user' as const, text: 'Yes. How about 10 to 12?' },
  { role: 'bot' as const, text: 'Want me to hold Wednesday between 10 AM and 12 PM for you?' },
  { role: 'user' as const, text: 'Oh, no. I thought we were talking about Tuesday.' },
  { role: 'bot' as const, text: "Thanks for catching that. Tuesday's earliest is between 8 AM and 10 AM or 10 AM to 12 PM. Want me to hold Tuesday between" },
  { role: 'user' as const, text: 'Yes.' },
];

function refused(now: Date, turns: typeof spiegel, startAt = WED_10) {
  const result = checkOfferedDay({ startAt }, turns, now);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected a refusal');
  return result.result;
}

test('a Wednesday 10–12 slot says Wednesday, November 11', () => {
  const slot = slotDay(WED_10) as SlotDay;
  assert.equal(slot.weekday, 'wednesday');
  assert.equal(slot.ymd, '2026-11-11');
  assert.equal(slot.hour24, 10);
  assert.equal(slot.say, 'Wednesday, November 11, between 10:00 AM and 12:00 PM');
});

test('Spiegel: Tuesday spoken for Wednesday 10–12 is refused, and a corrected Wednesday offer is allowed', () => {
  const blocked = refused(MONDAY, spiegel);
  assert.equal(blocked.dayMismatch, true);
  assert.equal(blocked.booked, false);
  assert.equal(blocked.canConfirm, false);
  assert.match(String(blocked.message), /NOT BOOKED/);
  assert.match(String(blocked.message), /Tuesday/i);
  assert.match(String(blocked.message), /Wednesday, November 11, between 10:00 AM and 12:00 PM/);
  assert.match(String(blocked.message), /Say that label verbatim/);
  assert.match(String(blocked.message), /Do not say they are booked/);

  const corrected = checkOfferedDay({ startAt: WED_10 }, spiegel.slice(0, 7), MONDAY);
  assert.equal(corrected.ok, true);

  const verbatim = checkOfferedDay(
    { startAt: WED_10 },
    [{ role: 'bot', text: 'Wednesday, November 11, between 10:00 AM and 12:00 PM.' }],
    MONDAY,
  );
  assert.equal(verbatim.ok, true);
});

test('tomorrow is the next calendar day, and a bare yes with no spoken day is not a mismatch', () => {
  const tuesday = new Date('2026-11-10T19:40:00.000Z');
  const tomorrow = checkOfferedDay(
    { startAt: WED_10 },
    [{ role: 'bot', text: 'The earliest tomorrow is between 10 AM and 12 PM.' }],
    tuesday,
  );
  assert.equal(tomorrow.ok, true);

  const wrongTomorrow = checkOfferedDay(
    { startAt: WED_10 },
    [{ role: 'bot', text: 'The earliest for tomorrow is between 10 AM and 12 PM.' }],
    MONDAY,
  );
  assert.equal(wrongTomorrow.ok, false);

  const noDay = checkOfferedDay({ startAt: WED_10 }, [{ role: 'user', text: 'Yes, book it.' }], MONDAY);
  assert.equal(noDay.ok, true);
  assert.equal(checkOfferedDay({ startAt: WED_10 }, [], MONDAY).ok, true);

  const november10 = refused(MONDAY, [
    { role: 'bot', text: 'I can do November 10 between 10 AM and 12 PM.' },
  ]);
  assert.match(String(november10.message), /November 10/);
});

test('the book path checks the spoken day and does not turn callbacks on', () => {
  const route = readFileSync(new URL('../../app/api/receptionist/webhook/route.ts', import.meta.url), 'utf8');
  assert.match(route, /checkOfferedDay/);
  assert.equal(route.includes('MIKE_CALLBACKS_ENABLED'), false);
  const src = readFileSync(new URL('./offered-day.ts', import.meta.url), 'utf8');
  assert.equal(src.includes('api.vapi.ai'), false);
  assert.equal(src.includes('firstMessage'), false);
});
