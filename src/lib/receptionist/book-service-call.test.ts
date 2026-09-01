import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVICE_CALL_PRICE_USD,
  SERVICE_CALL_TITLE,
  handleBookServiceCall,
  isSarahServiceCallTitle,
  pickExistingClient,
  splitCallerName,
  weekendEmergencyFlag,
  type JobberClientNode,
} from './book-service-call.ts';
import { handleCheckSchedule } from './check-schedule.ts';
import { computeOpenSlots } from './open-slots.ts';

const THU_4PM = new Date('2026-09-03T23:00:00.000Z');
const THU_530PM = new Date('2026-09-04T00:30:00.000Z');
const SAT_10AM = new Date('2026-09-05T17:00:00.000Z');

const BRIAN = {
  id: 'user-brian',
  name: { full: 'Brian Eads' },
  email: { raw: 'brian@scwellservice.com' },
};
const COWIN = {
  id: 'user-cowin',
  name: { full: 'Cowin' },
  email: { raw: 'cowin@scwellservice.com' },
};
const DOUG = {
  id: 'user-doug',
  name: { full: 'Doug Pollack' },
};
const TRAVIS = {
  id: 'user-travis',
  name: { full: 'Travis C Sego' },
  email: { raw: 'travis@scwellservice.com' },
};

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

function firstOpenSlot(now: Date, techId: string, techName: string) {
  return computeOpenSlots({
    occupied: [],
    now,
    technicianId: techId,
    technicianName: techName,
    maxSlots: 1,
  })[0];
}

function mockJobber(options: {
  users?: Array<{ id: string; name: { full: string } }>;
  clients?: JobberClientNode[];
  occupied?: unknown[];
  createdJob?: {
    id: string;
    title: string;
    visits: { nodes: Array<Record<string, unknown>> };
  } | null;
  jobUserErrors?: Array<{ message: string }>;
  httpError?: number;
}) {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    if (options.httpError) {
      return jsonResponse({ errors: [{ message: `HTTP ${options.httpError}` }] }, options.httpError);
    }

    const body = JSON.parse(String(init?.body || '{}')) as GraphqlBody;
    const query = body.query || '';

    if (query.includes('ShopUsers')) {
      return jsonResponse({ data: { users: { nodes: options.users || [BRIAN, COWIN, DOUG] } } });
    }

    if (query.includes('OccupiedVisits')) {
      return jsonResponse({ data: { visits: { nodes: options.occupied || [] } } });
    }

    if (query.includes('SearchClients')) {
      return jsonResponse({ data: { clients: { nodes: options.clients || [] } } });
    }

    if (query.includes('GetUpcomingVisits')) {
      return jsonResponse({
        data: {
          client: {
            name: options.clients?.[0]?.name,
            jobs: { nodes: [] },
          },
        },
      });
    }

    if (query.includes('ClientCreate')) {
      return jsonResponse({
        data: {
          clientCreate: {
            client: { id: 'client-new', name: 'Pat Wells', phones: [], emails: [] },
            userErrors: [],
          },
        },
      });
    }

    if (query.includes('PropertyCreate')) {
      return jsonResponse({
        data: { propertyCreate: { properties: [{ id: 'prop-1' }], userErrors: [] } },
      });
    }

    if (query.includes('JobCreate')) {
      if (options.jobUserErrors) {
        return jsonResponse({
          data: { jobCreate: { job: null, userErrors: options.jobUserErrors } },
        });
      }
      if (options.createdJob === null) {
        return jsonResponse({ data: { jobCreate: { job: { id: 'job-1', title: 'Service Call', visits: { nodes: [] } }, userErrors: [] } } });
      }
      return jsonResponse({
        data: {
          jobCreate: {
            job: options.createdJob,
            userErrors: [],
          },
        },
      });
    }

    return jsonResponse({ errors: [{ message: `unexpected query: ${query.slice(0, 60)}` }] });
  };
}

describe('pickExistingClient — no duplicates', () => {
  const existing: JobberClientNode = {
    id: 'client-1',
    name: 'Pat Wells',
    firstName: 'Pat',
    lastName: 'Wells',
    phones: [{ number: '760-555-0100' }],
    emails: [{ address: 'pat@example.com' }],
    properties: {
      nodes: [{ id: 'prop-1', address: { street1: '100 Well Rd', city: 'Ramona', postalCode: '92065' } }],
    },
  };

  it('matches phone, then email, then address, then name', () => {
    assert.equal(pickExistingClient([existing], { phone: '7605550100' })?.matchedBy, 'phone');
    assert.equal(pickExistingClient([existing], { email: 'pat@example.com' })?.matchedBy, 'email');
    assert.equal(
      pickExistingClient([existing], { address: '100 Well Road', city: 'Ramona' })?.matchedBy,
      'address'
    );
    assert.equal(pickExistingClient([existing], { name: 'Pat Wells' })?.matchedBy, 'name');
    assert.equal(pickExistingClient([existing], { phone: '7605550199', name: 'Nobody Else' }), null);
  });
});

describe('splitCallerName', () => {
  it('splits a full name', () => {
    assert.deepEqual(splitCallerName({ name: 'Pat Wells' }), { firstName: 'Pat', lastName: 'Wells' });
  });
});

describe('handleBookServiceCall', () => {
  it('daytime weekday path does not book', async () => {
    const { result } = await handleBookServiceCall(
      {
        phone: '7605550100',
        name: 'Pat Wells',
        address: '100 Well Rd',
        city: 'Ramona',
        startAt: '2026-09-04T15:00:00.000Z',
      },
      {
        now: THU_4PM,
        accessToken: 'test-token',
        fetchFn: async () => {
          throw new Error('should not call Jobber during daytime weekday');
        },
      }
    );

    assert.equal(result.booked, false);
    assert.equal(result.canConfirm, false);
    assert.equal(result.mayBook, false);
    assert.equal(result.bookingBlockReason, 'daytime_weekday');
    assert.match(result.message, /Liz|office/i);
  });

  it('weekend emergency does not auto-book Monday and flags the shop', async () => {
    const flags: string[] = [];
    const { result } = await handleBookServiceCall(
      {
        phone: '7605550100',
        name: 'Pat Wells',
        address: '100 Well Rd',
        city: 'Ramona',
        startAt: '2026-09-07T15:00:00.000Z',
        urgency: 'emergency',
        needNow: true,
        notes: 'Airbnb guests, no water this weekend',
      },
      {
        now: SAT_10AM,
        accessToken: 'test-token',
        fetchFn: async () => {
          throw new Error('should not create a Monday Jobber visit');
        },
        notifyOffice: async (flag) => {
          flags.push(flag.kind);
        },
      }
    );

    assert.equal(result.booked, false);
    assert.equal(result.canConfirm, false);
    assert.equal(result.weekendEmergency, true);
    assert.equal(result.bookingBlockReason, 'weekend_emergency');
    assert.deepEqual(flags, ['weekend_emergency']);
    assert.match(result.message, /Monday/i);
    assert.match(weekendEmergencyFlag({ name: 'Pat Wells' }).subject, /do not book Monday/i);
  });

  it('creates a Ramona Service Call visit assigned to Brian Eads', async () => {
    const slot = firstOpenSlot(THU_530PM, 'user-brian', 'Brian Eads');
    const { result } = await handleBookServiceCall(
      {
        phone: '7605550100',
        name: 'Pat Wells',
        address: '100 Well Rd',
        city: 'Ramona',
        startAt: slot.startAt,
        urgency: 'normal',
      },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockJobber({
          createdJob: {
            id: 'job-ramona',
            title: SERVICE_CALL_TITLE,
            visits: {
              nodes: [
                {
                  id: 'visit-ramona',
                  startAt: slot.startAt,
                  endAt: slot.endAt,
                  assignedUsers: { nodes: [{ id: 'user-brian', name: { full: 'Brian Eads' } }] },
                },
              ],
            },
          },
        }),
      }
    );

    assert.equal(result.booked, true);
    assert.equal(result.canConfirm, true);
    assert.equal(result.visit?.title, SERVICE_CALL_TITLE);
    assert.deepEqual(result.visit?.technicians, ['Brian Eads']);
    assert.equal(result.visit?.startAt, slot.startAt);
    assert.equal(result.assignedTechName, 'Brian Eads');
    assert.equal(SERVICE_CALL_PRICE_USD, 200);
  });

  it('creates an Anza Service Call visit assigned to Doug Pollack when both have a slot', async () => {
    const slot = firstOpenSlot(THU_530PM, 'user-doug', 'Doug Pollack');
    const { result } = await handleBookServiceCall(
      {
        phone: '7605550188',
        name: 'Alex Highdesert',
        address: '10 CA-371',
        city: 'Anza',
        zip: '92539',
        startAt: slot.startAt,
      },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockJobber({
          createdJob: {
            id: 'job-anza',
            title: SERVICE_CALL_TITLE,
            visits: {
              nodes: [
                {
                  id: 'visit-anza',
                  startAt: slot.startAt,
                  endAt: slot.endAt,
                  assignedUsers: { nodes: [{ id: 'user-doug', name: { full: 'Doug Pollack' } }] },
                },
              ],
            },
          },
        }),
      }
    );

    assert.equal(result.booked, true);
    assert.equal(result.canConfirm, true);
    assert.deepEqual(result.visit?.technicians, ['Doug Pollack']);
    assert.equal(result.assignedTechName, 'Doug Pollack');
  });

  it('creates an Anza Service Call visit assigned to Cowin when Doug is booked', async () => {
    const slot = firstOpenSlot(THU_530PM, 'user-cowin', 'Cowin');
    const { result } = await handleBookServiceCall(
      {
        phone: '7605550188',
        name: 'Alex Highdesert',
        address: '10 CA-371',
        city: 'Anza',
        zip: '92539',
        startAt: slot.startAt,
      },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockJobber({
          occupied: [
            {
              startAt: slot.startAt,
              endAt: slot.endAt,
              assignedUsers: { nodes: [{ id: 'user-doug', name: { full: 'Doug Pollack' } }] },
            },
          ],
          createdJob: {
            id: 'job-anza-cowin',
            title: SERVICE_CALL_TITLE,
            visits: {
              nodes: [
                {
                  id: 'visit-anza-cowin',
                  startAt: slot.startAt,
                  endAt: slot.endAt,
                  assignedUsers: { nodes: [{ id: 'user-cowin', name: { full: 'Cowin' } }] },
                },
              ],
            },
          },
        }),
      }
    );

    assert.equal(result.booked, true);
    assert.equal(result.canConfirm, true);
    assert.deepEqual(result.visit?.technicians, ['Cowin']);
    assert.equal(result.assignedTechName, 'Cowin');
  });

  it('returns no bookable Anza times when Doug and Cowin are both booked', async () => {
    const windows = computeOpenSlots({
      occupied: [],
      now: THU_530PM,
      technicianId: 'user-doug',
      technicianName: 'Doug Pollack',
      maxSlots: 50,
    });
    const { result } = await handleCheckSchedule(
      { phone: '7605550188', city: 'Anza', zip: '92539', intent: 'book' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockJobber({
          occupied: windows.flatMap((slot) => [
            {
              startAt: slot.startAt,
              endAt: slot.endAt,
              assignedUsers: { nodes: [{ id: 'user-doug', name: { full: 'Doug Pollack' } }] },
            },
            {
              startAt: slot.startAt,
              endAt: slot.endAt,
              assignedUsers: { nodes: [{ id: 'user-cowin', name: { full: 'Cowin' } }] },
            },
          ]),
        }),
      }
    );

    assert.equal(result.canConfirm, false);
    assert.equal(result.mayBook, false);
    assert.deepEqual(result.openSlots, []);
    assert.deepEqual(result.allowlistedTechIds, ['user-doug', 'user-cowin']);
  });

  it('refuses to confirm when jobCreate returns no visit', async () => {
    const slot = firstOpenSlot(THU_530PM, 'user-brian', 'Brian Eads');
    const { result } = await handleBookServiceCall(
      {
        phone: '7605550100',
        name: 'Pat Wells',
        address: '100 Well Rd',
        city: 'Ramona',
        startAt: slot.startAt,
      },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockJobber({ createdJob: null }),
      }
    );

    assert.equal(result.booked, false);
    assert.equal(result.canConfirm, false);
    assert.match(result.message, /office/i);
  });

  it('reuses an existing Jobber client instead of creating a duplicate', async () => {
    const slot = firstOpenSlot(THU_530PM, 'user-brian', 'Brian Eads');
    let clientCreates = 0;
    const existing: JobberClientNode = {
      id: 'client-existing',
      name: 'Pat Wells',
      phones: [{ number: '7605550100' }],
      properties: {
        nodes: [{ id: 'prop-existing', address: { street1: '100 Well Rd', city: 'Ramona' } }],
      },
    };

    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as GraphqlBody;
      const query = body.query || '';
      if (query.includes('ClientCreate')) {
        clientCreates += 1;
        return jsonResponse({ errors: [{ message: 'should not create' }] });
      }
      return mockJobber({
        clients: [existing],
        createdJob: {
          id: 'job-existing',
          title: SERVICE_CALL_TITLE,
          visits: {
            nodes: [
              {
                id: 'visit-existing',
                startAt: slot.startAt,
                endAt: slot.endAt,
                assignedUsers: { nodes: [{ id: 'user-brian', name: { full: 'Brian Eads' } }] },
              },
            ],
          },
        },
      })(_url, init);
    };

    const { result } = await handleBookServiceCall(
      {
        phone: '7605550100',
        name: 'Pat Wells',
        address: '100 Well Rd',
        city: 'Ramona',
        startAt: slot.startAt,
      },
      { now: THU_530PM, accessToken: 'test-token', fetchFn }
    );

    assert.equal(result.booked, true);
    assert.equal(result.clientId, 'client-existing');
    assert.equal(result.clientCreated, false);
    assert.equal(clientCreates, 0);
  });

  it('does not book drill, pump, or quote visits', async () => {
    const slot = firstOpenSlot(THU_530PM, 'user-brian', 'Brian Eads');
    const { result } = await handleBookServiceCall(
      {
        phone: '7605550100',
        name: 'Pat Wells',
        address: '100 Well Rd',
        city: 'Ramona',
        startAt: slot.startAt,
        title: 'New well drilling',
      },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: async () => {
          throw new Error('should not create a drill job');
        },
      }
    );

    assert.equal(result.booked, false);
    assert.equal(result.canConfirm, false);
    assert.equal(result.bookingBlockReason, 'forbidden_job_type');
    assert.equal(isSarahServiceCallTitle('New well drilling'), false);
    assert.equal(isSarahServiceCallTitle('Pump replacement'), false);
    assert.equal(isSarahServiceCallTitle('Quote'), false);
    assert.equal(isSarahServiceCallTitle('Service Call'), true);
  });

  it('refuses to confirm when Jobber assigns the visit to Travis', async () => {
    const slot = firstOpenSlot(THU_530PM, 'user-brian', 'Brian Eads');
    const { result } = await handleBookServiceCall(
      {
        phone: '7605550100',
        name: 'Pat Wells',
        address: '100 Well Rd',
        city: 'Ramona',
        startAt: slot.startAt,
      },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockJobber({
          createdJob: {
            id: 'job-wrong',
            title: SERVICE_CALL_TITLE,
            visits: {
              nodes: [
                {
                  id: 'visit-travis',
                  startAt: slot.startAt,
                  endAt: slot.endAt,
                  assignedUsers: { nodes: [{ id: 'user-travis', name: { full: 'Travis C Sego' } }] },
                },
              ],
            },
          },
        }),
      }
    );

    assert.equal(result.booked, false);
    assert.equal(result.canConfirm, false);
    assert.equal(result.bookingBlockReason, 'wrong_tech');
  });
});

describe('checkSchedule booking attach — confirm-lock still holds', () => {
  const guyClient = {
    id: 'Z2lkOi8vSm9iYmVyL0NsaWVudC8xNDYyMTg4NTI=',
    name: 'Edward Guys',
    phones: [{ number: '949-903-9486' }],
  };

  it('refuses to confirm a time when checkSchedule is empty', async () => {
    const { result } = await handleCheckSchedule(
      { phone: '9499039486', city: 'Ramona', intent: 'book' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockJobber({ clients: [guyClient] }),
      }
    );

    assert.equal(result.hasAppointments, false);
    assert.equal(result.canConfirm, false);
    assert.equal(result.mayBook, true);
    assert.ok((result.openSlots || []).length > 0);
    assert.equal(/travis|i see it|you're all set/i.test(result.message), false);
  });

  it('refuses to confirm a time when checkSchedule errors', async () => {
    const { result } = await handleCheckSchedule(
      { phone: '9499039486', city: 'Ramona', intent: 'book' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockJobber({ httpError: 503 }),
      }
    );

    assert.equal(result.lookupStatus, 'error');
    assert.equal(result.canConfirm, false);
    assert.equal(result.mayBook, false);
    assert.deepEqual(result.openSlots || [], []);
    assert.match(result.message, /office/i);
  });

  it('returns no bookable slots when Jobber only has Travis (or other non-service techs)', async () => {
    const { result } = await handleCheckSchedule(
      { phone: '9499039486', city: 'Ramona', intent: 'book' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockJobber({
          users: [TRAVIS],
          clients: [guyClient],
        }),
      }
    );

    assert.equal(result.canConfirm, false);
    assert.equal(result.mayBook, false);
    assert.deepEqual(result.openSlots, []);
    assert.equal(result.assignedTechId || null, null);
  });

  it('daytime weekday checkSchedule does not offer bookable slots', async () => {
    const { result } = await handleCheckSchedule(
      { phone: '9499039486', city: 'Ramona', intent: 'book' },
      {
        now: THU_4PM,
        accessToken: 'test-token',
        fetchFn: mockJobber({ clients: [guyClient] }),
      }
    );

    assert.equal(result.mayBook, false);
    assert.deepEqual(result.openSlots, []);
    assert.equal(result.bookingBlockReason, 'daytime_weekday');
    assert.equal(result.canConfirm, false);
  });
});
