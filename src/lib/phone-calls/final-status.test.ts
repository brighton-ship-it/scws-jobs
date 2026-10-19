import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { finalStatusPatch } from './final-status.ts';

describe('finalStatusPatch', () => {
  it('closes a call that hung up before the dial', () => {
    const p = finalStatusPatch({ CallSid: 'CA1', CallStatus: 'completed', CallDuration: '2' }, 'T');
    assert.equal(p?.dial_status, 'caller_hung_up');
    assert.equal(p?.answered, false);
    assert.equal(p?.duration_seconds, 2);
    assert.equal(p?.processing_status, 'skipped');
    assert.equal(p?.outcome, 'hung_up');
    assert.match(p!.summary, /2 seconds/);
  });
  it('ignores non-final statuses', () => {
    assert.equal(finalStatusPatch({ CallSid: 'CA1', CallStatus: 'ringing' }), null);
    assert.equal(finalStatusPatch({ CallStatus: 'completed' }), null);
  });
});
