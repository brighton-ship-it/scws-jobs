import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesCallSearch } from './call-search.ts';

const nathan = { name: 'Sharon Johnson', phones: ['+19515913295', '(•••) •••-3295'] };

test('full number in any format matches by last 10 digits', () => {
  for (const q of ['(951) 591-3295', '951-591-3295', '9515913295', '+1 951 591 3295', '19515913295', '1 951 591 3295', '+1 (951) 591-3295']) assert.equal(matchesCallSearch(nathan, q), true, q);
  assert.equal(matchesCallSearch(nathan, '(951) 591-3296'), false);
});

test('last 4 digits match as suffix, including the masked display number', () => {
  assert.equal(matchesCallSearch(nathan, '3295'), true);
  assert.equal(matchesCallSearch({ phones: ['(•••) •••-3295'] }, '3295'), true);
  assert.equal(matchesCallSearch(nathan, '1234'), false);
  assert.equal(matchesCallSearch(nathan, '5913'), false);
});

test('partials need 3+ digits; leading 1 country code is ignored', () => {
  assert.equal(matchesCallSearch(nathan, '9'), false);
  assert.equal(matchesCallSearch(nathan, '95'), false);
  assert.equal(matchesCallSearch(nathan, '951'), true);
  assert.equal(matchesCallSearch(nathan, '591-3295'), true);
  assert.equal(matchesCallSearch(nathan, '1 951 591'), true);
  assert.equal(matchesCallSearch(nathan, '760'), false);
});

test('name text matches case- and accent-insensitively; empty query matches all', () => {
  assert.equal(matchesCallSearch(nathan, 'sharon'), true);
  assert.equal(matchesCallSearch(nathan, 'Nathan'), false);
  assert.equal(matchesCallSearch({ name: 'José Núñez' }, 'jose nunez'), true);
  assert.equal(matchesCallSearch({ name: 'Jose Nunez' }, 'José'), true);
  assert.equal(matchesCallSearch(nathan, '  '), true);
});
