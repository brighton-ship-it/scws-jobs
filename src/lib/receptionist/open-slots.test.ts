import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeOpenSlots, slotMatchesRequest, visitsOverlapSlot } from './open-slots.ts';

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
