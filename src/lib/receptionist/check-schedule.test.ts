import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleCheckSchedule,
  isOnOrAfterTodayPt,
  scheduleLookupError,
  technicianNamesFromAssignedUsers,
  type ScheduleLookupResult,
} from './check-schedule.ts';
import { speechConfirmsAppointment } from './appointment-confirmation.ts';

const INCIDENT_NOW = new Date('2026-08-31T22:00:00.000Z');
const GUY_PHONE = '9499039486';
const CLIENT_ID = 'Z2lkOi8vSm9iYmVyL0NsaWVudC8xNDYyMTg4NTI=';

type GraphqlBody = {
  query?: string;
  variables?: Record<string, unknown>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockJobber(options: {
  client?: { id: string; name: string; phones: Array<{ number: string }> } | null;
  jobs?: unknown[];
  visitsError?: string;
  httpError?: number;
}) {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    if (options.httpError) {
      return jsonResponse({ errors: [{ message: `HTTP ${options.httpError}` }] }, options.httpError);
    }

    const body = JSON.parse(String(init?.body || '{}')) as GraphqlBody;
    const query = body.query || '';

    if (query.includes('SearchClients')) {
      if (!options.client) {
        return jsonResponse({ data: { clients: { nodes: [] } } });
      }
      return jsonResponse({ data: { clients: { nodes: [options.client] } } });
    }

    if (query.includes('GetUpcomingVisits')) {
      if (options.visitsError) {
        return jsonResponse({ errors: [{ message: options.visitsError }] });
      }
      return jsonResponse({
        data: {
          client: {
            name: options.client?.name,
            jobs: { nodes: options.jobs || [] },
          },
        },
      });
    }

    return jsonResponse({ errors: [{ message: `unexpected query: ${query.slice(0, 40)}` }] });
  };
}

const guyClient = {
  id: CLIENT_ID,
  name: 'Edward Guys',
  phones: [{ number: '949-903-9486' }],
};

describe('technicianNamesFromAssignedUsers', () => {
  it('reads Jobber UserConnection name.full', () => {
    assert.deepEqual(
      technicianNamesFromAssignedUsers({
        nodes: [{ name: { full: 'Travis C Sego' } }],
      }),
      ['Travis C Sego']
    );
  });

  it('still accepts the broken flat { name } shape', () => {
    assert.deepEqual(
      technicianNamesFromAssignedUsers([{ name: 'Travis C Sego' }]),
      ['Travis C Sego']
    );
  });

  it('returns empty when assignedUsers is missing', () => {
    assert.deepEqual(technicianNamesFromAssignedUsers(undefined), []);
  });
});

describe('handleCheckSchedule', () => {
  it('returns no confirmation when the matched client has zero visits (Guy Edwards)', async () => {
    const { result } = await handleCheckSchedule(GUY_PHONE, {
      accessToken: 'test-token',
      now: INCIDENT_NOW,
      fetchFn: mockJobber({ client: guyClient, jobs: [] }),
    });

    assert.equal(result.found, true);
    assert.equal(result.customerName, 'Edward Guys');
    assert.equal(result.hasAppointments, false);
    assert.equal(result.canConfirm, false);
    assert.equal(result.lookupStatus, 'ok');
    assert.deepEqual(result.visits, []);
    assert.equal(speechConfirmsAppointment(result.message), false);
    assert.match(result.message, /don't see any upcoming appointments/i);
    assert.equal(/travis|11\s*am|everything looks good/i.test(result.message), false);
  });

  it('does not treat an unused afterDate / GraphQL failure as a confirmed visit', async () => {
    const { result } = await handleCheckSchedule(GUY_PHONE, {
      accessToken: 'test-token',
      now: INCIDENT_NOW,
      fetchFn: mockJobber({
        client: guyClient,
        visitsError: 'Field assignedUsers.name doesn\'t exist on type UserConnection',
      }),
    });

    assert.equal(result.lookupStatus, 'error');
    assert.equal(result.canConfirm, false);
    assert.equal(result.hasAppointments, false);
    assert.equal(speechConfirmsAppointment(result.message), false);
    assert.match(result.message, /office verify/i);
  });

  it('confirms only facts from a real Jobber visit, including UserConnection techs', async () => {
    const { result } = await handleCheckSchedule(GUY_PHONE, {
      accessToken: 'test-token',
      now: INCIDENT_NOW,
      fetchFn: mockJobber({
        client: guyClient,
        jobs: [
          {
            title: 'Service Call',
            property: { address: { street1: '123 Well Rd', city: 'Ramona' } },
            visits: {
              nodes: [
                {
                  id: 'visit-1',
                  startAt: '2026-08-31T18:00:00.000Z',
                  endAt: '2026-08-31T19:00:00.000Z',
                  allDay: false,
                  assignedUsers: {
                    nodes: [{ name: { full: 'Travis C Sego' } }],
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    assert.equal(result.canConfirm, true);
    assert.equal(result.hasAppointments, true);
    assert.deepEqual(result.nextAppointment?.technicians, ['Travis C Sego']);
    assert.match(result.nextAppointment?.time || '', /11:00 AM/);
    assert.match(result.message, /Travis C Sego/);
    assert.match(result.message, /August 31/);
  });

  it('ignores past visits and quotes-shaped empty job lists', async () => {
    const { result } = await handleCheckSchedule(GUY_PHONE, {
      accessToken: 'test-token',
      now: INCIDENT_NOW,
      fetchFn: mockJobber({
        client: guyClient,
        jobs: [
          {
            title: 'Service Call',
            visits: {
              nodes: [
                {
                  startAt: '2026-08-04T16:19:12.000Z',
                  allDay: false,
                  assignedUsers: { nodes: [] },
                },
              ],
            },
          },
        ],
      }),
    });

    assert.equal(result.canConfirm, false);
    assert.equal(result.hasAppointments, false);
  });

  it('returns a structured error when Jobber is down', async () => {
    const { result } = await handleCheckSchedule(GUY_PHONE, {
      accessToken: 'test-token',
      now: INCIDENT_NOW,
      fetchFn: mockJobber({ httpError: 503 }),
    });

    assert.equal(result.lookupStatus, 'error');
    assert.equal(result.canConfirm, false);
    assert.equal(speechConfirmsAppointment(result.message), false);
  });

  it('returns no confirmation when JOBBER_ACCESS_TOKEN is missing', async () => {
    const { result } = await handleCheckSchedule(GUY_PHONE, {
      accessToken: null,
      now: INCIDENT_NOW,
      fetchFn: async () => {
        throw new Error('should not fetch');
      },
    });

    assert.equal(result.lookupStatus, 'error');
    assert.equal(result.canConfirm, false);
  });
});

describe('scheduleLookupError', () => {
  it('never produces confirmation speech', () => {
    const result: ScheduleLookupResult = scheduleLookupError('down');
    assert.equal(result.canConfirm, false);
    assert.equal(speechConfirmsAppointment(result.message), false);
  });
});

describe('isOnOrAfterTodayPt', () => {
  it('includes a same-day PT visit and drops earlier calendar days', () => {
    assert.equal(isOnOrAfterTodayPt('2026-08-31T18:00:00.000Z', INCIDENT_NOW), true);
    assert.equal(isOnOrAfterTodayPt('2026-08-04T16:19:12.000Z', INCIDENT_NOW), false);
  });
});
