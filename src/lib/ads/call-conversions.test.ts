import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { bestWonValue, callRowLogLine, callTooRecent, e164, needsCallResend, toCallConversion, usableAdsCalls } from './call-conversions.ts';

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

describe('QA 10/22 call fixes', () => {
  it('logs last 4 only and the error code', () => {
    const line = callRowLogLine({ jobberJobId: 'J1', callerPhone: '+17605550199', callStartedAt: '2026-10-08T15:00:00.000Z', status: 'error', error: 'TOO_RECENT_CALL: msg' });
    assert.match(line, /caller=\*0199 /);
    assert.doesNotMatch(line, /7605550199/);
    assert.match(line, /error=TOO_RECENT_CALL$/);
  });
  it('drops landing-page calls and shifts unrepaired times', () => {
    const out = usableAdsCalls(
      [
        { caller_phone: '1', campaign_name: null, started_at: '2026-10-08T08:00:00Z', started_at_utc: false, call_source: 'AD', call_view_resource: 'a' },
        { caller_phone: '2', campaign_name: null, started_at: '2026-10-08T08:00:00Z', started_at_utc: true, call_source: 'AD', call_view_resource: 'b' },
        { caller_phone: '3', campaign_name: null, started_at: '2026-10-08T08:00:00Z', started_at_utc: false, call_source: 'LANDING_PAGE', call_view_resource: 'c' },
        { caller_phone: '4', campaign_name: null, started_at: '2026-10-08T08:00:00Z', started_at_utc: false, call_source: null, call_view_resource: 'd' },
      ],
      { hasUtcColumn: true, repairedLedger: new Set(['d']), repair: () => '2026-10-08T15:00:00.000Z' }
    );
    assert.equal(out.droppedLandingPage, 1);
    assert.equal(out.shifted, 1);
    assert.deepEqual(out.calls.map((c) => c.startedAt), ['2026-10-08T15:00:00.000Z', '2026-10-08T08:00:00Z', '2026-10-08T08:00:00Z']);
  });
  it('prefers invoiced over the $200 booking', () => {
    assert.deepEqual(bestWonValue({ booking: 200, approved: null, invoiced: 4122.5 }), { value: 4122.5, source: 'invoiced' });
    assert.deepEqual(bestWonValue({ booking: 200, approved: null, invoiced: null }), { value: 200, source: 'booking' });
  });
});
