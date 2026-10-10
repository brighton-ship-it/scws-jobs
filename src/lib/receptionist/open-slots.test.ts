import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOpenSlots,
  isWeekdayVisitStart,
  lookupOpenSlots,
  mergeOpenSlots,
  mergeWithFallbackSlots,
  ptWeekday,
  slotMatchesRequest,
  visitsOverlapSlot,
} from './open-slots.ts';

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

  it('never returns Saturday or Sunday visit windows', () => {
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

  it('Friday night after-hours offers Monday, not Saturday or Sunday', () => {
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

  it('Anza: Doug open and Cowin booked → Doug only, never Travis', async () => {
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
    assert.deepEqual(result.allowlistedTechIds, ['user-doug', 'user-cowin']);
    assert.ok(result.openSlots.length > 0);
    assert.equal(result.openSlots[0].technicianId, 'user-doug');
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

  it('Anza: both open → Doug first, Cowin still allowlisted, no Travis', async () => {
    const result = await lookupOpenSlots(
      { city: 'Anza' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockUsersAndVisits([DOUG, COWIN, TRAVIS, BRIAN]),
      }
    );

    assert.ok(result.openSlots.length > 0);
    assert.equal(result.openSlots[0].technicianId, 'user-doug');
    assert.deepEqual(result.allowlistedTechIds, ['user-doug', 'user-cowin']);
    assert.equal(result.assignedTechName, 'Doug Pollack or Cowin');
    assert.equal(
      result.openSlots.some((slot) => slot.technicianId === 'user-travis' || slot.technicianId === 'user-brian'),
      false
    );
  });

  it('Anza: neither allowed tech has a slot → no bookable times', async () => {
    const windows = computeOpenSlots({
      occupied: [],
      now: THU_530PM,
      technicianId: 'user-doug',
      technicianName: 'Doug Pollack',
      maxSlots: 50,
    });
    const occupied = windows.flatMap((slot) => [
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
    ]);
    const result = await lookupOpenSlots(
      { city: 'Anza' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockUsersAndVisits([DOUG, COWIN, TRAVIS], occupied),
      }
    );

    assert.deepEqual(result.openSlots, []);
    assert.deepEqual(result.allowlistedTechIds, ['user-doug', 'user-cowin']);
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

  it('Borrego Springs: Brian booked Mon–Wed, Anza tech open → earliest slot is the Anza tech, not Thursday', async () => {
    // THU_530PM → first candidate is Fri Sep 4 8 AM. Block Brian for the next 4 weekdays.
    const brianWindows = computeOpenSlots({
      occupied: [],
      now: THU_530PM,
      technicianId: 'user-brian',
      technicianName: 'Brian Eads',
      maxSlots: 6,
    });
    const occupied = brianWindows.map((slot) => ({
      startAt: slot.startAt,
      endAt: slot.endAt,
      assignedUsers: { nodes: [{ id: 'user-brian', name: { full: 'Brian Eads' } }] },
    }));
    const result = await lookupOpenSlots(
      { city: 'Borrego Springs' },
      {
        now: THU_530PM,
        accessToken: 'test-token',
        fetchFn: mockUsersAndVisits([DOUG, COWIN, TRAVIS, BRIAN], occupied),
      }
    );

    assert.ok(result.openSlots.length > 0);
    assert.equal(result.openSlots[0].startAt, brianWindows[0].startAt);
    assert.equal(result.openSlots[0].technicianId, 'user-doug');
    assert.deepEqual(result.allowlistedTechIds, ['user-doug', 'user-cowin', 'user-brian']);
    assert.equal(result.openSlots.some((slot) => slot.technicianId === 'user-travis'), false);
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

  it('Borrego Springs: all three open → Doug wins the tie', async () => {
    const result = await lookupOpenSlots(
      { city: 'Borrego Springs' },
      { now: THU_530PM, accessToken: 'test-token', fetchFn: mockUsersAndVisits([DOUG, COWIN, TRAVIS, BRIAN]) }
    );
    assert.equal(result.openSlots[0].technicianId, 'user-doug');
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
  });

  it('one anytime (all-day) service call does not close the day', () => {
    const slots = run([
      { startAt: pt(13, 0), endAt: pt(13, 23, 59), allDay: true, title: 'Service Call', ...brian },
    ]);
    assert.equal(slots.length, 3);
  });

  it('all-day drilling / install job closes the whole day', () => {
    assert.equal(
      run([{ startAt: pt(13, 7), endAt: pt(13, 17), allDay: true, title: 'New well drilling', ...brian }]).length,
      0
    );
  });

  it('an unidentified all-day visit counts as a double stop but leaves windows open; two of them hit the cap', () => {
    const misc = { startAt: pt(13, 0), endAt: pt(13, 23, 59), allDay: true, title: 'Clean Up Plumbing & Electric', ...brian };
    assert.equal(run([misc]).length, 3);
    assert.equal(run([misc, { ...misc, title: 'Other cleanup' }]).length, 0);
  });

  it('all-day pump pull / fishing / booster job closes the day', () => {
    for (const title of ['Fish out pump', 'Pull & Replace Pump & Motor', 'Booster Upgrade', 'City Water Tie-in']) {
      assert.equal(run([{ startAt: pt(13, 0), endAt: pt(13, 23, 59), allDay: true, title, ...brian }]).length, 0, title);
    }
  });

  it('a long timed job spanning windows blocks only what it overlaps (plus travel)', () => {
    const slots = run([{ startAt: pt(13, 9), endAt: pt(13, 14), title: 'Pump install', city: 'Ramona', ...brian }]);
    assert.equal(slots.length, 0); // 8 slot can't finish before 9, 10/13 overlap
    const morningOnly = run([{ startAt: pt(13, 7), endAt: pt(13, 11), title: 'Pump install', city: 'Ramona', ...brian }]);
    assert.deepEqual(morningOnly.map((s) => s.startAt), [pt(13, 13)]);
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
    assert.equal(
      run([{ startAt: pt(13, 8), endAt: pt(13, 17), allDay: true, title: 'Drilling', technicianIds: ['x'], technicianNames: ['Someone'] }])
        .length,
      3
    );
  });
});
