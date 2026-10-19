import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReceptionistTestCaller, testToolResult } from './test-call.ts';

test('test callers are only our own test lines', () => {
  assert.equal(isReceptionistTestCaller('+17608237963'), true);
  assert.equal(isReceptionistTestCaller('18773863995'), true);
  assert.equal(isReceptionistTestCaller('+17604915348'), false);
  assert.equal(isReceptionistTestCaller('+19515550188'), false);
  assert.equal(isReceptionistTestCaller(''), false);
});

test('side-effect tools are simulated, read-only tools run for real', () => {
  const b = testToolResult('book_job', { startAt: '2026-10-21T15:00:00.000Z' }) as any;
  assert.equal(b.result.booked, true);
  assert.equal(b.result.testMode, true);
  assert.equal(b.result.visit.startAt, '2026-10-21T15:00:00.000Z');
  assert.equal((testToolResult('createCallback') as any).result.success, true);
  assert.equal((testToolResult('flagEmergency') as any).result.success, true);
  assert.equal((testToolResult('sendPayLink') as any).result.success, false);
  for (const n of ['lookupCustomer', 'checkSchedule', 'checkServiceArea', 'getBusinessHours', 'getServiceInfo']) assert.equal(testToolResult(n), null);
});
