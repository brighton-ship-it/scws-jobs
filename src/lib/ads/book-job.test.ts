import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAdsClickIds,
  isMissingClickIdColumnError,
  omitClickIdColumns,
} from './click-ids.ts';
import {
  BOOK_JOB_EVENT_NAME,
  FORBIDDEN_ADS_LABELS,
  assertNoForbiddenAdsLabels,
  buildBookJobPayload,
  decideBookJob,
  hashEmailForMp,
  hashPhoneForMp,
  isJobScheduled,
  lastResortClientId,
  matchWebsiteLead,
  normalizePhone,
  sha256Hex,
  type WebsiteLead,
} from './book-job.ts';

const NOW = new Date('2026-08-27T12:00:00.000Z');

function lead(overrides: Partial<WebsiteLead> & Pick<WebsiteLead, 'id'>): WebsiteLead {
  return {
    source: 'booking_requests',
    phone: '7605550100',
    email: 'pat@example.com',
    created_at: '2026-08-20T12:00:00.000Z',
    gclid: 'gclid-abc',
    ga_client_id: '123.456',
    ga_session_id: '789',
    ...overrides,
  };
}

describe('extractAdsClickIds', () => {
  it('stores gclid, gbraid, wbraid, and GA ids when present', () => {
    assert.deepEqual(
      extractAdsClickIds({
        gclid: ' Cj0KCQ ',
        gbraid: 'gbraid_1',
        wbraid: 'wbraid_1',
        ga_client_id: '111.222',
        ga_session_id: '333',
      }),
      {
        gclid: 'Cj0KCQ',
        gbraid: 'gbraid_1',
        wbraid: 'wbraid_1',
        ga_client_id: '111.222',
        ga_session_id: '333',
      }
    );
  });

  it('returns nulls when click ids are missing or junk', () => {
    assert.deepEqual(extractAdsClickIds({ gclid: 'not a valid id!' }), {
      gclid: null,
      gbraid: null,
      wbraid: null,
      ga_client_id: null,
      ga_session_id: null,
    });
  });
});

describe('missing click-id columns (PGRST204)', () => {
  it('detects PostgREST missing-column errors', () => {
    assert.equal(
      isMissingClickIdColumnError({
        code: 'PGRST204',
        message: "Could not find the 'ga_client_id' column of 'booking_requests' in the schema cache",
      }),
      true
    );
    assert.equal(
      isMissingClickIdColumnError({
        message: "Could not find the 'gclid' column of 'booking_requests' in the schema cache",
      }),
      true
    );
    assert.equal(isMissingClickIdColumnError({ code: '23505', message: 'duplicate' }), false);
  });

  it('omits click-id fields so the lead can still insert', () => {
    assert.deepEqual(
      omitClickIdColumns({
        customer_name: 'Pat',
        phone: '7605550100',
        gclid: 'abc',
        gbraid: null,
        wbraid: null,
        ga_client_id: '123.456',
        ga_session_id: '789',
      }),
      { customer_name: 'Pat', phone: '7605550100' }
    );
  });
});

describe('isJobScheduled', () => {
  it('is scheduled when a start date appears on the job', () => {
    assert.equal(isJobScheduled({ id: 'job-1', startAt: '2026-09-01T15:00:00Z' }), true);
  });

  it('is scheduled when a visit has a start date', () => {
    assert.equal(
      isJobScheduled({
        id: 'job-1',
        startAt: null,
        visits: { nodes: [{ startAt: '2026-09-01T15:00:00Z' }] },
      }),
      true
    );
  });

  it('is not scheduled when no start date exists yet', () => {
    assert.equal(
      isJobScheduled({
        id: 'job-1',
        startAt: null,
        jobStatus: 'UNSCHEDULED',
        visits: { nodes: [{ startAt: null }] },
      }),
      false
    );
  });
});

describe('decideBookJob', () => {
  it('skips when the job is not scheduled yet', () => {
    assert.deepEqual(
      decideBookJob({
        isScheduled: false,
        alreadyConverted: false,
        previouslyScheduled: null,
        createdRecently: true,
      }),
      { emit: false, reason: 'not_scheduled' }
    );
  });

  it('is idempotent: already-converted jobber_job_id never fires again', () => {
    assert.deepEqual(
      decideBookJob({
        isScheduled: true,
        alreadyConverted: true,
        previouslyScheduled: false,
        createdRecently: true,
      }),
      { emit: false, reason: 'already_converted' }
    );
  });

  it('does not fire on later job updates after the job is already on a schedule', () => {
    assert.deepEqual(
      decideBookJob({
        isScheduled: true,
        alreadyConverted: false,
        previouslyScheduled: true,
        createdRecently: false,
      }),
      { emit: false, reason: 'already_on_schedule' }
    );
  });

  it('fires once on the first unscheduled → scheduled transition', () => {
    assert.deepEqual(
      decideBookJob({
        isScheduled: true,
        alreadyConverted: false,
        previouslyScheduled: false,
        createdRecently: false,
      }),
      { emit: true, reason: 'first_schedule_transition' }
    );
  });

  it('fires when a brand-new job is created already scheduled', () => {
    assert.deepEqual(
      decideBookJob({
        isScheduled: true,
        alreadyConverted: false,
        previouslyScheduled: null,
        createdRecently: true,
      }),
      { emit: true, reason: 'new_job_already_scheduled' }
    );
  });

  it('bootstraps an older already-scheduled job without firing', () => {
    assert.deepEqual(
      decideBookJob({
        isScheduled: true,
        alreadyConverted: false,
        previouslyScheduled: null,
        createdRecently: false,
      }),
      { emit: false, reason: 'bootstrap_existing_scheduled' }
    );
  });
});

describe('matchWebsiteLead', () => {
  const leads: WebsiteLead[] = [
    lead({
      id: 'old-phone',
      phone: '7605550100',
      email: 'other@example.com',
      created_at: '2026-07-01T12:00:00.000Z',
    }),
    lead({
      id: 'recent-phone',
      phone: '17605550100',
      email: 'other@example.com',
      created_at: '2026-08-25T12:00:00.000Z',
    }),
    lead({
      id: 'email-only',
      phone: '7605559999',
      email: 'pat@example.com',
      created_at: '2026-08-26T12:00:00.000Z',
    }),
    lead({
      id: 'both',
      phone: '(760) 555-0100',
      email: 'Pat@example.com',
      created_at: '2026-08-10T12:00:00.000Z',
    }),
  ];

  it('prefers a phone+email match over phone-only or email-only', () => {
    const match = matchWebsiteLead(
      leads,
      { phones: ['+1 (760) 555-0100'], emails: ['pat@example.com'] },
      { now: NOW }
    );
    assert.equal(match?.lead.id, 'both');
    assert.equal(match?.matchedBy, 'phone_and_email');
  });

  it('matches by phone when emails differ, using the newest lead', () => {
    const match = matchWebsiteLead(
      leads,
      { phones: ['760-555-0100'], emails: ['nobody@example.com'] },
      { now: NOW }
    );
    assert.equal(match?.lead.id, 'recent-phone');
    assert.equal(match?.matchedBy, 'phone');
    assert.equal(normalizePhone(match?.lead.phone), '7605550100');
  });

  it('matches by email when phones differ', () => {
    const match = matchWebsiteLead(
      leads,
      { phones: ['5550001111'], emails: ['PAT@example.com'] },
      { now: NOW }
    );
    assert.equal(match?.lead.id, 'email-only');
    assert.equal(match?.matchedBy, 'email');
  });

  it('returns null when nothing matches a recent lead', () => {
    const match = matchWebsiteLead(
      leads,
      { phones: ['9999999999'], emails: ['nope@example.com'] },
      { now: NOW }
    );
    assert.equal(match, null);
  });

  it('ignores leads older than the match window', () => {
    const match = matchWebsiteLead(
      [
        lead({
          id: 'stale',
          phone: '7605550100',
          created_at: '2025-01-01T00:00:00.000Z',
        }),
      ],
      { phones: ['7605550100'] },
      { now: NOW }
    );
    assert.equal(match, null);
  });
});

describe('buildBookJobPayload', () => {
  it('uses stored ga_client_id, hashes user data, and includes gclid + value', () => {
    const payload = buildBookJobPayload({
      jobberJobId: 'Z2lkOi8vSm9iYmVyL0pvYi8x',
      lead: lead({ id: 'lead-1' }),
      valueUsd: 850,
    });

    assert.equal(payload.client_id, '123.456');
    assert.equal(payload.events.length, 1);
    assert.equal(payload.events[0].name, BOOK_JOB_EVENT_NAME);
    assert.equal(payload.events[0].params.jobber_job_id, 'Z2lkOi8vSm9iYmVyL0pvYi8x');
    assert.equal(payload.events[0].params.value, 850);
    assert.equal(payload.events[0].params.currency, 'USD');
    assert.equal(payload.events[0].params.gclid, 'gclid-abc');
    assert.equal(payload.events[0].params.engagement, true);
    assert.equal(payload.events[0].params.engagement_time_msec, 1);
    assert.equal(payload.events[0].params.client_id_source, 'ga_client_id');
    assert.deepEqual(payload.user_data?.sha256_email_address, [hashEmailForMp('pat@example.com')]);
    assert.deepEqual(payload.user_data?.sha256_phone_number, [hashPhoneForMp('7605550100')]);
    assert.equal(payload.user_data?.sha256_email_address?.[0], sha256Hex('pat@example.com'));
    assert.equal(payload.user_data?.sha256_phone_number?.[0], sha256Hex('+17605550100'));
    assertNoForbiddenAdsLabels(payload);
  });

  it('labels a last-resort client_id when no ga_client_id was stored', () => {
    const jobberJobId = 'jobber-job-99';
    const payload = buildBookJobPayload({
      jobberJobId,
      lead: lead({ id: 'lead-2', ga_client_id: null, gclid: null }),
      jobberEmail: 'from-jobber@example.com',
      jobberPhone: '7605550100',
    });

    assert.equal(payload.client_id, lastResortClientId(jobberJobId));
    assert.match(payload.client_id, /^last-resort\./);
    assert.equal(payload.events[0].params.client_id_source, 'last_resort');
    assert.equal(payload.events[0].params.gclid, undefined);
    assert.equal(payload.events[0].params.value, undefined);
    assert.equal(payload.events[0].name, BOOK_JOB_EVENT_NAME);
    assertNoForbiddenAdsLabels(payload);
  });

  it('never includes the website form or phone Ads labels', () => {
    const payload = buildBookJobPayload({
      jobberJobId: 'job-3',
      lead: lead({ id: 'lead-3' }),
    });
    const serialized = JSON.stringify(payload);
    for (const label of FORBIDDEN_ADS_LABELS) {
      assert.equal(serialized.includes(label), false);
    }
    assert.equal(serialized.includes('send_to'), false);
    assert.equal(serialized.includes('AW-'), false);
  });
});
