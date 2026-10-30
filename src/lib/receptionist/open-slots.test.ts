import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOT_HOURS_PT,
  computeOpenSlots,
  extraSlotDayAllowed,
  isVisitDayAllowed,
  isWeekdayVisitStart,
  lookupOpenSlots,
  techWorksWeekends,
  weekendTechNames,
  mergeOpenSlots,
  mergeWithFallbackSlots,
  ptWeekday,
  slotMatchesRequest,
  visitsOverlapSlot,
} from './open-slots.ts';

const envOf = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

/** Thursday Sep 3 2026 5:30 PM PT */
const THU_530PM = new Date('2026-09-04T00:30:00.000Z');

describe('computeOpenSlots', () => {
  it('returns Jobber-derived openings and drops times the tech is already booked', () => {
    const fridayEight = computeOpenSlots({
      occupied: [],
      now: THU_530PM,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 3,
    });

    assert.ok(fridayEight.length >= 1);
    assert.equal(fridayEight[0].technician, 'Brian Eads');
    assert.equal(fridayEight[0].technicianId, 'user-brian');
    assert.match(fridayEight[0].date, /Friday/i);

    const blocked = computeOpenSlots({
      occupied: [
        {
          startAt: fridayEight[0].startAt,
          endAt: fridayEight[0].endAt,
          technicianIds: ['user-brian'],
          technicianNames: ['Brian Eads'],
        },
      ],
      now: THU_530PM,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 3,
    });

    assert.equal(
      blocked.some((slot) => slot.startAt === fridayEight[0].startAt),
      false
    );
    assert.ok(blocked.length >= 1);
  });

  it('keeps an internal visit on the calendar so that time stays blocked', () => {
    const open = computeOpenSlots({
      occupied: [],
      now: THU_530PM,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 1,
    });
    const slot = open[0];
    for (const title of ['Shop Meeting - Anza', 'Safety meeting', 'PTO - Cowin', 'Training: new hire']) {
      const blocked = computeOpenSlots({
        occupied: [
          {
            startAt: slot.startAt,
            endAt: slot.endAt,
            title,
            jobTitle: title,
            technicianIds: ['user-brian'],
            technicianNames: ['Brian Eads'],
          },
        ],
        now: THU_530PM,
        technicianId: 'user-brian',
        technicianName: 'Brian Eads',
        maxSlots: 3,
      });
      assert.equal(blocked.some((row) => row.startAt === slot.startAt), false, title);
    }
  });

  it('no weekend roster: never returns Saturday or Sunday visit windows', () => {
    const slots = computeOpenSlots({
      occupied: [],
      now: THU_530PM,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 20,
    });
    assert.ok(slots.length >= 3);
    for (const slot of slots) {
      assert.equal(isWeekdayVisitStart(slot.startAt), true);
      const weekday = ptWeekday(new Date(slot.startAt));
      assert.ok(weekday >= 1 && weekday <= 5, `unexpected weekend slot ${slot.date}`);
      assert.equal(/saturday|sunday/i.test(slot.date), false);
    }
  });

  it('no weekend roster: Friday night after-hours offers Monday, not Saturday or Sunday', () => {
    const fridayNight = new Date('2026-09-05T01:00:00.000Z');
    const slots = computeOpenSlots({
      occupied: [],
      now: fridayNight,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 3,
    });
    assert.ok(slots.length >= 1);
    assert.match(slots[0].date, /Monday/i);
    assert.equal(
      slots.some((slot) => /saturday|sunday/i.test(slot.date)),
      false
    );
  });

  it('does not invent a slot that overlaps an all-day Jobber visit', () => {
    const open = computeOpenSlots({
      occupied: [],
      now: THU_530PM,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 1,
    });
    const day = open[0];
    const blocked = computeOpenSlots({
      occupied: [
        {
          startAt: day.startAt,
          allDay: true,
          title: 'Install new pump',
          technicianIds: ['user-brian'],
          technicianNames: ['Brian Eads'],
        },
      ],
      now: THU_530PM,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 3,
    });
    assert.equal(
      blocked.some((slot) => slot.date === day.date),
      false
    );
  });
});

describe('weekend visits (open 7 days, Oct 18 2026)', () => {
  const fridayNight = new Date('2026-09-05T01:00:00.000Z'); // Fri Sep 4 6 PM PT
  it('a tech on the weekend roster gets Saturday 8 AM first, same board rules', () => {
    const slots = computeOpenSlots({
      occupied: [],
      now: fridayNight,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 3,
      env: envOf({ RECEPTIONIST_WEEKEND_TECHS: 'Brian Eads' }),
    });
    assert.match(slots[0].date, /Saturday/i);
    assert.equal(slots[0].startAt, '2026-09-05T15:00:00.000Z');
    const busy = computeOpenSlots({
      occupied: [{ startAt: '2026-09-05T15:00:00.000Z', allDay: true, title: 'Drill new well', technicianIds: ['user-brian'], technicianNames: ['Brian Eads'] }],
      now: fridayNight,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 3,
      allowWeekend: true,
    });
    assert.match(busy[0].date, /Sunday/i);
  });
  it('a tech not on the roster stays weekday-only', () => {
    const slots = computeOpenSlots({
      occupied: [],
      now: fridayNight,
      technicianId: 'user-doug',
      technicianName: 'Doug Pollack',
      maxSlots: 3,
      env: envOf({ RECEPTIONIST_WEEKEND_TECHS: 'Brian Eads' }),
    });
    assert.match(slots[0].date, /Monday/i);
  });
  it('parses RECEPTIONIST_WEEKEND_TECHS', () => {
    assert.deepEqual(weekendTechNames(envOf({})), []);
    assert.equal(weekendTechNames(envOf({ RECEPTIONIST_WEEKEND_TECHS: 'all' })), 'all');
    assert.deepEqual(weekendTechNames(envOf({ RECEPTIONIST_WEEKEND_TECHS: ' Brian Eads, Cowin ' })), ['brian eads', 'cowin']);
    assert.equal(techWorksWeekends('Cowin', envOf({ RECEPTIONIST_WEEKEND_TECHS: 'brian eads,cowin' })), true);
    assert.equal(techWorksWeekends('Doug Pollack', envOf({ RECEPTIONIST_WEEKEND_TECHS: 'brian eads,cowin' })), false);
    assert.equal(techWorksWeekends('Anyone', envOf({ RECEPTIONIST_WEEKEND_TECHS: 'all' })), true);
  });
  it('isVisitDayAllowed: weekdays always, weekends only for roster techs', () => {
    const sat = '2026-09-05T15:00:00.000Z';
    const mon = '2026-09-07T15:00:00.000Z';
    const env = envOf({ RECEPTIONIST_WEEKEND_TECHS: 'Cowin' });
    assert.equal(isVisitDayAllowed(mon, 'Brian Eads', env), true);
    assert.equal(isVisitDayAllowed(sat, 'Brian Eads', env), false);
    assert.equal(isVisitDayAllowed(sat, 'Cowin', env), true);
    assert.equal(isVisitDayAllowed('', 'Cowin', env), false);
  });
});

describe('isWeekdayVisitStart', () => {
  it('allows Monday–Friday PT and rejects Saturday and Sunday', () => {
    assert.equal(isWeekdayVisitStart('2026-09-07T15:00:00.000Z'), true); // Monday 8am PT
    assert.equal(isWeekdayVisitStart('2026-09-04T15:00:00.000Z'), true); // Friday 8am PT
    assert.equal(isWeekdayVisitStart('2026-09-05T15:00:00.000Z'), false); // Saturday 8am PT
    assert.equal(isWeekdayVisitStart('2026-09-06T15:00:00.000Z'), false); // Sunday 8am PT
    assert.equal(isWeekdayVisitStart(''), false);
  });
});

describe('visitsOverlapSlot / slotMatchesRequest', () => {
  it('treats overlapping windows as occupied', () => {
    const start = new Date('2026-09-04T15:00:00.000Z');
    const end = new Date('2026-09-04T17:00:00.000Z');
    assert.equal(
      visitsOverlapSlot(
        { startAt: '2026-09-04T16:00:00.000Z', endAt: '2026-09-04T17:00:00.000Z' },
        start,
        end
      ),
      true
    );
    assert.equal(
      visitsOverlapSlot(
        { startAt: '2026-09-04T18:00:00.000Z', endAt: '2026-09-04T19:00:00.000Z' },
        start,
        end
      ),
      false
    );
  });

  it('keeps the first allowlisted tech at a shared window', () => {
    const doug = {
      startAt: '2026-09-04T15:00:00.000Z',
      endAt: '2026-09-04T17:00:00.000Z',
      date: 'Friday, September 4',
      time: 'starting at 8:00 AM',
      technician: 'Doug Pollack',
      technicianId: 'user-doug',
    };
    const cowin = { ...doug, technician: 'Cowin', technicianId: 'user-cowin' };
    const merged = mergeOpenSlots([[doug], [cowin]]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].technicianId, 'user-doug');
  });

  it('matches an exact open-slot startAt', () => {
    const slot = {
      startAt: '2026-09-04T15:00:00.000Z',
      endAt: '2026-09-04T17:00:00.000Z',
      date: 'Friday, September 4',
      time: 'starting at 8:00 AM',
      technician: 'Brian Eads',
      technicianId: 'user-brian',
    };
    assert.equal(slotMatchesRequest(slot, '2026-09-04T15:00:00.000Z'), true);
    assert.equal(slotMatchesRequest(slot, '2026-09-08T15:00:00.000Z'), false);
  });
});

const BRIAN = { id: 'user-brian', name: { full: 'Brian Eads' }, email: { raw: 'brian@scwellservice.com' } };
const COWIN = { id: 'user-cowin', name: { full: 'Cowin' }, email: { raw: 'cowin@scwellservice.com' } };
const DOUG = { id: 'user-doug', name: { full: 'Doug Pollack' } };
const TRAVIS = { id: 'user-travis', name: { full: 'Travis C Sego' }, email: { raw: 'travis@scwellservice.com' } };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockUsersAndVisits(
  users: Array<{ id: string; name: { full: string }; email?: { raw: string } }>,
  occupied: unknown[] = []
) {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as { query?: string };
    const query = body.query || '';
    if (query.includes('ShopUsers')) {
      return jsonResponse({ data: { users: { nodes: users } } });
    }
    if (query.includes('OccupiedVisits')) {
      return jsonResponse({ data: { visits: { nodes: occupied } } });
    }
    return jsonResponse({ errors: [{ message: 'unexpected query' }] });
  };
}

describe('lookupOpenSlots — Brighton allowlist', () => {
  it('limits assignedUsers so the occupied-visits query stays under Jobber max cost', async () => {
    let visitsQuery = '';
    await lookupOpenSlots(
      { city: 'Ramona' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: async (_url, init) => {
          const body = JSON.parse(String(init?.body || '{}')) as { query?: string };
          const query = body.query || '';
          if (query.includes('ShopUsers')) {
            return jsonResponse({ data: { users: { nodes: [BRIAN] } } });
          }
          visitsQuery = query;
          return jsonResponse({ data: { visits: { nodes: [] } } });
        },
      }
    );
    assert.match(visitsQuery, /assignedUsers\(first: 5\)/);
    assert.equal(/assignedUsers\s*\{/.test(visitsQuery), false);
  });

  it('waits out a Jobber throttle and still returns open slots', async () => {
    const waits: number[] = [];
    let visitsCalls = 0;
    const result = await lookupOpenSlots(
      { city: 'Valley Center' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        sleep: async (ms) => { waits.push(ms); },
        fetchFn: async (_url, init) => {
          const body = JSON.parse(String(init?.body || '{}')) as { query?: string };
          const query = body.query || '';
          if (query.includes('ShopUsers')) {
            return jsonResponse({ data: { users: { nodes: [BRIAN] } } });
          }
          visitsCalls += 1;
          if (visitsCalls === 1) {
            return jsonResponse({
              errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
              extensions: {
                cost: {
                  requestedQueryCost: 1800,
                  throttleStatus: { maximumAvailable: 10_000, currentlyAvailable: 0, restoreRate: 500 },
                },
              },
            });
          }
          return jsonResponse({ data: { visits: { nodes: [], pageInfo: { hasNextPage: false } } } });
        },
      }
    );
    assert.equal(visitsCalls, 2);
    assert.deepEqual(waits, [4000]);
    assert.equal(result.lookupStatus, 'ok');
    assert.ok(result.openSlots.length > 0);
    assert.equal(result.assignedTechName, 'Brian Eads');
  });

  it('steps down when the calendar query costs more than Jobber allows', async () => {
    const queries: string[] = [];
    const result = await lookupOpenSlots(
      { city: 'Ramona' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        sleep: async () => { throw new Error('over-cost must not wait'); },
        fetchFn: async (_url, init) => {
          const body = JSON.parse(String(init?.body || '{}')) as { query?: string };
          const query = body.query || '';
          if (query.includes('ShopUsers')) {
            return jsonResponse({ data: { users: { nodes: [BRIAN] } } });
          }
          queries.push(query);
          if (query.includes('property')) {
            return jsonResponse({
              errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
              extensions: {
                cost: {
                  requestedQueryCost: 12_000,
                  throttleStatus: { maximumAvailable: 10_000, currentlyAvailable: 10_000, restoreRate: 500 },
                },
              },
            });
          }
          return jsonResponse({ data: { visits: { nodes: [], pageInfo: { hasNextPage: false } } } });
        },
      }
    );
    assert.equal(queries.length, 2);
    assert.match(queries[0], /property/);
    assert.doesNotMatch(queries[1], /property/);
    assert.equal(result.lookupStatus, 'ok');
    assert.ok(result.openSlots.length > 0);
  });

  it('Anza: Doug (deactivated) open and Cowin booked → never offers Doug, never Travis', async () => {
    const friday = computeOpenSlots({
      occupied: [],
      now: THU_530PM,
      technicianId: 'user-cowin',
      technicianName: 'Cowin',
      maxSlots: 1,
    })[0];
    const result = await lookupOpenSlots(
      { city: 'Anza' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockUsersAndVisits(
          [DOUG, COWIN, TRAVIS, BRIAN],
          [
            {
              startAt: friday.startAt,
              endAt: friday.endAt,
              assignedUsers: { nodes: [{ id: 'user-cowin', name: { full: 'Cowin' } }] },
            },
          ]
        ),
      }
    );

    assert.equal(result.lookupStatus, 'ok');
    assert.deepEqual(result.allowlistedTechIds.filter((id) => id === 'user-doug' || id === 'user-cowin'), ['user-cowin']);
    assert.equal(result.assignedTechName, 'Cowin');
    assert.equal(result.openSlots.some((slot) => slot.technicianId === 'user-doug' || /doug/i.test(slot.technician)), false);
    assert.equal(result.openSlots.some((slot) => slot.startAt === friday.startAt && slot.technicianId === 'user-cowin'), false);
    assert.equal(
      result.openSlots.some((slot) => slot.technicianId === 'user-travis' || slot.technician === 'Travis C Sego'),
      false
    );
  });

  it('Anza: Doug booked and Cowin open → Cowin', async () => {
    const friday = computeOpenSlots({
      occupied: [],
      now: THU_530PM,
      technicianId: 'user-doug',
      technicianName: 'Doug Pollack',
      maxSlots: 1,
    })[0];
    const result = await lookupOpenSlots(
      { city: 'Anza' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockUsersAndVisits(
          [DOUG, COWIN, TRAVIS],
          [
            {
              startAt: friday.startAt,
              endAt: friday.endAt,
              assignedUsers: { nodes: [{ id: 'user-doug', name: { full: 'Doug Pollack' } }] },
            },
          ]
        ),
      }
    );

    const first = result.openSlots.find((slot) => slot.startAt === friday.startAt);
    assert.ok(first);
    assert.equal(first?.technicianId, 'user-cowin');
    assert.equal(first?.technician, 'Cowin');
  });


  it('Ramona stays Brian Eads only even when Doug and Cowin are in Jobber', async () => {
    const result = await lookupOpenSlots(
      { city: 'Ramona' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockUsersAndVisits([DOUG, COWIN, TRAVIS, BRIAN]),
      }
    );

    assert.ok(result.openSlots.length > 0);
    assert.equal(result.assignedTechId, 'user-brian');
    assert.deepEqual(result.allowlistedTechIds, ['user-brian']);
    assert.equal(
      result.openSlots.every((slot) => slot.technicianId === 'user-brian'),
      true
    );
  });

  it('Borrego Springs: Anza techs booked, Brian open → Brian still bookable', async () => {
    const windows = computeOpenSlots({
      occupied: [],
      now: THU_530PM,
      technicianId: 'user-doug',
      technicianName: 'Doug Pollack',
      maxSlots: 50,
    });
    const occupied = windows.flatMap((slot) => [
      { startAt: slot.startAt, endAt: slot.endAt, assignedUsers: { nodes: [{ id: 'user-doug', name: { full: 'Doug Pollack' } }] } },
      { startAt: slot.startAt, endAt: slot.endAt, assignedUsers: { nodes: [{ id: 'user-cowin', name: { full: 'Cowin' } }] } },
    ]);
    const result = await lookupOpenSlots(
      { city: 'Borrego Springs' },
      { now: THU_530PM, accessToken: 'test-token', fetchFn: mockUsersAndVisits([DOUG, COWIN, TRAVIS, BRIAN], occupied) }
    );
    assert.ok(result.openSlots.length > 0);
    assert.equal(result.openSlots[0].technicianId, 'user-brian');
  });

  it('returns no slots when Jobber only has Travis', async () => {
    const result = await lookupOpenSlots(
      { city: 'Anza' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockUsersAndVisits([TRAVIS]),
      }
    );

    assert.deepEqual(result.openSlots, []);
    assert.deepEqual(result.allowlistedTechIds, []);
    assert.equal(result.assignedTechId, null);
  });
});

const CHRIS = { id: 'user-chris', name: { full: 'Chris Glass' }, email: { raw: 'christopher@scwellservice.com' } };
const HAZE = { id: 'user-haze', name: { full: 'Haze Tarbell' }, email: { raw: 'hazemtarbell@gmail.com' } };
const SERGIO = { id: 'user-sergio', name: { full: 'Sergio Valdovinos Mendez' }, email: { raw: 'sergio@scwellservice.com' } };

function visitFor(slot: { startAt: string; endAt: string }, id: string, name: string) {
  return { startAt: slot.startAt, endAt: slot.endAt, assignedUsers: { nodes: [{ id, name: { full: name } }] } };
}

describe('fallback techs', () => {
  const windows = computeOpenSlots({
    occupied: [],
    now: THU_530PM,
    technicianId: 'user-brian',
    technicianName: 'Brian Eads',
    maxSlots: 60,
  });
  const ALL = [BRIAN, COWIN, DOUG, TRAVIS, CHRIS, HAZE, SERGIO];

  it('mergeWithFallbackSlots: keeps only fallback slots strictly earlier than the first primary slot', () => {
    const mk = (i: number, id: string) => ({ ...windows[i], technician: id, technicianId: id });
    const merged = mergeWithFallbackSlots(
      [mk(2, 'user-brian'), mk(3, 'user-brian')],
      [mk(0, 'user-chris'), mk(2, 'user-haze'), mk(4, 'user-haze')]
    );
    assert.deepEqual(merged.map((s) => [s.startAt, s.technicianId]), [
      [windows[0].startAt, 'user-chris'],
      [windows[2].startAt, 'user-brian'],
      [windows[3].startAt, 'user-brian'],
    ]);
  });

  it('mergeWithFallbackSlots: primary empty → fallback used', () => {
    const merged = mergeWithFallbackSlots([], [{ ...windows[0], technicianId: 'user-chris' }]);
    assert.equal(merged.length, 1);
  });

  it('primary has an equally early slot → primary only, fallback never offered', async () => {
    const result = await lookupOpenSlots(
      { city: 'Ramona' },
      { now: THU_530PM, accessToken: 'test-token', fetchFn: mockUsersAndVisits(ALL) }
    );
    assert.equal(result.openSlots[0].technicianId, 'user-brian');
    assert.equal(result.openSlots.some((s) => s.technicianId !== 'user-brian'), false);
  });

  it('Ramona: Brian booked first two windows, Chris open → Chris offered first, then Brian', async () => {
    const occupied = [visitFor(windows[0], 'user-brian', 'Brian Eads'), visitFor(windows[1], 'user-brian', 'Brian Eads')];
    const result = await lookupOpenSlots(
      { city: 'Ramona' },
      { now: THU_530PM, accessToken: 'test-token', fetchFn: mockUsersAndVisits(ALL, occupied) }
    );
    assert.equal(result.openSlots[0].startAt, windows[0].startAt);
    assert.equal(result.openSlots[0].technicianId, 'user-chris');
    assert.equal(result.openSlots[1].startAt, windows[1].startAt);
    assert.equal(result.openSlots[1].technicianId, 'user-chris');
    assert.equal(result.openSlots[2].technicianId, 'user-brian');
    assert.ok(result.allowlistedTechIds.includes('user-chris'));
    assert.equal(result.openSlots.some((s) => s.technicianId === 'user-travis'), false);
  });

  it('fallback tech with a visit on the board is not offered', async () => {
    const occupied = [
      visitFor(windows[0], 'user-brian', 'Brian Eads'),
      visitFor(windows[0], 'user-chris', 'Chris Glass'),
      visitFor(windows[0], 'user-haze', 'Haze Tarbell'),
      visitFor(windows[0], 'user-sergio', 'Sergio Valdovinos Mendez'),
    ];
    const result = await lookupOpenSlots(
      { city: 'Ramona' },
      { now: THU_530PM, accessToken: 'test-token', fetchFn: mockUsersAndVisits(ALL, occupied) }
    );
    assert.equal(result.openSlots[0].startAt, windows[1].startAt);
  });

  it('Anza and Borrego also use fallback when the primary pool has nothing earlier', async () => {
    for (const city of ['Anza', 'Borrego Springs']) {
      const occupied = ['user-doug|Doug Pollack', 'user-cowin|Cowin', 'user-brian|Brian Eads'].flatMap((x) => {
        const [id, name] = x.split('|');
        return [visitFor(windows[0], id, name)];
      });
      const result = await lookupOpenSlots(
        { city },
        { now: THU_530PM, accessToken: 'test-token', fetchFn: mockUsersAndVisits(ALL, occupied) }
      );
      // Chris is first fallback and open at windows[0]
      assert.equal(result.openSlots[0].startAt, windows[0].startAt, city);
      assert.equal(result.openSlots[0].technicianId, 'user-chris', city);
    }
  });

  it('primary pool completely absent from Jobber still allows fallback', async () => {
    const result = await lookupOpenSlots(
      { city: 'Ramona' },
      { now: THU_530PM, accessToken: 'test-token', fetchFn: mockUsersAndVisits([TRAVIS, HAZE]) }
    );
    assert.equal(result.openSlots[0].technicianId, 'user-haze');
  });

  it('truncated visit list (more pages than we read) → no fallback offered', async () => {
    const fetchFn = async (_u: string | URL | Request, init?: RequestInit) => {
      const q = JSON.parse(String(init?.body || '{}')).query || '';
      if (q.includes('ShopUsers')) return jsonResponse({ data: { users: { nodes: ALL } } });
      return jsonResponse({
        data: {
          visits: {
            pageInfo: { hasNextPage: true, endCursor: 'c' },
            nodes: [visitFor(windows[0], 'user-brian', 'Brian Eads')],
          },
        },
      });
    };
    const result = await lookupOpenSlots({ city: 'Ramona' }, { now: THU_530PM, accessToken: 'test-token', fetchFn });
    assert.equal(result.openSlots.some((s) => s.technicianId !== 'user-brian'), false);
    assert.equal(result.allowlistedTechIds.includes('user-chris'), false);
  });

  it('Murrieta goes to the Anza pool (Doug/Cowin), not Brian by default', async () => {
    const result = await lookupOpenSlots(
      { city: 'Murrieta' },
      { now: THU_530PM, accessToken: 'test-token', fetchFn: mockUsersAndVisits(ALL) }
    );
    assert.ok(['user-doug', 'user-cowin'].includes(result.openSlots[0].technicianId));
    assert.equal(result.openSlots.some((s) => s.technicianId === 'user-brian'), false);
  });

  it('Murrieta: fallback tech working Ramona that day is not sent; one working Temecula is', async () => {
    const day0 = windows[0];
    const late = windows.find((w) => w.startAt.slice(0, 10) === day0.startAt.slice(0, 10) && w !== day0)!;
    const withCity = (slot: { startAt: string; endAt: string }, id: string, name: string, city: string) => ({
      ...visitFor(slot, id, name),
      job: { title: 'Service Call', property: { address: { city } } },
    });
    // Primary pool busy all of day 0 (all-day drill), so fallback is considered.
    const allDay = (id: string, name: string) => ({
      startAt: day0.startAt, endAt: day0.endAt, allDay: true, title: 'Drill new well',
      assignedUsers: { nodes: [{ id, name: { full: name } }] },
    });
    const occupied = [
      allDay('user-doug', 'Doug Pollack'),
      allDay('user-cowin', 'Cowin'),
      withCity(late, 'user-chris', 'Chris Glass', 'Ramona'),
      withCity(late, 'user-haze', 'Haze Tarbell', 'Ramona'),
      withCity(late, 'user-sergio', 'Sergio Valdovinos Mendez', 'Temecula'),
    ];
    const result = await lookupOpenSlots(
      { city: 'Murrieta' },
      { now: THU_530PM, accessToken: 'test-token', fetchFn: mockUsersAndVisits(ALL, occupied) }
    );
    const sameDay = result.openSlots.filter((s) => s.startAt.slice(0, 10) === day0.startAt.slice(0, 10));
    assert.ok(sameDay.length > 0);
    for (const s of sameDay) assert.equal(s.technicianId, 'user-sergio');
  });

  it('home-zone env keeps an idle fallback tech in their own territory', async () => {
    const occupied = [visitFor(windows[0], 'user-brian', 'Brian Eads')];
    const result = await lookupOpenSlots(
      { city: 'Ramona' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        env: { RECEPTIONIST_FALLBACK_HOME_ZONES: 'chris:riverside' },
        fetchFn: mockUsersAndVisits(ALL, occupied),
      }
    );
    assert.equal(result.openSlots[0].startAt, windows[0].startAt);
    assert.equal(result.openSlots[0].technicianId, 'user-haze');
  });

  it('Travis only in Jobber → still no slots', async () => {
    const result = await lookupOpenSlots(
      { city: 'Ramona' },
      { now: THU_530PM, accessToken: 'test-token', fetchFn: mockUsersAndVisits([TRAVIS]) }
    );
    assert.deepEqual(result.openSlots, []);
  });
});

describe('board-aware availability', () => {
  // Monday Oct 12 2026 6:00 AM PT; Tue Oct 13 is the day under test.
  const NOW = new Date('2026-10-12T13:00:00.000Z');
  const pt = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h + 7, m)).toISOString();
  const brian = { technicianIds: ['user-brian'], technicianNames: ['Brian Eads'] };
  const run = (occupied: any[], extra: Record<string, unknown> = {}) =>
    computeOpenSlots({
      occupied,
      now: NOW,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 40,
      siteCity: 'Ramona',
      ...extra,
    }).filter((s) => s.date.includes('October 13'));

  it('one short timed service call leaves the other windows open', () => {
    const slots = run([
      { startAt: pt(13, 8), endAt: pt(13, 9, 30), city: 'Ramona', title: 'Service Call', ...brian },
    ]);
    const times = slots.map((s) => s.time);
    assert.equal(slots.some((s) => s.startAt === pt(13, 8)), false);
    assert.ok(times.some((t) => /10:00 AM and 12:00 PM/.test(t)));
    assert.ok(times.some((t) => /1:00 PM and 3:00 PM/.test(t)));
    assert.ok(times.some((t) => /4:00 PM and 6:00 PM/.test(t)));
  });

  it('one anytime (all-day) service call does not close the day', () => {
    const slots = run([
      { startAt: pt(13, 0), endAt: pt(13, 23, 59), allDay: true, title: 'Service Call', ...brian },
    ]);
    assert.deepEqual(slots.map((s) => s.startAt), SLOT_HOURS_PT.map((hour) => pt(13, hour)));
  });

  it('all-day drilling / install job closes the whole day', () => {
    assert.equal(
      run([{ startAt: pt(13, 7), endAt: pt(13, 17), allDay: true, title: 'New well drilling', ...brian }]).length,
      0
    );
  });

  it('an unidentified all-day visit counts as a double stop but leaves windows open; two of them hit the cap', () => {
    const misc = { startAt: pt(13, 0), endAt: pt(13, 23, 59), allDay: true, title: 'Clean Up Plumbing & Electric', ...brian };
    assert.deepEqual(run([misc]).map((s) => s.startAt), SLOT_HOURS_PT.map((hour) => pt(13, hour)));
    assert.equal(run([misc, { ...misc, title: 'Other cleanup' }]).length, 0);
  });

  it('all-day pump pull / fishing / booster job closes the day', () => {
    for (const title of ['Fish out pump', 'Pull & Replace Pump & Motor', 'Booster Upgrade', 'City Water Tie-in']) {
      assert.equal(run([{ startAt: pt(13, 0), endAt: pt(13, 23, 59), allDay: true, title, ...brian }]).length, 0, title);
    }
  });

  it('a long timed job spanning windows blocks only what it overlaps (plus travel)', () => {
    const slots = run([{ startAt: pt(13, 9), endAt: pt(13, 14), title: 'Pump install', city: 'Ramona', ...brian }]);
    // 8 AM can't finish before 9; 10 AM and 1 PM overlap the 9 AM–2 PM job; 4 PM is clear.
    assert.deepEqual(slots.map((s) => s.startAt), [pt(13, 16)]);
    const morningOnly = run([{ startAt: pt(13, 7), endAt: pt(13, 11), title: 'Pump install', city: 'Ramona', ...brian }]);
    assert.deepEqual(morningOnly.map((s) => s.startAt), [pt(13, 13), pt(13, 16)]);
  });

  it('travel time: a far-away visit ending at 10 pushes out the next window; a same-city one does not', () => {
    const far = run([{ startAt: pt(13, 8), endAt: pt(13, 10), city: 'Anza', ...brian }]);
    assert.equal(far.some((s) => s.startAt === pt(13, 10)), false);
    const near = run([{ startAt: pt(13, 8), endAt: pt(13, 10), city: 'Ramona', ...brian }]);
    assert.equal(near.some((s) => s.startAt === pt(13, 10)), true);
  });

  it('stop cap: 4 stops closes the day, 3 does not', () => {
    const stop = (h: number) => ({ startAt: pt(13, h), endAt: pt(13, h + 1), city: 'Ramona', ...brian });
    assert.equal(run([stop(8), stop(15), stop(16), stop(17)]).length, 0);
    assert.ok(run([stop(8), stop(15), stop(16)], { maxStops: 4 }).length >= 1);
    assert.equal(run([stop(8), stop(15), stop(16)], { maxStops: 3 }).length, 0);
  });

  it("another tech's visits never block Brian", () => {
    assert.deepEqual(
      run([{ startAt: pt(13, 8), endAt: pt(13, 17), allDay: true, title: 'Drilling', technicianIds: ['x'], technicianNames: ['Someone'] }])
        .map((s) => s.startAt),
      SLOT_HOURS_PT.map((hour) => pt(13, hour))
    );
  });
});

describe('same-day 4 PM window', () => {
  // Tue Oct 13 2026 2:15 PM PT (PDT). The 8 AM, 10 AM, and 1 PM starts have passed.
  const TUE_215PM = new Date('2026-10-13T21:15:00.000Z');

  it('a 2:15 PM PT call on a free weekday still offers 4–6 PM today and keeps 8/10/1 the next day', () => {
    const slots = computeOpenSlots({
      occupied: [],
      now: TUE_215PM,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 8,
    });
    const today = slots.filter((slot) => slot.date.includes('October 13'));
    assert.deepEqual(today.map((slot) => slot.startAt), ['2026-10-13T23:00:00.000Z']);
    assert.equal(today[0].endAt, '2026-10-14T01:00:00.000Z');
    assert.match(today[0].time, /4:00 PM and 6:00 PM/);
    assert.equal(today[0].technician, 'Brian Eads');
    const wednesday = slots.filter((slot) => slot.date.includes('October 14'));
    assert.deepEqual(wednesday.map((slot) => slot.startAt), [
      '2026-10-14T15:00:00.000Z',
      '2026-10-14T17:00:00.000Z',
      '2026-10-14T20:00:00.000Z',
      '2026-10-14T23:00:00.000Z',
    ]);
    assert.match(wednesday[0].time, /8:00 AM and 10:00 AM/);
    assert.match(wednesday[1].time, /10:00 AM and 12:00 PM/);
    assert.match(wednesday[2].time, /1:00 PM and 3:00 PM/);
    assert.match(wednesday[3].time, /4:00 PM and 6:00 PM/);
  });

  it('does not offer 4 PM when that window is already taken', () => {
    const slots = computeOpenSlots({
      occupied: [{
        startAt: '2026-10-13T23:00:00.000Z',
        endAt: '2026-10-14T01:00:00.000Z',
        title: 'Service Call',
        technicianIds: ['user-brian'],
        technicianNames: ['Brian Eads'],
      }],
      now: TUE_215PM,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 4,
    });
    assert.equal(slots.some((slot) => slot.date.includes('October 13')), false);
    assert.match(slots[0].date, /Wednesday/i);
    assert.match(slots[0].time, /8:00 AM and 10:00 AM/);
  });
});

describe('Jeremiah Biliunas weekday and weekend pool', () => {
  const JEREMIAH = {
    id: 'Z2lkOi8vSm9iYmVyL1VzZXIvNDQzODgyOQ==',
    name: { full: 'Jeremiah Biliunas' },
    email: { raw: 'jeremiah@scwellservice.com' },
  };
  const FRI_6PM = new Date('2026-09-05T01:00:00.000Z'); // Fri Sep 4, 6 PM PT
  const SUN_6PM = new Date('2026-09-07T01:00:00.000Z'); // Sun Sep 6, 6 PM PT
  const THU_6PM = new Date('2026-09-11T01:00:00.000Z'); // Thu Sep 10, 6 PM PT
  const weekendEnv = envOf({ RECEPTIONIST_WEEKEND_TECHS: 'Jeremiah Biliunas' });
  const noWeekendEnv = envOf({ RECEPTIONIST_WEEKEND_TECHS: '' });
  const pool = [BRIAN, COWIN, DOUG, TRAVIS, JEREMIAH];

  function bookedWeekdays(now: Date, id: string, name: string) {
    return computeOpenSlots({
      occupied: [],
      now,
      technicianId: id,
      technicianName: name,
      maxSlots: 60,
      allowWeekend: false,
      env: noWeekendEnv,
    }).map((slot) => visitFor(slot, id, name));
  }

  function lookup(city: string, now: Date, env: NodeJS.ProcessEnv, occupied: unknown[] = [], users = pool) {
    return lookupOpenSlots(
      { city },
      { now, accessToken: 'test-token', env, fetchFn: mockUsersAndVisits(users, occupied) }
    );
  }

  it('extraSlotDayAllowed is Wed–Fri always and Sat/Sun only on the weekend roster', () => {
    const tech = { name: 'Jeremiah Biliunas', weekdayPool: [3, 4, 5] as const };
    assert.equal(extraSlotDayAllowed('2026-09-07T15:00:00.000Z', tech, weekendEnv), false); // Monday
    assert.equal(extraSlotDayAllowed('2026-09-08T15:00:00.000Z', tech, weekendEnv), false); // Tuesday
    assert.equal(extraSlotDayAllowed('2026-09-09T15:00:00.000Z', tech, noWeekendEnv), true); // Wednesday
    assert.equal(extraSlotDayAllowed('2026-09-10T15:00:00.000Z', tech, noWeekendEnv), true); // Thursday
    assert.equal(extraSlotDayAllowed('2026-09-11T15:00:00.000Z', tech, noWeekendEnv), true); // Friday
    assert.equal(extraSlotDayAllowed('2026-09-05T15:00:00.000Z', tech, weekendEnv), true); // Saturday
    assert.equal(extraSlotDayAllowed('2026-09-06T15:00:00.000Z', tech, weekendEnv), true); // Sunday
    assert.equal(extraSlotDayAllowed('2026-09-05T15:00:00.000Z', tech, noWeekendEnv), false);
    assert.equal(extraSlotDayAllowed('2026-09-06T15:00:00.000Z', tech, noWeekendEnv), false);
    assert.equal(extraSlotDayAllowed('', tech, weekendEnv), false);
  });

  it('Sat/Sun slots are Jeremiah in every territory when he is the weekend roster', async () => {
    for (const city of ['Ramona', 'Anza', 'Borrego Springs', 'Murrieta']) {
      const result = await lookup(city, FRI_6PM, weekendEnv);
      assert.ok(result.openSlots.length > 0, city);
      assert.ok(result.openSlots.every((slot) => /saturday|sunday/i.test(slot.date)), city);
      assert.ok(result.openSlots.every((slot) => slot.technician === 'Jeremiah Biliunas' && slot.technicianId === JEREMIAH.id), city);
      assert.ok(result.allowlistedTechIds.includes(JEREMIAH.id), city);
      assert.equal(result.openSlots.some((slot) => /doug|pollack|travis/i.test(slot.technician)), false, city);
      assert.equal(
        result.openSlots.some((slot) => /brian|cowin/i.test(slot.technician)),
        false,
        city
      );
    }
    const ramona = await lookup('Ramona', FRI_6PM, weekendEnv);
    assert.equal(ramona.assignedTechName, 'Brian Eads');
    assert.equal(ramona.assignedTechId, 'user-brian');
    const anza = await lookup('Anza', FRI_6PM, weekendEnv);
    assert.equal(anza.assignedTechName, 'Cowin');
    const desert = await lookup('Borrego Springs', FRI_6PM, weekendEnv);
    assert.equal(desert.assignedTechName, 'Cowin or Brian Eads');
  });

  it('Brian without the weekend roster stays weekday-only when Jeremiah cannot cover Sat/Sun', async () => {
    const occupied = [
      {
        startAt: '2026-09-05T15:00:00.000Z',
        endAt: '2026-09-05T15:00:00.000Z',
        allDay: true,
        title: 'Drill new well',
        assignedUsers: { nodes: [{ id: JEREMIAH.id, name: { full: 'Jeremiah Biliunas' } }] },
      },
      {
        startAt: '2026-09-06T15:00:00.000Z',
        endAt: '2026-09-06T15:00:00.000Z',
        allDay: true,
        title: 'Drill new well',
        assignedUsers: { nodes: [{ id: JEREMIAH.id, name: { full: 'Jeremiah Biliunas' } }] },
      },
    ];
    const result = await lookup('Ramona', FRI_6PM, weekendEnv, occupied);
    assert.match(result.openSlots[0].date, /Monday/i);
    assert.ok(result.openSlots.every((slot) => slot.technicianId === 'user-brian'));
    assert.equal(result.openSlots.some((slot) => /saturday|sunday/i.test(slot.date)), false);
  });

  it('Wed–Fri slots assign Jeremiah when the territory primary is booked, with or without the weekend env', async () => {
    const occupied = [
      ...bookedWeekdays(THU_6PM, 'user-brian', 'Brian Eads'),
      ...bookedWeekdays(THU_6PM, 'user-cowin', 'Cowin'),
    ];
    for (const city of ['Ramona', 'Anza', 'Borrego Springs']) {
      const withWeekend = await lookup(city, THU_6PM, weekendEnv, occupied);
      assert.ok(withWeekend.openSlots.some((slot) => /friday/i.test(slot.date) && slot.technicianId === JEREMIAH.id), city);
      assert.ok(withWeekend.openSlots.some((slot) => /saturday/i.test(slot.date) && slot.technicianId === JEREMIAH.id), city);
      assert.equal(withWeekend.openSlots.some((slot) => /monday|tuesday/i.test(slot.date)), false, city);
      assert.equal(withWeekend.openSlots.some((slot) => slot.technicianId === 'user-brian' || slot.technicianId === 'user-cowin'), false, city);

      const weekdaysOnly = await lookup(city, THU_6PM, noWeekendEnv, occupied);
      assert.ok(weekdaysOnly.openSlots.length > 0, city);
      assert.ok(weekdaysOnly.openSlots.every((slot) => slot.technicianId === JEREMIAH.id), city);
      assert.ok(weekdaysOnly.openSlots.some((slot) => /friday/i.test(slot.date)), city);
      assert.equal(weekdaysOnly.openSlots.some((slot) => /saturday|sunday|monday|tuesday/i.test(slot.date)), false, city);
    }
  });

  it('Mon/Tue stay with the territory primary even when Jeremiah is free', async () => {
    for (const [city, techId] of [
      ['Ramona', 'user-brian'],
      ['Anza', 'user-cowin'],
      ['Murrieta', 'user-cowin'],
    ] as const) {
      const result = await lookup(city, SUN_6PM, weekendEnv);
      assert.ok(result.openSlots.length > 0, city);
      assert.ok(result.openSlots.every((slot) => /monday|tuesday/i.test(slot.date)), city);
      assert.ok(result.openSlots.every((slot) => slot.technicianId === techId), city);
    }
    const desert = await lookup('Borrego Springs', SUN_6PM, weekendEnv);
    assert.ok(desert.openSlots.every((slot) => /monday|tuesday/i.test(slot.date)));
    assert.equal(desert.openSlots.some((slot) => slot.technicianId === JEREMIAH.id), false);
  });

  it('Mon/Tue are not offered to Jeremiah when he is the only tech with a free board', async () => {
    const occupied = [
      ...bookedWeekdays(SUN_6PM, 'user-brian', 'Brian Eads'),
      ...bookedWeekdays(SUN_6PM, 'user-cowin', 'Cowin'),
    ];
    const result = await lookup('Borrego Springs', SUN_6PM, weekendEnv, occupied);
    assert.match(result.openSlots[0].date, /Wednesday/i);
    assert.equal(result.openSlots[0].technician, 'Jeremiah Biliunas');
    assert.equal(result.openSlots.some((slot) => /monday|tuesday/i.test(slot.date)), false);
    assert.ok(result.allowlistedTechIds.includes(JEREMIAH.id));
  });

  it('a wrong Jobber id pin drops Jeremiah and does not open Brian weekends', async () => {
    const bad = envOf({
      RECEPTIONIST_WEEKEND_TECHS: 'Jeremiah Biliunas',
      JOBBER_TECH_JEREMIAH_BILIUNAS_ID: TRAVIS.id,
    });
    const result = await lookup('Ramona', FRI_6PM, bad);
    assert.equal(result.allowlistedTechIds.includes(JEREMIAH.id), false);
    assert.equal(result.openSlots.some((slot) => slot.technicianId === JEREMIAH.id), false);
    assert.match(result.openSlots[0].date, /Monday/i);
    assert.equal(result.openSlots[0].technicianId, 'user-brian');
    assert.equal(result.openSlots.some((slot) => /saturday|sunday/i.test(slot.date)), false);

    const pinned = envOf({
      RECEPTIONIST_WEEKEND_TECHS: 'Jeremiah Biliunas',
      JOBBER_TECH_JEREMIAH_BILIUNAS_ID: JEREMIAH.id,
    });
    const ok = await lookup('Ramona', FRI_6PM, pinned);
    assert.equal(ok.openSlots[0].technicianId, JEREMIAH.id);
    assert.match(ok.openSlots[0].date, /Saturday/i);
  });

  it('a booked primary Friday goes to Jeremiah ahead of a fallback tech', async () => {
    const friday = computeOpenSlots({
      occupied: [],
      now: THU_530PM,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 1,
      env: noWeekendEnv,
    })[0];
    const result = await lookup(
      'Ramona',
      THU_530PM,
      noWeekendEnv,
      [visitFor(friday, 'user-brian', 'Brian Eads')],
      [...pool, CHRIS, HAZE, SERGIO]
    );
    const atFriday = result.openSlots.find((slot) => slot.startAt === friday.startAt);
    assert.equal(atFriday?.technicianId, JEREMIAH.id);
    assert.equal(atFriday?.technician, 'Jeremiah Biliunas');
  });

  it('Sunday 2:15 PM PT in Coachella offers Jeremiah at 4 PM and keeps Monday 8/10/1 on Cowin', async () => {
    // Sun Oct 25 2026 2:15 PM PT. Martin called; the 8/10/1 starts had already passed.
    const sun215 = new Date('2026-10-25T21:15:00.000Z');
    const users = [BRIAN, COWIN, DOUG, TRAVIS, JEREMIAH, CHRIS];
    const result = await lookup('Coachella', sun215, weekendEnv, [], users);
    assert.equal(result.lookupStatus, 'ok');
    assert.equal(result.assignedTechName, 'Cowin');
    const first = result.openSlots[0];
    assert.equal(first.startAt, '2026-10-25T23:00:00.000Z');
    assert.equal(first.endAt, '2026-10-26T01:00:00.000Z');
    assert.match(first.date, /Sunday/i);
    assert.match(first.time, /4:00 PM and 6:00 PM/);
    assert.equal(first.technician, 'Jeremiah Biliunas');
    assert.equal(first.technicianId, JEREMIAH.id);
    assert.equal(result.openSlots.filter((slot) => /sunday/i.test(slot.date)).length, 1);
    const monday = result.openSlots.filter((slot) => /monday/i.test(slot.date));
    const mondayTimes = monday.map((slot) => slot.time);
    assert.ok(mondayTimes.some((time) => /8:00 AM and 10:00 AM/.test(time)));
    assert.ok(mondayTimes.some((time) => /10:00 AM and 12:00 PM/.test(time)));
    assert.ok(mondayTimes.some((time) => /1:00 PM and 3:00 PM/.test(time)));
    assert.ok(monday.every((slot) => slot.technicianId === 'user-cowin'));
    assert.equal(result.openSlots.some((slot) => slot.technicianId === 'user-chris'), false);
  });

  it('a taken Sunday 4 PM window is not offered, and the day stays closed without a weekend roster', async () => {
    const sun215 = new Date('2026-10-25T21:15:00.000Z');
    const users = [BRIAN, COWIN, JEREMIAH, CHRIS];
    const occupied = [{
      startAt: '2026-10-25T23:00:00.000Z',
      endAt: '2026-10-26T01:00:00.000Z',
      title: 'Service Call',
      assignedUsers: { nodes: [{ id: JEREMIAH.id, name: { full: 'Jeremiah Biliunas' } }] },
    }];
    const taken = await lookup('Coachella', sun215, weekendEnv, occupied, users);
    assert.equal(taken.openSlots.some((slot) => /sunday/i.test(slot.date)), false);
    assert.match(taken.openSlots[0].date, /Monday/i);
    assert.match(taken.openSlots[0].time, /8:00 AM and 10:00 AM/);
    assert.equal(taken.openSlots[0].technicianId, 'user-cowin');

    const noWeekend = await lookup('Coachella', sun215, noWeekendEnv, [], users);
    assert.equal(noWeekend.openSlots.some((slot) => /sunday/i.test(slot.date)), false);
    assert.match(noWeekend.openSlots[0].date, /Monday/i);
    assert.match(noWeekend.openSlots[0].time, /8:00 AM and 10:00 AM/);
    assert.equal(noWeekend.openSlots[0].technicianId, 'user-cowin');
  });
});

describe('tech days off (RECEPTIONIST_TECH_DAYS_OFF)', () => {
  const env = { RECEPTIONIST_TECH_DAYS_OFF: 'Chris Glass:2026-10-30..2026-11-01; Haze Tarbell:2026-10-30' } as unknown as NodeJS.ProcessEnv;
  it('parses ranges and single days', async () => {
    const { techIsOffOn } = await import('./open-slots.ts');
    assert.equal(techIsOffOn('Chris Glass', '2026-10-31', env), true);
    assert.equal(techIsOffOn('Chris Glass', '2026-11-02', env), false);
    assert.equal(techIsOffOn('Haze Tarbell', '2026-10-30', env), true);
    assert.equal(techIsOffOn('Cowin', '2026-10-30', env), false);
  });
  it('isVisitDayAllowed rejects a day off (Fri 10/30 4 PM PT)', async () => {
    const { isVisitDayAllowed } = await import('./open-slots.ts');
    assert.equal(isVisitDayAllowed('2026-10-30T23:00:00Z', 'Chris Glass', env), false);
    assert.equal(isVisitDayAllowed('2026-10-30T23:00:00Z', 'Colton Hagler', env), true);
  });
  it('computeOpenSlots skips days off and time-off visits', async () => {
    const { computeOpenSlots } = await import('./open-slots.ts');
    const now = new Date('2026-10-30T15:00:00Z');
    const off = computeOpenSlots({ occupied: [], now, technicianId: 'c', technicianName: 'Chris Glass', env, allowWeekend: false, maxSlots: 1 });
    assert.ok(off[0] && !off[0].startAt.startsWith('2026-10-30'));
    const pto = computeOpenSlots({
      occupied: [{ id: 'v', startAt: '2026-10-30T07:00:00Z', endAt: '2026-10-31T06:59:59Z', allDay: true, title: 'PTO - Glamis', technicianIds: ['k'], technicianNames: ['Colton Hagler'] } as any],
      now, technicianId: 'k', technicianName: 'Colton Hagler', env: {} as unknown as NodeJS.ProcessEnv, allowWeekend: false, maxSlots: 1,
    });
    assert.ok(pto[0] && !pto[0].startAt.startsWith('2026-10-30'));
  });
});

describe('time-off visits (QA #261)', () => {
  const now = new Date('2026-10-30T15:00:00Z'); // Fri 8 AM PT
  const base = { technicianId: 'k', technicianName: 'Colton Hagler', env: {} as unknown as NodeJS.ProcessEnv, allowWeekend: false, maxSlots: 4, now };
  it('a timed "Holiday Ranch" visit keeps the rest of the day open', async () => {
    const { computeOpenSlots, isTimeOffVisit } = await import('./open-slots.ts');
    const visit = { id: 'h', startAt: '2026-10-30T16:00:00Z', endAt: '2026-10-30T18:00:00Z', allDay: false, title: 'Holiday Ranch well service', technicianIds: ['k'], technicianNames: ['Colton Hagler'] } as any;
    assert.equal(isTimeOffVisit(visit), false);
    assert.equal(isTimeOffVisit({ ...visit, title: 'Pump unavailable - order part' }), false);
    assert.equal(isTimeOffVisit({ ...visit, title: 'Sick smell water' }), false);
    const slots = computeOpenSlots({ ...base, occupied: [visit] });
    assert.ok(slots.some((slot) => slot.startAt.startsWith('2026-10-30')));
  });
  it('an all-day PTO visit closes the day', async () => {
    const { computeOpenSlots } = await import('./open-slots.ts');
    const visit = { id: 'p', startAt: '2026-10-30T07:00:00Z', endAt: '2026-10-31T06:59:59Z', allDay: true, title: 'PTO', technicianIds: ['k'], technicianNames: ['Colton Hagler'] } as any;
    const slots = computeOpenSlots({ ...base, occupied: [visit] });
    assert.ok(slots.length > 0 && slots.every((slot) => !slot.startAt.startsWith('2026-10-30')));
  });
  it('a reversed days-off range is ignored, not collapsed to its start', async () => {
    const { techDaysOff } = await import('./open-slots.ts');
    const days = techDaysOff({ RECEPTIONIST_TECH_DAYS_OFF: 'Chris Glass:2026-11-02..2026-10-30' } as unknown as NodeJS.ProcessEnv);
    assert.equal(days.get('chris glass')?.size ?? 0, 0);
  });
});
