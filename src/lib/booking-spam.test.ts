import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGibberish } from './booking-spam.ts';
test('real short addresses pass', () => {
  for (const a of ['123 Hwy 79', '1077 Main St 92065', '1077 Main St Unit B', '57174 US Hwy 79, Anza, CA 92539', '22 N Fwy Rd', '3434 Old Julian Hwy', '24820 Hwy 78 Ste 5']) assert.equal(isGibberish(a, 'address'), false, a);
});
test('real names pass', () => {
  for (const n of ['Test Verification', 'Bryn Wyndt', 'Mimi Ngyen', 'Christopher Casas', 'Josh Sims', "D'Andre McKnight"]) assert.equal(isGibberish(n), false, n);
});
test('bot strings are caught', () => {
  for (const s of ['xKzqTvbWpLmR', 'qwrtplkjhgfdsz', 'bcdfghjklmnp 123', 'aBcDeFgHiJkL']) assert.equal(isGibberish(s) || isGibberish(s, 'address'), true, s);
});
