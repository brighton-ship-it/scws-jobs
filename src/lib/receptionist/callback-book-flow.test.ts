import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleCheckSchedule } from './check-schedule.ts';
import { handleBookServiceCall } from './book-service-call.ts';

/** Thursday Sep 3 2026 5:30 PM PT. After the booking cutoff, so a service call may be booked. */
const THU_530PM = new Date('2026-09-04T00:30:00.000Z');
const BRIAN = { id: 'user-brian', name: { full: 'Brian Eads' }, email: { raw: 'brian@scwellservice.com' } };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function throttled(requested = 1800) {
  return jsonResponse({
    errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
    extensions: {
      cost: {
        requestedQueryCost: requested,
        throttleStatus: { maximumAvailable: 10_000, currentlyAvailable: 0, restoreRate: 500 },
      },
    },
  });
}

/**
 * Dry-run Jobber. The rich calendar query is throttled with an empty bucket.
 * The small page returns no visits, so real openings are computed. Job and
 * visit creates are recorded and never sent to Jobber.
 */
function mockJobber(created: { jobs: number; visits: number }, visit: { startAt: string; endAt: string }) {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    const query = (JSON.parse(String(init?.body || '{}')) as { query?: string }).query || '';
    if (query.includes('ShopUsers')) {
      return jsonResponse({ data: { users: { nodes: [BRIAN] } } });
    }
    if (query.includes('GetUpcomingVisits')) {
      return jsonResponse({ data: { client: { jobs: { nodes: [] } } } });
    }
    if (query.includes('OccupiedVisits') && query.includes('property')) return throttled();
    if (query.includes('OccupiedVisits')) {
      return jsonResponse({ data: { visits: { nodes: [], pageInfo: { hasNextPage: false } } } });
    }
    if (query.includes('SearchClients')) {
      return jsonResponse({ data: { clients: { nodes: [] } } });
    }
    if (query.includes('ClientCreate')) {
      return jsonResponse({
        data: {
          clientCreate: {
            client: { id: 'client-sim', name: 'Test Callback', phones: [], emails: [] },
            userErrors: [],
          },
        },
      });
    }
    if (query.includes('PropertyCreate')) {
      return jsonResponse({
        data: { propertyCreate: { properties: [{ id: 'prop-sim' }], userErrors: [] } },
      });
    }
    if (query.includes('JobCreate')) {
      created.jobs += 1;
      return jsonResponse({
        data: { jobCreate: { job: { id: 'job-sim', title: 'Service Call', visits: { nodes: [] } }, userErrors: [] } },
      });
    }
    if (query.includes('VisitCreate')) {
      created.visits += 1;
      return jsonResponse({
        data: {
          visitCreate: {
            createdVisits: [
              {
                id: 'visit-sim',
                startAt: visit.startAt,
                endAt: visit.endAt,
                assignedUsers: { nodes: [{ id: 'user-brian', name: { full: 'Brian Eads' } }] },
              },
            ],
            userErrors: [],
          },
        },
      });
    }
    return jsonResponse({ errors: [{ message: `unexpected query: ${query.slice(0, 80)}` }] });
  };
}

describe('callback booking flow', () => {
  it('gets two openings after an empty-bucket throttle and dry-run books the first', async () => {
    const created = { jobs: 0, visits: 0 };
    const visit = { startAt: '', endAt: '' };
    const deps = {
      now: THU_530PM,
      accessToken: 'test-token',
      sleep: async () => {},
      fetchFn: mockJobber(created, visit),
    };
    const schedule = await handleCheckSchedule(
      { phone: '7605550199', city: 'Ramona', address: '100 Well Rd', intent: 'book' },
      deps,
    );
    const slots = schedule.result.openSlots || [];
    assert.equal(schedule.result.retryRequired, false);
    assert.equal(schedule.result.takeMessage, false);
    assert.doesNotMatch(schedule.result.bookingMessage || '', /office will call/i);
    assert.ok(slots.length >= 2, 'expected two openings to offer');

    const [first, second] = slots;
    visit.startAt = first.startAt;
    visit.endAt = first.endAt;
    const bookedResponse = await handleBookServiceCall(
      {
        phone: '7605550199',
        name: 'Test Callback',
        address: '100 Well Rd',
        city: 'Ramona',
        zip: '92065',
        startAt: first.startAt,
        notes: 'Well is not producing. Callback booking simulation.',
      },
      deps,
    );
    const booked = bookedResponse.result;

    assert.equal(booked.booked, true, booked.message || booked.error);
    assert.equal(booked.canConfirm, true);
    assert.equal(created.jobs, 1);
    assert.equal(created.visits, 1);
    assert.equal(booked.visit?.technicians?.[0], 'Brian Eads');

    const transcript = [
      'Caller: This is Brighton. The well is not producing.',
      'Mike: Hey, this is Mike with Southern California Well Service, returning your call. What\'s going on with your well?',
      'Caller: It\'s not producing.',
      `Mike tool checkSchedule: ${schedule.result.bookingMessage}`,
      `Mike: I can do ${first.date} ${first.time} or ${second.date} ${second.time}. That is a $200 service call. Is the address 100 Well Rd in Ramona?`,
      'Caller: Yes. Book the first one.',
      `Mike tool bookJob: booked=${booked.booked} ${booked.message}`,
    ];
    assert.match(transcript.join('\n'), /booked=true/);
    assert.match(transcript.join('\n'), /\$200 service call/);
    console.log(transcript.join('\n'));
  });
});
