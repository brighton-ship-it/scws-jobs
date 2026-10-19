import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addressKey, hashKey, isMailedAddress, matchByAddress, dmSummary, dm1Config, mailedKeyCount } from './campaign.ts';

describe('direct mail DM1', () => {
  it('normalizes addresses like the list build', () => {
    assert.equal(addressKey('1077 Main St.', '92065-1234'), '1077|MAIN|92065');
    assert.equal(addressKey('PO Box 5', '92065'), null);
  });
  it('matches hashed keys only', () => {
    const keys = new Set([hashKey('500|OAK|92065')]);
    assert.ok(isMailedAddress('500 Oak Rd', '92065', keys));
    assert.ok(!isMailedAddress('501 Oak Rd', '92065', keys));
    const mail = Date.parse('2026-10-26T00:00:00-07:00');
    const hits = matchByAddress([
      { id: 'a', name: 'A', createdAt: '2026-11-02T18:00:00Z', addresses: [{ street1: '500 OAK ROAD', postalCode: '92065' }], phones: [] },
      { id: 'b', name: 'B', createdAt: '2026-10-01T18:00:00Z', addresses: [{ street1: '500 Oak Rd', postalCode: '92065' }], phones: [] },
    ], mail, Date.parse('2026-12-01T00:00:00Z'), keys);
    assert.deepEqual(hits.map((h) => h.id), ['a']);
  });
  it('ships the mailing-list keys and a placeholder spend', () => {
    assert.ok(mailedKeyCount() > 2400);
    const c = dm1Config({} as NodeJS.ProcessEnv);
    assert.equal(c.pieces, 2500); assert.ok(c.spendIsPlaceholder);
    assert.equal(dm1Config({ DM1_COST: '1950' } as any).spend, 1950);
  });
  it('rates responses against pieces mailed', () => {
    const s = dmSummary({ calls: 30, callers: 20, forms: 5, booked: 4, matched: 3, matchedNotTracked: 1, invoiced: 4000, pieces: 2500, spend: 2000, spendIsPlaceholder: false });
    assert.equal(s.responses, 26); assert.equal(s.responseRatePct, 1.04); assert.equal(s.roas, 2); assert.equal(s.costPerBooking, 500);
  });
});
