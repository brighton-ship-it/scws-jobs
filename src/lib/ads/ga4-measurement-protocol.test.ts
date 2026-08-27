import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookJobPayload, FORBIDDEN_ADS_LABELS } from './book-job.ts';
import { sendBookJobEvent } from './ga4-measurement-protocol.ts';

const ORIGINAL_SECRET = process.env.GA4_MP_API_SECRET;
const ORIGINAL_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.GA4_MP_API_SECRET;
  else process.env.GA4_MP_API_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_MEASUREMENT_ID === undefined) delete process.env.GA4_MEASUREMENT_ID;
  else process.env.GA4_MEASUREMENT_ID = ORIGINAL_MEASUREMENT_ID;
});

describe('sendBookJobEvent', () => {
  it('skips the network call when GA4_MP_API_SECRET is missing', async () => {
    delete process.env.GA4_MP_API_SECRET;
    let called = false;
    const result = await sendBookJobEvent(
      buildBookJobPayload({ jobberJobId: 'job-1' }),
      async () => {
        called = true;
        return new Response(null, { status: 204 });
      }
    );
    assert.equal(result.skipped, 'missing_secret');
    assert.equal(called, false);
  });

  it('posts only book_job and never includes Ads conversion labels', async () => {
    process.env.GA4_MP_API_SECRET = 'unit-test-secret';
    process.env.GA4_MEASUREMENT_ID = 'G-5LL1YRWT5T';

    const captured: { url: string; body: string } = { url: '', body: '' };
    const sent = await sendBookJobEvent(
      buildBookJobPayload({
        jobberJobId: 'job-2',
        lead: {
          email: 'pat@example.com',
          phone: '7605550100',
          gclid: 'gclid-xyz',
          ga_client_id: '1.2',
          ga_session_id: '3',
        },
        valueUsd: 100,
      }),
      async (input, init) => {
        captured.url = String(input);
        captured.body = String(init?.body ?? '');
        return new Response(null, { status: 204 });
      }
    );

    assert.equal(sent.ok, true);
    assert.match(captured.url, /measurement_id=G-5LL1YRWT5T/);
    assert.match(captured.body, /"name":"book_job"/);
    for (const label of FORBIDDEN_ADS_LABELS) {
      assert.equal(captured.body.includes(label), false);
    }
    assert.equal(captured.body.includes('AW-'), false);
  });
});
