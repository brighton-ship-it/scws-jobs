import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIngestRequest, conversionActionId, dmStatusLogLine, ingestEvents, ingestErrorMessage, offlineBatchRowLogLine, rfc3339, summarizeRequestStatus, toDataManagerEvent } from './data-manager.ts';
import { buildClickConversion } from './offline-conversion.ts';

const config = { customerId: '1234567890', loginCustomerId: null, conversionAction: 'customers/1234567890/conversionActions/7833699992' };

describe('Data Manager ingest', () => {
  it('reads the conversion action id', () => {
    assert.equal(conversionActionId(config.conversionAction), '7833699992');
    assert.equal(conversionActionId('7833699992'), '7833699992');
    assert.throws(() => conversionActionId('nope'));
  });

  it('maps a click conversion to an event (gclid, hashed ids, value, time, dedupe id)', () => {
    const c = buildClickConversion(config.conversionAction, {
      jobberJobId: 'JOB1', conversionAt: '2026-10-02T19:04:00.000Z', valueUsd: 1250,
      gclid: 'G1', gbraid: 'B1', email: ' A@B.com ', phone: '(760) 555-0101',
    })!;
    const e = toDataManagerEvent(c);
    assert.equal(e.transactionId, 'JOB1');
    assert.equal(e.eventTimestamp, '2026-10-02T19:04:00+00:00');
    assert.ok(!Number.isNaN(Date.parse(e.eventTimestamp)));
    assert.equal(e.conversionValue, 1250);
    assert.equal(e.conversionCount, 1);
    assert.equal(e.eventSource, 'WEB');
    assert.equal(e.currency, 'USD');
    assert.deepEqual(e.adIdentifiers, { gclid: 'G1' });
    assert.equal(e.userData!.userIdentifiers.length, 2);
    assert.match(e.userData!.userIdentifiers[0].emailAddress!, /^[0-9a-f]{64}$/);
    assert.match(e.userData!.userIdentifiers[1].phoneNumber!, /^[0-9a-f]{64}$/);
  });

  it('phone-only (ads call) events carry no ad identifiers', () => {
    const c = buildClickConversion('7833699992', { jobberJobId: 'J2', conversionAt: '2026-09-18T22:03:00Z', valueUsd: 200, phone: '7605550101' })!;
    const e = toDataManagerEvent(c);
    assert.equal(e.adIdentifiers, undefined);
    assert.deepEqual(Object.keys(e.userData!.userIdentifiers[0]), ['phoneNumber']);
  });

  it('builds the destination and hex encoding; login account only when different', () => {
    const c = buildClickConversion('7833699992', { jobberJobId: 'J', conversionAt: '2026-09-18T22:03:00Z', valueUsd: 200, phone: '7605550101', eventSource: 'PHONE' })!;
    const req = buildIngestRequest(config, [c]) as any;
    assert.deepEqual(req.destinations, [{ operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1234567890' }, productDestinationId: '7833699992' }]);
    assert.equal(req.encoding, 'HEX');
    assert.equal(req.validateOnly, false);
    assert.deepEqual(req.consent, { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' });
    assert.equal(req.events[0].conversionCount, 1);
    assert.equal(req.events[0].eventSource, 'PHONE');
    const mcc = buildIngestRequest({ ...config, loginCustomerId: '999' }, [c], { validateOnly: true }) as any;
    assert.deepEqual(mcc.destinations[0].loginAccount, { accountType: 'GOOGLE_ADS', accountId: '999' });
    assert.equal(mcc.validateOnly, true);
    assert.throws(() => buildIngestRequest({ ...config, conversionAction: null }, [c]), /not set/);
  });

  it('posts to events:ingest without a developer token and returns ok/status/body', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ requestId: 'r1' }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = buildClickConversion('7833699992', { jobberJobId: 'J', conversionAt: '2026-09-18T22:03:00Z', valueUsd: 200, phone: '7605550101' })!;
    const res = await ingestEvents(config, [c], fake, 'tok');
    assert.equal(res.ok, true);
    assert.deepEqual(res.body, { requestId: 'r1' });
    assert.equal(seen!.url, 'https://datamanager.googleapis.com/v1/events:ingest');
    const h = seen!.init.headers as Record<string, string>;
    assert.equal(h.Authorization, 'Bearer tok');
    assert.equal(h['developer-token'], undefined);
  });

  it('formats a rejected request', () => {
    assert.equal(
      ingestErrorMessage(403, { error: { status: 'PERMISSION_DENIED', message: 'Request had insufficient authentication scopes.' } }),
      'Data Manager ingest HTTP 403 PERMISSION_DENIED: Request had insufficient authentication scopes.'
    );
    assert.equal(rfc3339('2026-09-18 22:03:00+00:00'), '2026-09-18T22:03:00+00:00');
  });

  it('reads per-destination processing status, which is not the ingest HTTP status', () => {
    const partial = summarizeRequestStatus(
      {
        requestStatusPerDestination: [
          {
            requestStatus: 'PARTIAL_SUCCESS',
            errorInfo: { errorCounts: [{ recordCount: '1', reason: 'PROCESSING_ERROR_REASON_INVALID_GCLID' }] },
            eventsIngestionStatus: { recordCount: '7' },
          },
        ],
      },
      '232123f3-91f2-4eb9-9417-477717a1f018'
    );
    assert.equal(partial.status, 'PARTIAL_SUCCESS');
    assert.equal(partial.recordCount, 7);
    assert.deepEqual(partial.errors, [{ reason: 'PROCESSING_ERROR_REASON_INVALID_GCLID', recordCount: 1 }]);
    const ok = summarizeRequestStatus(
      { requestStatusPerDestination: [{ requestStatus: 'SUCCESS', eventsIngestionStatus: { recordCount: '11' } }] },
      'a6fc9385-36e4-4636-9e6c-0d92d227a755'
    );
    assert.equal(ok.status, 'SUCCESS');
    assert.equal(ok.errors.length, 0);
    assert.match(dmStatusLogLine(ok), /requestId=a6fc9385-36e4-4636-9e6c-0d92d227a755 status=SUCCESS records=11 errors=none/);
  });

  it('logs each offline batch row as yes/no match keys plus the request id', () => {
    const withClick = buildClickConversion('7833699992', {
      jobberJobId: 'Z2lkOi8vSm9iYmVyL0pvYi8x',
      conversionAt: '2026-09-18T22:03:00Z',
      valueUsd: 800,
      gclid: 'SECRET_GCLID_DO_NOT_LOG',
      email: 'secret.person@example.com',
      phone: '7605552106',
    })!;
    const line = offlineBatchRowLogLine({
      jobId: withClick.order_id,
      conversion: withClick,
      requestId: '02e097a9-8858-44b2-8288-e584c9ddd9f4',
    });
    assert.equal(
      line,
      '[ads_offline] offline row job=Z2lkOi8vSm9iYmVyL0pvYi8x gclid=yes gbraid=no wbraid=no hashed_email=yes hashed_phone=yes requestId=02e097a9-8858-44b2-8288-e584c9ddd9f4'
    );
    assert.doesNotMatch(line, /SECRET_GCLID_DO_NOT_LOG/);
    assert.doesNotMatch(line, /secret\.person@example\.com/);
    assert.doesNotMatch(line, /7605552106/);
    assert.doesNotMatch(line, /[0-9a-f]{64}/);

    const braid = buildClickConversion('7833699992', {
      jobberJobId: 'job-braid',
      conversionAt: '2026-09-18T22:03:00Z',
      valueUsd: 200,
      gbraid: 'SECRET_GBRAID',
    })!;
    assert.match(offlineBatchRowLogLine({ jobId: 'job-braid', conversion: braid, requestId: null }), /gclid=no gbraid=yes wbraid=no hashed_email=no hashed_phone=no requestId=none$/);
    assert.doesNotMatch(offlineBatchRowLogLine({ jobId: 'job-braid', conversion: braid, requestId: '  ' }), /SECRET_GBRAID/);

    const wbraid = buildClickConversion('7833699992', {
      jobberJobId: 'job-w',
      conversionAt: '2026-09-18T22:03:00Z',
      valueUsd: 200,
      wbraid: 'SECRET_WBRAID',
      phone: '7605550101',
    })!;
    assert.match(
      offlineBatchRowLogLine({ jobId: 'job-w', conversion: wbraid, requestId: 'req-1' }),
      /gclid=no gbraid=no wbraid=yes hashed_email=no hashed_phone=yes requestId=req-1$/
    );
    assert.doesNotMatch(offlineBatchRowLogLine({ jobId: 'job-w', conversion: wbraid, requestId: 'req-1' }), /SECRET_WBRAID/);
  });
});
