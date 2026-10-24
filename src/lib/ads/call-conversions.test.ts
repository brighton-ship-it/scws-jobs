import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callValueDecision,
  callRowLogLine,
  callSendDisposition,
  callTooRecent,
  e164,
  isTerminalCallUploadError,
  needsCallResend,
  partitionCallUploads,
  TERMINAL_CALL_UPLOAD_ERRORS,
  terminalCallUploadCode,
  toCallConversion,
  usableAdsCalls,
} from './call-conversions.ts';

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
  it('waits 5 days for this job invoice, then its approved quote', () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    const call = '2026-10-08T15:00:00Z';
    const d = (iso: string, inv: number | null, q: number | null, booked = iso) =>
      callValueDecision({ ownInvoiceUsd: inv, ownQuoteUsd: q, callStartedAt: call, conversionAt: booked }, now);
    assert.deepEqual(d(call, 4122.5, 200), { kind: 'send', value: 4122.5, source: 'invoice_pretax', after5d: false });
    // booked 2 days ago (later than the call): still waiting even with a quote
    assert.deepEqual(d(call, null, 3545, '2026-10-20T12:00:00Z'), { kind: 'hold', reason: 'waiting_invoice' });
    // booked 6 days ago: quote is sent
    assert.deepEqual(d(call, null, 3545, '2026-10-16T12:00:00Z'), { kind: 'send', value: 3545, source: 'approved_quote', after5d: true });
    assert.deepEqual(d(call, null, null, '2026-10-16T12:00:00Z'), { kind: 'hold', reason: 'no_invoice_or_quote' });
    assert.deepEqual(callValueDecision({ ownInvoiceUsd: 500, callStartedAt: '2026-07-01T00:00:00Z' }, now), { kind: 'expired' });
  });
  it('keeps UNKNOWN sources and never shifts when the utc select failed', () => {
    const out = usableAdsCalls(
      [
        { caller_phone: '1', campaign_name: null, started_at: '2026-10-08T08:00:00Z', call_source: 'UNKNOWN', call_view_resource: 'a' },
        { caller_phone: '2', campaign_name: null, started_at: '2026-10-08T08:00:00Z', call_source: 'UNSPECIFIED', call_view_resource: 'b' },
      ],
      { hasUtcColumn: false, repairedLedger: new Set(), repair: () => 'SHIFTED', allowShift: false }
    );
    assert.equal(out.calls.length, 2);
    assert.equal(out.unknownSource, 2);
    assert.equal(out.shifted, 0);
    assert.ok(out.calls.every((c) => c.startedAt === '2026-10-08T08:00:00Z'));
  });
});

describe('terminal call upload rejects', () => {
  const JOB_3484 = 'Z2lkOi8vSm9iYmVyL0pvYi8xNTg1NzMxOTQ=';

  it('treats ATT and the same class as terminal, and leaves retryable codes alone', () => {
    for (const code of TERMINAL_CALL_UPLOAD_ERRORS) {
      assert.equal(isTerminalCallUploadError(`${code}: detail`), true, code);
    }
    assert.equal(
      terminalCallUploadCode('CONVERSION_NOT_COMPLIANT_WITH_ATT_POLICY: The conversion is not compliant'),
      'CONVERSION_NOT_COMPLIANT_WITH_ATT_POLICY'
    );
    for (const code of [
      'TOO_RECENT_CALL',
      'TOO_RECENT_EVENT',
      'CONVERSION_PRECEDES_CALL',
      'CONVERSION_PRECEDES_EVENT',
      'UNPARSEABLE_GCLID',
      'UNPARSEABLE_CALLERS_PHONE_NUMBER',
      'CUSTOMER_NOT_ACCEPTED_CUSTOMER_DATA_TERMS',
      'UNAUTHORIZED_CUSTOMER',
      'INVALID_CUSTOMER_FOR_CALL',
    ]) {
      assert.equal(isTerminalCallUploadError(`${code}: try again`), false, code);
    }
    assert.equal(isTerminalCallUploadError('NOT_CONVERSION_NOT_COMPLIANT_WITH_ATT_POLICY'), false);
    assert.equal(isTerminalCallUploadError(null), false);
  });

  it('does not resend #3484 and logs the quote candidate that was counted but not sent', () => {
    const sendNow = [
      { jobberJobId: 'landed-quote', valueUsd: 200, valueSource: 'approved_quote', callerPhone: '+17605550199', callStartedAt: '2026-10-08T15:00:00.000Z' },
      { jobberJobId: JOB_3484, valueUsd: 800, valueSource: 'approved_quote', callerPhone: '+17605552106', callStartedAt: '2026-09-29T15:32:26.000Z' },
    ];
    const existing = [
      { jobber_job_id: 'landed-quote', status: 'uploaded', payload: { call_upload: true }, error: null },
      {
        jobber_job_id: JOB_3484,
        status: 'error',
        error: 'CONVERSION_NOT_COMPLIANT_WITH_ATT_POLICY: The conversion is not compliant with ATT policy.',
        payload: {},
      },
    ];
    const first = partitionCallUploads(sendNow, existing);
    assert.equal(first.upload.length, 0);
    assert.equal(first.skipped.length, 2);
    assert.equal(first.skipped[0].reason, 'ALREADY_UPLOADED');
    assert.equal(first.skipped[0].promoteTerminal, false);
    assert.equal(first.skipped[1].reason, 'CONVERSION_NOT_COMPLIANT_WITH_ATT_POLICY');
    assert.equal(first.skipped[1].status, 'rejected_terminal');
    assert.equal(first.skipped[1].promoteTerminal, true);

    const lines = first.skipped.map((skip) =>
      callRowLogLine({
        jobberJobId: skip.candidate.jobberJobId,
        callerPhone: skip.candidate.callerPhone,
        callStartedAt: skip.candidate.callStartedAt,
        status: skip.status,
        error: skip.reason,
        valueUsd: skip.candidate.valueUsd,
        valueSource: skip.candidate.valueSource,
      })
    );
    assert.match(lines[0], /job=landed-quote /);
    assert.match(lines[0], /status=not_sent /);
    assert.match(lines[0], /source=approved_quote /);
    assert.match(lines[0], /error=ALREADY_UPLOADED$/);
    assert.doesNotMatch(lines[0], /7605550199/);
    assert.match(lines[1], new RegExp(`job=${JOB_3484} `));
    assert.match(lines[1], /caller=\*2106 /);
    assert.match(lines[1], /status=rejected_terminal /);
    assert.match(lines[1], /value=800 /);
    assert.match(lines[1], /error=CONVERSION_NOT_COMPLIANT_WITH_ATT_POLICY$/);

    const promoted = existing.map((row) =>
      row.jobber_job_id === JOB_3484 ? { ...row, status: 'rejected_terminal' } : row
    );
    const again = partitionCallUploads(sendNow, promoted);
    assert.equal(again.upload.length, 0);
    assert.equal(again.skipped[1].promoteTerminal, false);
    assert.equal(again.skipped[1].reason, 'CONVERSION_NOT_COMPLIANT_WITH_ATT_POLICY');
  });

  it('still uploads a retryable error and a Data Manager row that never went out as a call', () => {
    const recent = partitionCallUploads(
      [{ jobberJobId: 'recent' }],
      [{ jobber_job_id: 'recent', status: 'error', error: 'TOO_RECENT_CALL: try in 6 hours' }]
    );
    assert.deepEqual(recent.upload.map((row) => row.jobberJobId), ['recent']);
    const dm = partitionCallUploads(
      [{ jobberJobId: 'dm' }],
      [{ jobber_job_id: 'dm', status: 'uploaded', payload: {} }]
    );
    assert.equal(dm.upload.length, 1);
    assert.equal(dm.skipped.length, 0);
    assert.equal(needsCallResend({ status: 'uploaded', payload: {} }), true);
  });

  it('logs a duplicate job id instead of counting it with no reason', () => {
    const out = partitionCallUploads(
      [{ jobberJobId: 'same' }, { jobberJobId: 'same' }],
      []
    );
    assert.equal(out.upload.length, 1);
    assert.equal(out.skipped[0].reason, 'DUPLICATE_JOB');
    assert.equal(out.skipped[0].status, 'not_sent');
  });

  it('a fresh call with no ledger row is uploaded', () => {
    assert.deepEqual(callSendDisposition({ status: undefined, error: null }), { action: 'upload' });
    assert.equal(callSendDisposition({ status: 'rejected_terminal', error: null }).action, 'skip');
  });
});
