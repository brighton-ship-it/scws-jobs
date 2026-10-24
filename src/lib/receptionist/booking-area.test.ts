import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CITY_TO_COUNTY } from '../tax-rates.ts';
import {
  DRIVE_SURCHARGE_LINE_NAME,
  driveSurchargeFromHours,
  nearerShopDrive,
  placeDrivePoint,
} from './drive-surcharge.ts';
import { checkServiceArea, decideBookingArea } from './service-area.ts';
import { townGuardResult } from './town-guard.ts';

const BOOKABLE = ['San Diego', 'Riverside', 'San Bernardino'];

describe('county bookable rule', () => {
  const santaYsabelStyle = [
    'Santa Ysabel',
    'Quail Springs',
    'Mesa Grande',
    'Mesa Grande Rd',
    '4930 Mesa Grande Rd',
    '4930 Mesa Grande Rd, Quail Springs',
    '4930 Mesa Grande Rd, Quail Springs, Santa Ysabel',
    '4930 Mesa Grande Rd, Santa Ysabel, CA 92070',
  ];

  for (const location of santaYsabelStyle) {
    it(`${location} is bookable San Diego County`, () => {
      const { result } = checkServiceArea(location);
      assert.equal(result.inServiceArea, true, result.message);
      assert.equal(result.bookable, true);
      assert.equal(result.outOfArea, false);
      assert.equal(result.referralOnly, false);
      assert.equal(result.handoff, false);
      assert.equal(result.county, 'San Diego');
      assert.doesNotMatch(result.message, /outside|out of area|can't help|referr/i);
      assert.match(result.bookingRule, /do not hand off/i);
    });
  }

  it('lets checkSchedule and bookJob run for Quail Springs and Mesa Grande', () => {
    assert.equal(townGuardResult('checkSchedule', { city: 'Quail Springs' }, {}), null);
    assert.equal(townGuardResult('bookJob', { city: 'Mesa Grande' }, {}), null);
    assert.equal(townGuardResult('book_job', { city: '4930 Mesa Grande Rd, Quail Springs' }, {}), null);
    assert.equal(townGuardResult('checkServiceArea', { address: '4930 Mesa Grande Rd', city: 'Santa Ysabel' }, {}), null);
  });

  it('never marks an address in the three counties out of area', () => {
    for (const [city, county] of Object.entries(CITY_TO_COUNTY)) {
      if (!BOOKABLE.includes(county)) continue;
      const samples = [
        city,
        `${city}, CA`,
        `100 Main St, ${city}, CA`,
        `${county} County`,
      ];
      for (const location of samples) {
        const { result } = checkServiceArea(location);
        assert.equal(result.outOfArea, false, location);
        assert.equal(result.inServiceArea, true, `${location}: ${result.message}`);
        assert.equal(result.bookable, true, location);
        assert.equal(result.referralOnly, false, location);
        assert.equal(result.handoff, false, location);
        assert.doesNotMatch(result.message, /outside|out of area|can't help|referr/i);
      }
    }

    for (const location of ['92070', '92539', '92311', '92262', '92259']) {
      const { result } = checkServiceArea(location);
      assert.equal(result.bookable, true, location);
      assert.equal(result.outOfArea, false, location);
      assert.equal(result.inServiceArea, true, location);
    }
  });

  it('still asks the office to confirm a place outside those counties', () => {
    const { result } = checkServiceArea('Phoenix');
    assert.equal(result.inServiceArea, null);
    assert.equal(result.bookable, false);
    assert.equal(result.message, 'The office will confirm.');
    assert.doesNotMatch(result.message, /outside|out of area|can't help/i);

    const orange = checkServiceArea('Orange County').result;
    assert.equal(orange.bookable, false);
    assert.equal(orange.outOfArea, true);
    assert.equal(orange.inServiceArea, null);

    for (const outside of ['Imperial County', '92243', 'Los Angeles County']) {
      const result = checkServiceArea(outside).result;
      assert.equal(result.bookable, false, outside);
      assert.equal(result.inServiceArea, null, outside);
    }
  });
});

describe('drive surcharge from the nearer shop', () => {
  it('charges $100 per hour past 1 hour and nothing at or under 1 hour', () => {
    assert.equal(driveSurchargeFromHours(0.25).amountUsd, 0);
    assert.equal(driveSurchargeFromHours(1).amountUsd, 0);
    assert.equal(driveSurchargeFromHours(1.5).amountUsd, 50);
    assert.equal(driveSurchargeFromHours(1.5).excessHours, 0.5);
    assert.equal(driveSurchargeFromHours(2).amountUsd, 100);
  });

  it('Santa Ysabel / Quail Springs / Mesa Grande are inside 1 hour, so no surcharge', () => {
    for (const place of ['Santa Ysabel', 'Quail Springs', 'Mesa Grande', '4930 Mesa Grande Rd, Quail Springs']) {
      const result = decideBookingArea(place);
      assert.equal(result.bookable, true, place);
      assert.equal(result.outOfArea, false, place);
      assert.ok(result.driveHours != null && result.driveHours <= 1, `${place} drive ${result.driveHours}`);
      assert.equal(result.driveSurchargeUsd, 0, place);
      assert.equal(result.driveLine, null, place);
      assert.doesNotMatch(result.message, /\$100 per hour/);
    }
  });

  it('a drive beyond 1 hour from both shops still books and prices the nearer shop', () => {
    const point = placeDrivePoint('Barstow');
    assert.ok(point);
    const drive = nearerShopDrive(point);
    assert.ok(drive.ramonaHours > 1);
    assert.ok(drive.anzaHours > 1);
    assert.equal(drive.driveHours, Math.min(drive.ramonaHours, drive.anzaHours));
    assert.ok(drive.amountUsd > 0);
    assert.equal(drive.amountUsd, Math.round(drive.excessHours * 100));

    const byName = decideBookingArea('Barstow');
    assert.equal(byName.county, 'San Bernardino');
    assert.equal(byName.outOfArea, false);
    assert.ok(byName.driveSurchargeUsd > 0);

    const result = decideBookingArea({ city: 'Barstow', address: '200 E Main St', zip: '92311' });
    assert.equal(result.bookable, true);
    assert.equal(result.outOfArea, false);
    assert.equal(result.inServiceArea, true);
    assert.equal(result.county, 'San Bernardino');
    assert.equal(result.handoff, false);
    assert.equal(result.driveSurchargeUsd, drive.amountUsd);
    assert.equal(result.nearerShop, drive.nearerShop);
    assert.match(result.message, /\$100 per hour of drive time beyond 1 hour/);
    assert.match(result.driveSpoken, /\$100 per hour/);
    assert.equal(result.driveLine?.name, DRIVE_SURCHARGE_LINE_NAME);
    assert.equal(result.driveLine?.unitPrice, drive.amountUsd);
    assert.equal(result.driveLine?.quantity, 1);
    assert.match(result.driveLine?.description || '', /initial service/i);
    assert.match(result.driveInstructions || '', /initial service drive surcharge/i);

    const farther = driveSurchargeFromHours(Math.max(drive.ramonaHours, drive.anzaHours));
    assert.ok(result.driveSurchargeUsd < farther.amountUsd);
  });

  it('a coordinate inside San Bernardino and beyond 1 hour is still bookable', () => {
    const result = decideBookingArea({ lat: 34.8958, lng: -117.0173 });
    assert.equal(result.county, 'San Bernardino');
    assert.equal(result.bookable, true);
    assert.equal(result.outOfArea, false);
    assert.ok(result.driveSurchargeUsd > 0);
  });
});
