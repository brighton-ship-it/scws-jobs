import test from 'node:test';
import assert from 'node:assert/strict';
import { commsFromNodes } from './jobber-followup.ts';

test('Jobber messages count only when they have a channel and a time, on that invoice', () => {
  const parsed = commsFromNodes('C1', [
    { __typename: 'EmailMessage', id: 'e1', createdAt: '2026-10-08T18:00:00Z' },
    { __typename: 'Message', id: 't1', channel: 'SMS', sentAt: '2026-10-09T18:00:00Z' },
    { __typename: 'Message', id: 'x1', createdAt: '2026-10-10T18:00:00Z' },
    { __typename: 'EmailMessage', id: 'e2' },
  ], '5818');
  assert.equal(parsed.classified, true);
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.events[0].source, 'jobber_email');
  assert.equal(parsed.events[1].source, 'jobber_sms');
  assert.deepEqual(parsed.events[0].invoiceNumbers, ['5818']);
  assert.deepEqual(parsed.events[1].invoiceNumbers, ['5818']);
  const blank = commsFromNodes('C1', [{ __typename: 'Message', id: 'x', createdAt: '2026-10-10T18:00:00Z' }], '1');
  assert.equal(blank.classified, false);
  assert.equal(blank.events.length, 0);
});
