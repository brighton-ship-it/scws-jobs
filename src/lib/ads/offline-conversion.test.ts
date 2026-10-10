import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClickConversion,
  formatAdsDateTime,
  hashEmail,
  hashPhoneE164,
} from './offline-conversion.ts';

const ACTION = 'customers/1/conversionActions/2';
const base = { jobberJobId: 'J1', conversionAt: '2026-10-09T15:30:00Z', valueUsd: 1234.567 };

describe('offline conversion builder', () => {
  it('uses gclid and order_id, rounds value', () => {
    const c = buildClickConversion(ACTION, { ...base, gclid: 'abc' })!;
    assert.equal(c.gclid, 'abc');
    assert.equal(c.order_id, 'J1');
    assert.equal(c.conversion_value, 1234.57);
    assert.equal(c.conversion_date_time, '2026-10-09 15:30:00+00:00');
  });
  it('sends only one click id', () => {
    const c = buildClickConversion(ACTION, { ...base, gclid: 'a', gbraid: 'b' })!;
    assert.equal(c.gbraid, undefined);
  });
  it('falls back to hashed identifiers only', () => {
    const c = buildClickConversion(ACTION, { ...base, email: ' A@B.com ', phone: '(760) 555-1212' })!;
    assert.equal(c.gclid, undefined);
    assert.equal(c.user_identifiers?.length, 2);
    assert.equal(hashEmail('a@b.com'), c.user_identifiers![0].hashed_email);
    assert.equal(hashPhoneE164('7605551212'), c.user_identifiers![1].hashed_phone_number);
  });
  it('returns null with nothing to match or no value', () => {
    assert.equal(buildClickConversion(ACTION, base), null);
    assert.equal(buildClickConversion(ACTION, { ...base, gclid: 'a', valueUsd: 0 }), null);
  });
  it('rejects bad dates', () => {
    assert.throws(() => formatAdsDateTime('nope'));
  });
});
