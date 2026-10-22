import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTooRecent, e164, needsCallResend, toCallConversion } from './call-conversions.ts';

const click = {
  conversion_action: 'customers/1/conversionActions/2',
  conversion_date_time: '2026-10-14 21:32:33+00:00',
  conversion_value: 655,
  currency_code: 'USD' as const,
  order_id: 'job1',
};

test('builds a call conversion from caller + call start', () => {
  const c = toCallConversion('customers/1/conversionActions/9', click, { callerPhone: '(760) 555-0199', callStartedAt: '2026-10-14T18:00:05.000Z' });
  assert.deepEqual(c, {
    caller_id: '+17605550199',
    call_start_date_time: '2026-10-14 18:00:05+00:00',
    conversion_action: 'customers/1/conversionActions/9',
    conversion_date_time: '2026-10-14 21:32:33+00:00',
    conversion_value: 655,
    currency_code: 'USD',
  });
});

test('conversion never precedes the call', () => {
  const c = toCallConversion('a/9', click, { callerPhone: '7605550199', callStartedAt: '2026-10-14T22:00:00.000Z' });
  assert.equal(c?.conversion_date_time, '2026-10-14 22:01:00+00:00');
});

test('no caller or start = null', () => {
  assert.equal(toCallConversion('a/9', click, { callerPhone: null, callStartedAt: '2026-10-14T18:00:00Z' }), null);
  assert.equal(toCallConversion('a/9', click, { callerPhone: '7605550199', callStartedAt: null }), null);
  assert.equal(e164('555'), null);
});

test('6 hour wait and one-time resend', () => {
  const now = Date.parse('2026-10-14T20:00:00Z');
  assert.equal(callTooRecent({ callerPhone: 'x', callStartedAt: '2026-10-14T18:00:00Z' }, now), true);
  assert.equal(callTooRecent({ callerPhone: 'x', callStartedAt: '2026-10-14T10:00:00Z' }, now), false);
  assert.equal(needsCallResend({ status: 'uploaded', payload: {} }), true);
  assert.equal(needsCallResend({ status: 'uploaded', payload: { call_upload: true } }), false);
  assert.equal(needsCallResend({ status: 'dry_run', payload: {} }), false);
});
