import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesCallSearch } from './call-search.ts';

const nathan = { name: 'Sharon Johnson', phones: ['+19515913295', '(•••) •••-3295'] };

test('full number in any format matches by last 10 digits', () => {
  for (const q of ['(951) 591-3295', '951-591-3295', '9515913295', '+1 951 591 3295', '19515913295']) assert.equal(matchesCallSearch(nathan, q), true, q);
  assert.equal(matchesCallSearch(nathan, '(951) 591-3296'), false);
});

test('last 4 digits match, including the masked display number', () => {
  assert.equal(matchesCallSearch(nathan, '3295'), true);
  assert.equal(matchesCallSearch({ phones: ['(•••) •••-3295'] }, '3295'), true);
  assert.equal(matchesCallSearch(nathan, '1234'), false);
});

test('name text matches case-insensitively; empty query matches all', () => {
  assert.equal(matchesCallSearch(nathan, 'sharon'), true);
  assert.equal(matchesCallSearch(nathan, 'Nathan'), false);
  assert.equal(matchesCallSearch(nathan, '  '), true);
});
