import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedRecording, isAllowedReceptionistCall, isAllowedTask, cleanupExpired, PHANTOM_RECEPTIONIST_CALL_ID, PHANTOM_TASK_ID } from './test-row-cleanup.ts';

describe('test-row cleanup allowlist', () => {
  it('recordings: only CAtest* started on/after 2026-10-17 PT', () => {
    assert.equal(isAllowedRecording({ call_sid: 'CAtestnoans1', started_at: '2026-10-17T15:26:47Z' }), true);
    assert.equal(isAllowedRecording({ call_sid: 'CAtestafterhoursnow000000', started_at: '2026-10-17T18:07:26Z' }), true);
    assert.equal(isAllowedRecording({ call_sid: 'CAtest123', started_at: '2026-10-17T06:59:59Z' }), false); // 10/16 PT
    assert.equal(isAllowedRecording({ call_sid: 'CA224b87realcall', started_at: '2026-10-17T00:12:11Z' }), false); // Adnan
    assert.equal(isAllowedRecording({ call_sid: 'CAe1bef6', started_at: '2026-10-17T03:31:58Z' }), false); // 8:31 PM hang-up
    assert.equal(isAllowedRecording({ call_sid: 'CAreal', started_at: '2026-10-17T18:00:00Z' }), false);
    assert.equal(isAllowedRecording({ call_sid: 'catest1', started_at: '2026-10-17T18:00:00Z' }), false);
    assert.equal(isAllowedRecording({ call_sid: null, started_at: '2026-10-17T18:00:00Z' }), false);
    assert.equal(isAllowedRecording({ call_sid: 'CAtest1', started_at: null }), false);
  });
  it('receptionist call: only the named id, from 10/17', () => {
    assert.equal(isAllowedReceptionistCall({ id: PHANTOM_RECEPTIONIST_CALL_ID, called_at: '2026-10-17T15:22:13Z' }), true);
    assert.equal(isAllowedReceptionistCall({ id: PHANTOM_RECEPTIONIST_CALL_ID, called_at: '2026-10-16T15:22:13Z' }), false);
    assert.equal(isAllowedReceptionistCall({ id: '01a14734-x', called_at: '2026-10-17T15:22:13Z' }), false);
  });
  it('task: only the named id', () => {
    assert.equal(isAllowedTask({ id: PHANTOM_TASK_ID }), true);
    assert.equal(isAllowedTask({ id: 'other' }), false);
  });
  it('expires at 2026-10-18 00:00 PT', () => {
    assert.equal(cleanupExpired(new Date('2026-10-17T20:00:00Z')), false);
    assert.equal(cleanupExpired(new Date('2026-10-18T07:00:00Z')), true);
  });
});
