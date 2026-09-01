import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOpenSlots,
  lookupOpenSlots,
  mergeOpenSlots,
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
