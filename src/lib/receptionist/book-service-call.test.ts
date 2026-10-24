import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPEAT_VISIT_INSTRUCTIONS,
  REPEAT_VISIT_LINE_DESCRIPTION,
  REPEAT_VISIT_TITLE_PREFIX,
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
import { joinUniqueTexts, appendOfficeNotes } from './office-callback.ts';

const THU_4PM = new Date('2026-09-03T23:00:00.000Z');
const THU_530PM = new Date('2026-09-04T00:30:00.000Z');
const FRI_6PM = new Date('2026-09-05T01:00:00.000Z');
const SAT_10AM = new Date('2026-09-05T17:00:00.000Z');
/** Saturday Sep 5 2026 8:00 AM PT — bookable only for a weekend-roster tech. */
const SAT_8AM_START = '2026-09-05T15:00:00.000Z';

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

    if (query.includes('VisitCreate')) {
      const nodes = options.createdJob?.visits?.nodes || [];
      return jsonResponse({ data: { visitCreate: { createdVisits: nodes, userErrors: [] } } });
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
    properties: [{ id: 'prop-1', address: { street1: '100 Well Rd', city: 'Ramona', postalCode: '92065' } }],
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
    assert.equal(
      pickExistingClient(
        [
          {
            ...existing,
            properties: {
              nodes: [{ id: 'prop-1', address: { street1: '100 Well Rd', city: 'Ramona' } }],
            },
          },
        ],
        { address: '100 Well Road', city: 'Ramona' }
      )?.matchedBy,
      'address'
    );
  });
});

describe('splitCallerName', () => {
  it('splits a full name', () => {
    assert.deepEqual(splitCallerName({ name: 'Pat Wells' }), { firstName: 'Pat', lastName: 'Wells' });
  });
});

describe('handleBookServiceCall', () => {
  it('daytime weekday path does not book when SARAH_BLOCK_DAYTIME_BOOKING=1', async () => {
    process.env.SARAH_BLOCK_DAYTIME_BOOKING = '1';
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
    delete process.env.SARAH_BLOCK_DAYTIME_BOOKING;
    assert.equal(result.bookingBlockReason, 'daytime_weekday');
    assert.match(result.message, /Liz|office/i);
  });

  it('weekday daytime books a no-water caller on an open slot (startAt and date/time preference both work)', async () => {
    const slot = firstOpenSlot(THU_4PM, 'user-brian', 'Brian Eads');
    const job = {
      id: 'job-day',
      title: SERVICE_CALL_TITLE,
      visits: {
        nodes: [
          {
            id: 'visit-day',
            startAt: slot.startAt,
            endAt: slot.endAt,
            assignedUsers: { nodes: [{ id: 'user-brian', name: { full: 'Brian Eads' } }] },
          },
        ],
      },
    };
    for (const input of [
      { startAt: slot.startAt },
      { preferredDate: slot.startAt.slice(0, 10), preferredTime: slot.time },
    ]) {
      const { result } = await handleBookServiceCall(
        {
          phone: '7605550100',
          name: 'Pat Wells',
          address: '100 Well Rd',
          city: 'Ramona',
          urgency: 'urgent',
          notes: 'no water at all',
          ...input,
        },
        { now: THU_4PM, accessToken: 'test-token', fetchFn: mockJobber({ createdJob: job }) }
      );
      assert.equal(result.booked, true, JSON.stringify(result));
      assert.equal(result.canConfirm, true);
      assert.equal(result.visit?.startAt, slot.startAt);
    }
  });

  it('weekend no-water caller books the earliest weekday slot by default', async () => {
    const monday = firstOpenSlot(SAT_10AM, 'user-brian', 'Brian Eads');
    assert.match(monday.date, /Monday/i);
    const { result } = await handleBookServiceCall(
      {
        phone: '7605550100',
        name: 'Pat Wells',
        address: '100 Well Rd',
        city: 'Ramona',
        startAt: monday.startAt,
        urgency: 'emergency',
        needNow: true,
        notes: 'no water at all',
      },
      {
        now: SAT_10AM,
        accessToken: 'test-token',
        fetchFn: mockJobber({
          createdJob: {
            id: 'job-sat',
            title: SERVICE_CALL_TITLE,
            visits: {
              nodes: [
                {
                  id: 'visit-sat',
                  startAt: monday.startAt,
                  endAt: monday.endAt,
                  assignedUsers: { nodes: [{ id: 'user-brian', name: { full: 'Brian Eads' } }] },
                },
              ],
            },
          },
        }),
      }
    );
    assert.equal(result.booked, true, JSON.stringify(result));
    assert.match(result.visit?.date || '', /Monday/i);
  });

  it('weekend emergency does not auto-book Monday and flags the shop (SARAH_BLOCK_WEEKEND_BOOKING=1)', async () => {
    process.env.SARAH_BLOCK_WEEKEND_BOOKING = '1';
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

    delete process.env.SARAH_BLOCK_WEEKEND_BOOKING;
    assert.equal(result.booked, false);
    assert.equal(result.canConfirm, false);
    assert.equal(result.weekendEmergency, true);
    assert.equal(result.bookingBlockReason, 'weekend_emergency');
    assert.deepEqual(flags, ['weekend_emergency']);
    assert.match(result.message, /Monday/i);
    assert.match(weekendEmergencyFlag({ name: 'Pat Wells' }).subject, /do not book Monday/i);
  });

  it('refuses a Saturday or Sunday startAt when no tech works weekends', async () => {
    const { result } = await handleBookServiceCall(
      {
        phone: '7605550100',
        name: 'Pat Wells',
        address: '100 Well Rd',
        city: 'Ramona',
        startAt: SAT_8AM_START,
        urgency: 'normal',
      },
      {
        now: FRI_6PM,
        accessToken: 'test-token',
        fetchFn: async () => {
          throw new Error('should not create a Saturday Jobber visit');
        },
      }
    );

    assert.equal(result.booked, false);
    assert.equal(result.canConfirm, false);
    assert.equal(result.bookingBlockReason, 'weekend_visit');
    assert.match(result.message, /weekend time open/i);
    assert.doesNotMatch(result.message, /Monday through Friday/i);
  });

  it('Friday night after-hours books the next weekday (Monday), not Saturday', async () => {
    const monday = firstOpenSlot(FRI_6PM, 'user-brian', 'Brian Eads');
    assert.match(monday.date, /Monday/i);
    const { result } = await handleBookServiceCall(
      {
        phone: '7605550100',
        name: 'Pat Wells',
        address: '100 Well Rd',
        city: 'Ramona',
        startAt: monday.startAt,
        urgency: 'normal',
      },
      {
        now: FRI_6PM,
        accessToken: 'test-token',
        fetchFn: mockJobber({
          createdJob: {
            id: 'job-monday',
            title: SERVICE_CALL_TITLE,
            visits: {
              nodes: [
                {
                  id: 'visit-monday',
                  startAt: monday.startAt,
                  endAt: monday.endAt,
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
    assert.equal(result.visit?.startAt, monday.startAt);
    assert.match(result.visit?.date || '', /Monday/i);
    assert.deepEqual(result.visit?.technicians, ['Brian Eads']);
  });

  it('books a Saturday visit when the tech is on the weekend roster (same tech/board logic)', async () => {
    const env = { ...process.env, RECEPTIONIST_WEEKEND_TECHS: 'Brian Eads' } as NodeJS.ProcessEnv;
    const { result } = await handleBookServiceCall(
      {
        phone: '7605550100',
        name: 'Pat Wells',
        address: '100 Well Rd',
        city: 'Ramona',
        startAt: SAT_8AM_START,
        urgency: 'normal',
      },
      {
        now: FRI_6PM,
        accessToken: 'test-token',
        env,
        fetchFn: mockJobber({
          createdJob: {
            id: 'job-saturday',
            title: SERVICE_CALL_TITLE,
            visits: {
              nodes: [
                {
                  id: 'visit-saturday',
                  startAt: SAT_8AM_START,
                  endAt: '2026-09-05T17:00:00.000Z',
                  assignedUsers: { nodes: [{ id: 'user-brian', name: { full: 'Brian Eads' } }] },
                },
              ],
            },
          },
        }),
      }
    );

    assert.equal(result.booked, true, result.message);
    assert.equal(result.canConfirm, true);
    assert.equal(result.visit?.startAt, SAT_8AM_START);
    assert.match(result.visit?.date || '', /Saturday/i);
    assert.deepEqual(result.visit?.technicians, ['Brian Eads']);
  });

  it('books Saturday for Jeremiah and keeps a free Monday on Brian', async () => {
    const jeremiah = {
      id: 'Z2lkOi8vSm9iYmVyL1VzZXIvNDQzODgyOQ==',
      name: { full: 'Jeremiah Biliunas' },
      email: { raw: 'jeremiah@scwellservice.com' },
    };
    const env = { ...process.env, RECEPTIONIST_WEEKEND_TECHS: 'Jeremiah Biliunas' } as NodeJS.ProcessEnv;
    const users = [BRIAN, COWIN, DOUG, TRAVIS, jeremiah];
    const mondayStart = '2026-09-07T15:00:00.000Z';

    async function book(startAt: string, assignee: { id: string; name: string }, occupied: unknown[] = []) {
      const bodies: GraphqlBody[] = [];
      const inner = mockJobber({
        users,
        occupied,
        createdJob: {
          id: 'job-1',
          title: SERVICE_CALL_TITLE,
          visits: {
            nodes: [
              {
                id: 'visit-1',
                startAt,
                endAt: new Date(new Date(startAt).getTime() + 2 * 60 * 60 * 1000).toISOString(),
                assignedUsers: { nodes: [{ id: assignee.id, name: { full: assignee.name } }] },
              },
            ],
          },
        },
      });
      const { result } = await handleBookServiceCall(
        {
          phone: '7605550100',
          name: 'Pat Wells',
          address: '100 Well Rd',
          city: 'Ramona',
          startAt,
          urgency: 'normal',
        },
        {
          now: startAt === SAT_8AM_START ? FRI_6PM : new Date('2026-09-07T01:00:00.000Z'),
          accessToken: 'test-token',
          env,
          fetchFn: async (url, init) => {
            bodies.push(JSON.parse(String(init?.body || '{}')) as GraphqlBody);
            return inner(url, init);
          },
        }
      );
      return { result, bodies };
    }

    const saturday = await book(SAT_8AM_START, { id: jeremiah.id, name: 'Jeremiah Biliunas' });
    assert.equal(saturday.result.booked, true, saturday.result.message);
    assert.match(saturday.result.visit?.date || '', /Saturday/i);
    assert.deepEqual(saturday.result.visit?.technicians, ['Jeremiah Biliunas']);
    const saturdayVisit = saturday.bodies.find((body) => (body.query || '').includes('VisitCreate'));
    const saturdaySchedule = (saturdayVisit?.variables?.input as { visits?: Array<{ schedule?: { teamMemberIdsToAssign?: string[] } }> })
      ?.visits?.[0]?.schedule;
    assert.deepEqual(saturdaySchedule?.teamMemberIdsToAssign, [jeremiah.id]);

    const monday = await book(mondayStart, { id: 'user-brian', name: 'Brian Eads' });
    assert.equal(monday.result.booked, true, monday.result.message);
    assert.match(monday.result.visit?.date || '', /Monday/i);
    assert.deepEqual(monday.result.visit?.technicians, ['Brian Eads']);
    const mondayVisit = monday.bodies.find((body) => (body.query || '').includes('VisitCreate'));
    const mondaySchedule = (mondayVisit?.variables?.input as { visits?: Array<{ schedule?: { teamMemberIdsToAssign?: string[] } }> })
      ?.visits?.[0]?.schedule;
    assert.deepEqual(mondaySchedule?.teamMemberIdsToAssign, ['user-brian']);
  });

  it('books a Wednesday for Jeremiah when Brian is already on that window', async () => {
    const jeremiah = {
      id: 'Z2lkOi8vSm9iYmVyL1VzZXIvNDQzODgyOQ==',
      name: { full: 'Jeremiah Biliunas' },
      email: { raw: 'jeremiah@scwellservice.com' },
    };
    const wednesday = '2026-09-09T15:00:00.000Z';
    const env = { ...process.env, RECEPTIONIST_WEEKEND_TECHS: '' } as NodeJS.ProcessEnv;
    const bodies: GraphqlBody[] = [];
    const inner = mockJobber({
      users: [BRIAN, COWIN, DOUG, TRAVIS, jeremiah],
      occupied: [
        {
          startAt: wednesday,
          endAt: '2026-09-09T17:00:00.000Z',
          assignedUsers: { nodes: [{ id: 'user-brian', name: { full: 'Brian Eads' } }] },
        },
      ],
      createdJob: {
        id: 'job-wednesday',
        title: SERVICE_CALL_TITLE,
        visits: {
          nodes: [
            {
              id: 'visit-wednesday',
              startAt: wednesday,
              endAt: '2026-09-09T17:00:00.000Z',
              assignedUsers: { nodes: [{ id: jeremiah.id, name: { full: 'Jeremiah Biliunas' } }] },
            },
          ],
        },
      },
    });
    const { result } = await handleBookServiceCall(
      {
        phone: '7605550100',
        name: 'Pat Wells',
        address: '100 Well Rd',
        city: 'Ramona',
        startAt: wednesday,
        urgency: 'normal',
      },
      {
        now: new Date('2026-09-09T01:00:00.000Z'),
        accessToken: 'test-token',
        env,
        fetchFn: async (url, init) => {
          bodies.push(JSON.parse(String(init?.body || '{}')) as GraphqlBody);
          return inner(url, init);
        },
      }
    );

    assert.equal(result.booked, true, result.message);
    assert.match(result.visit?.date || '', /Wednesday/i);
    assert.deepEqual(result.visit?.technicians, ['Jeremiah Biliunas']);
    const visitCreate = bodies.find((body) => (body.query || '').includes('VisitCreate'));
    const schedule = (visitCreate?.variables?.input as { visits?: Array<{ schedule?: { teamMemberIdsToAssign?: string[] } }> })
      ?.visits?.[0]?.schedule;
    assert.deepEqual(schedule?.teamMemberIdsToAssign, [jeremiah.id]);
  });

  it('creates a Ramona Service Call visit assigned to Brian Eads', async () => {
    const slot = firstOpenSlot(THU_530PM, 'user-brian', 'Brian Eads');
    const bodies: string[] = [];
    const inner = mockJobber({
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
    });
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
        fetchFn: async (url, init) => {
          bodies.push(String(init?.body || ''));
          return inner(url, init);
        },
      }
    );

    assert.equal(result.booked, true);
    assert.equal(result.canConfirm, true);
    assert.equal(result.visit?.title, SERVICE_CALL_TITLE);
    assert.deepEqual(result.visit?.technicians, ['Brian Eads']);
    assert.equal(result.visit?.startAt, slot.startAt);
    assert.equal(result.assignedTechName, 'Brian Eads');
    assert.equal(SERVICE_CALL_PRICE_USD, 200);
    const query =
      (JSON.parse(bodies.find((body) => body.includes('SearchClients') && body.includes('properties')) || '{}') as { query?: string })
        .query || '';
    assert.match(query, /SearchClients/);
    assert.equal(/properties\s*\(\s*first\s*:/.test(query), false);
    assert.equal(/properties\s*\{\s*nodes/.test(query), false);
    assert.match(query, /properties\s*\{\s*id/);
    const propBody = bodies.find((body) => body.includes('PropertyCreate'));
    if (propBody) {
      const input = (JSON.parse(propBody) as { variables?: { input?: Record<string, unknown> } }).variables?.input;
      assert.ok(Array.isArray(input?.properties), 'PropertyCreateInput must be { properties: [{ address }] }');
      assert.equal('address' in (input || {}), false);
    }
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
      properties: [{ id: 'prop-existing', address: { street1: '100 Well Rd', city: 'Ramona' } }],
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
    assert.equal(isSarahServiceCallTitle(`${REPEAT_VISIT_TITLE_PREFIX}: Service Call`), true);
  });

  it('repeat or warranty bookings prefix the title and zero the service-call line', async () => {
    const slot = firstOpenSlot(THU_530PM, 'user-brian', 'Brian Eads');
    const title = `${REPEAT_VISIT_TITLE_PREFIX}: ${SERVICE_CALL_TITLE}`;
    const book = async (input: { repeatVisit?: boolean; notes?: string }) => {
      const bodies: string[] = [];
      const inner = mockJobber({
        createdJob: {
          id: 'job-repeat',
          title,
          visits: {
            nodes: [{
              id: 'visit-repeat',
              startAt: slot.startAt,
              endAt: slot.endAt,
              assignedUsers: { nodes: [{ id: 'user-brian', name: { full: 'Brian Eads' } }] },
            }],
          },
        },
      });
      const { result } = await handleBookServiceCall(
        {
          phone: '6194459250',
          name: 'Edward Wortley',
          address: '100 Well Rd',
          city: 'Ramona',
          startAt: slot.startAt,
          ...input,
        },
        {
          now: THU_530PM,
          accessToken: 'test-token',
          fetchFn: async (url, init) => {
            bodies.push(String(init?.body || ''));
            return inner(url, init);
          },
        },
      );
      return { result, bodies };
    };

    const repeat = await book({ repeatVisit: true, notes: 'squeaking pump after the April motor job' });
    assert.equal(repeat.result.booked, true);
    assert.equal(repeat.result.visit?.title, title);
    const jobBody = JSON.parse(repeat.bodies.find((body) => body.includes('JobCreate')) || '{}') as {
      query?: string;
      variables?: { input?: { title?: string; instructions?: string; lineItems?: Array<{ description?: string; unitPrice?: number; name?: string }> } };
    };
    assert.equal(jobBody.variables?.input?.title, title);
    assert.equal(jobBody.variables?.input?.instructions, REPEAT_VISIT_INSTRUCTIONS);
    assert.equal(jobBody.variables?.input?.lineItems?.[0].name, SERVICE_CALL_TITLE);
    assert.equal(jobBody.variables?.input?.lineItems?.[0].description, REPEAT_VISIT_LINE_DESCRIPTION);
    assert.equal(jobBody.variables?.input?.lineItems?.[0].unitPrice, 0);
    assert.equal(/invoiceCreate/i.test(repeat.bodies.join('\n')), false);
    const visitBody = JSON.parse(repeat.bodies.find((body) => body.includes('VisitCreate')) || '{}') as {
      variables?: { input?: { visits?: Array<{ title?: string; instructions?: string }> } };
    };
    assert.equal(visitBody.variables?.input?.visits?.[0].title, title);
    assert.equal(visitBody.variables?.input?.visits?.[0].instructions, REPEAT_VISIT_INSTRUCTIONS);

    const inferred = await book({ notes: 'Repeat visit, possible warranty, no charge until office reviews: April motor, squeak' });
    const inferredJob = JSON.parse(inferred.bodies.find((body) => body.includes('JobCreate')) || '{}') as {
      variables?: { input?: { title?: string; lineItems?: Array<{ unitPrice?: number }> } };
    };
    assert.equal(inferred.result.booked, true);
    assert.equal(inferredJob.variables?.input?.title, title);
    assert.equal(inferredJob.variables?.input?.lineItems?.[0].unitPrice, 0);

    const normalBodies: string[] = [];
    const normalInner = mockJobber({
      createdJob: {
        id: 'job-normal',
        title: SERVICE_CALL_TITLE,
        visits: {
          nodes: [{
            id: 'visit-normal',
            startAt: slot.startAt,
            endAt: slot.endAt,
            assignedUsers: { nodes: [{ id: 'user-brian', name: { full: 'Brian Eads' } }] },
          }],
        },
      },
    });
    const normal = await handleBookServiceCall(
      {
        phone: '7605550100',
        name: 'Pat Wells',
        address: '100 Well Rd',
        city: 'Ramona',
        startAt: slot.startAt,
        notes: 'no water',
      },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: async (url, init) => {
          normalBodies.push(String(init?.body || ''));
          return normalInner(url, init);
        },
      },
    );
    assert.equal(normal.result.booked, true);
    assert.equal(normal.result.visit?.title, SERVICE_CALL_TITLE);
    const normalJob = JSON.parse(normalBodies.find((body) => body.includes('JobCreate')) || '{}') as {
      variables?: { input?: { title?: string; instructions?: string; lineItems?: Array<{ description?: string; unitPrice?: number }> } };
    };
    assert.equal(normalJob.variables?.input?.title, SERVICE_CALL_TITLE);
    assert.equal(normalJob.variables?.input?.instructions, undefined);
    assert.equal(normalJob.variables?.input?.lineItems?.[0].description, 'Service call');
    assert.equal(normalJob.variables?.input?.lineItems?.[0].unitPrice, SERVICE_CALL_PRICE_USD);
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

  it('Friday night checkSchedule offers Monday and no weekend visits', async () => {
    const { result } = await handleCheckSchedule(
      { phone: '9499039486', city: 'Ramona', intent: 'book' },
      {
        now: FRI_6PM,
        accessToken: 'test-token',
        fetchFn: mockJobber({ clients: [guyClient] }),
      }
    );

    assert.equal(result.mayBook, true);
    assert.ok((result.openSlots || []).length > 0);
    assert.match(result.openSlots?.[0]?.date || '', /Monday/i);
    assert.equal(
      (result.openSlots || []).some((slot) => /saturday|sunday/i.test(slot.date)),
      false
    );
  });

  it('daytime weekday checkSchedule offers slots by default and exposes slotId/availableSlots aliases', async () => {
    const { result } = await handleCheckSchedule(
      { phone: '9499039486', city: 'Ramona', intent: 'book' },
      {
        now: THU_4PM,
        accessToken: 'test-token',
        fetchFn: mockJobber({ clients: [guyClient] }),
      }
    );
    assert.equal(result.mayBook, true);
    assert.ok((result.openSlots || []).length > 0);
    assert.deepEqual(result.availableSlots, result.openSlots);
    assert.equal(result.openSlots?.[0]?.slotId, result.openSlots?.[0]?.startAt);
  });

  it('daytime weekday checkSchedule does not offer bookable slots when SARAH_BLOCK_DAYTIME_BOOKING=1', async () => {
    process.env.SARAH_BLOCK_DAYTIME_BOOKING = '1';
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
    delete process.env.SARAH_BLOCK_DAYTIME_BOOKING;
    assert.equal(result.bookingBlockReason, 'daytime_weekday');
    assert.equal(result.canConfirm, false);
  });
});

describe('duplicate-booking guard', () => {
  const NOW = THU_530PM;
  const client: JobberClientNode = {
    id: 'client-1',
    name: 'Bradley Brockle',
    phones: [{ number: '619-879-1062' }],
  };
  const recentJob = (createdAt: string, street = '15788 Lyons Valley Rd') => ({
    title: 'Service Call',
    createdAt,
    property: { address: { street1: street, city: 'Jamul' } },
    visits: {
      nodes: [
        {
          startAt: '2026-09-08T15:00:00.000Z',
          endAt: '2026-09-08T17:00:00.000Z',
          allDay: false,
          assignedUsers: { nodes: [{ name: { full: 'Colton Hagler' } }] },
        },
      ],
    },
  });
  function jobberWith(jobs: unknown[], calls: string[]) {
    return async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as GraphqlBody;
      const query = body.query || '';
      calls.push(query);
      if (query.includes('SearchClients')) return jsonResponse({ data: { clients: { nodes: [client] } } });
      if (query.includes('GetUpcomingVisits')) return jsonResponse({ data: { client: { jobs: { nodes: jobs } } } });
      if (query.includes('ShopUsers')) return jsonResponse({ data: { users: { nodes: [BRIAN, COWIN, DOUG] } } });
      if (query.includes('OccupiedVisits')) return jsonResponse({ data: { visits: { nodes: [] } } });
      return jsonResponse({ errors: [{ message: 'unexpected ' + query.slice(0, 40) }] });
    };
  }
  const slot = () => firstOpenSlot(NOW, 'user-brian', 'Brian Eads');

  it('blocks a second booking when the caller booked in the last 3 days', async () => {
    const calls: string[] = [];
    const { result } = await handleBookServiceCall(
      { phone: '6198791062', name: 'Bradley Brockle', address: '15788 Lyons Valley Road', city: 'Jamul', startAt: slot().startAt },
      { now: NOW, accessToken: 't', fetchFn: jobberWith([recentJob('2026-09-02T20:00:00.000Z')], calls) }
    );
    assert.equal(result.booked, false);
    assert.equal(result.alreadyBooked, true);
    assert.equal(result.bookingBlockReason, 'already_booked');
    assert.match(result.message, /already booked/i);
    assert.match(result.message, /keep it or move it/i);
    assert.equal(calls.some((q) => q.includes('JobCreate') || q.includes('VisitCreate')), false);
  });

  it('does not block when the existing job is older than 3 days', async () => {
    const calls: string[] = [];
    const { result } = await handleBookServiceCall(
      { phone: '6198791062', name: 'Bradley Brockle', address: '15788 Lyons Valley Rd', city: 'Jamul', startAt: slot().startAt },
      { now: NOW, accessToken: 't', fetchFn: jobberWith([recentJob('2026-08-20T20:00:00.000Z')], calls) }
    );
    assert.notEqual(result.bookingBlockReason, 'already_booked');
  });

  it('allows a second job for a different address', async () => {
    const calls: string[] = [];
    const { result } = await handleBookServiceCall(
      { phone: '6198791062', name: 'Bradley Brockle', address: '9 Other Way', city: 'Jamul', startAt: slot().startAt },
      { now: NOW, accessToken: 't', fetchFn: jobberWith([recentJob('2026-09-02T20:00:00.000Z')], calls) }
    );
    assert.notEqual(result.bookingBlockReason, 'already_booked');
  });

  it('allows a second job when the caller says it is a different problem', async () => {
    const calls: string[] = [];
    const { result } = await handleBookServiceCall(
      { phone: '6198791062', name: 'Bradley Brockle', address: '15788 Lyons Valley Rd', city: 'Jamul', startAt: slot().startAt, differentProblem: true },
      { now: NOW, accessToken: 't', fetchFn: jobberWith([recentJob('2026-09-02T20:00:00.000Z')], calls) }
    );
    assert.notEqual(result.bookingBlockReason, 'already_booked');
  });

  it('checkSchedule returns the existing booking and no open slots', async () => {
    const calls: string[] = [];
    const { result } = await handleCheckSchedule(
      { phone: '6198791062', city: 'Jamul', address: '15788 Lyons Valley Rd', intent: 'book' },
      { now: NOW, accessToken: 't', fetchFn: jobberWith([recentJob('2026-09-02T20:00:00.000Z')], calls) }
    );
    assert.equal(result.alreadyBooked, true);
    assert.equal(result.mayBook, false);
    assert.equal(result.recentBooking?.technicians[0], 'Colton Hagler');
    assert.deepEqual(result.openSlots, []);
    assert.match(result.bookingMessage || '', /already booked/i);
  });
});

describe('repeated note dedupe', () => {
  it('collapses the same sentences passed by booking, flag and callback', () => {
    const out = joinUniqueTexts([
      'No water, tripped breaker. Booked placeholder Tuesday.',
      'No water, tripped breaker. Booked placeholder Tuesday.',
      'no water tripped breaker!  Booked placeholder Tuesday. Wants a call now.',
    ]);
    assert.equal(out.match(/tripped breaker/gi)?.length, 1);
    assert.equal(out.match(/Booked placeholder/gi)?.length, 1);
    assert.match(out, /Wants a call now/);
  });

  it('does not re-append sentences already in the stored notes', () => {
    const existing = 'Mike requested a callback.\nReason: No water, tripped breaker. Booked placeholder Tuesday.';
    const merged = appendOfficeNotes(
      existing,
      { kind: 'emergency', name: '', phone: '1', email: '', address: '', city: '', reason: 'No water, tripped breaker. Booked placeholder Tuesday. Wants live call.', repeatCaller: null },
      false
    );
    assert.equal(merged.match(/tripped breaker/gi)?.length, 1);
    assert.match(merged, /Wants live call/);
  });
});
