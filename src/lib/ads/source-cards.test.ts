import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceCards } from './source-cards.ts';

const start = Date.parse('2026-10-01T07:00:00Z'), now = Date.parse('2026-10-12T23:00:00Z');
test('groups calls, forms, booked with drilling/pump split', () => {
  const cards = buildSourceCards({
    startMs: start, nowMs: now,
    calls: [
      { at: '2026-10-12T16:47:00Z', phone: '+17605551111', source: 'gbp_anza' },
      { at: '2026-10-12T18:00:00Z', phone: '+17605551111', source: 'gbp_anza' }, // same caller twice
      { at: '2026-10-12T19:00:00Z', phone: '+17605552222', source: 'gbp_ramona' },
      { at: '2026-10-11T19:00:00Z', phone: '+17605553333', source: 'seo' },
      { at: '2026-10-11T19:00:00Z', phone: '+17605554444', source: 'google_ads' }, // not counted here
      { at: '2026-09-01T19:00:00Z', phone: '+17605555555', source: 'seo' }, // before range
    ],
    forms: [
      { at: '2026-10-05T19:00:00Z', phone: '7605556666', channel: 'seo', serviceType: 'new_well' },
      { at: '2026-10-06T19:00:00Z', phone: '7605557777', channel: 'yelp', serviceType: 'pump_repair' },
      { at: '2026-10-06T19:00:00Z', phone: '7605558888', channel: 'apple_maps', serviceType: 'no_water' },
      { at: '2026-10-06T19:00:00Z', phone: '7605559999', channel: 'direct', serviceType: 'no_water' },
    ],
    jobs: [
      { createdAt: '2026-10-12T20:00:00Z', phones: ['7605551111'], title: 'Service Call - no water' },
      { createdAt: '2026-10-12T20:00:00Z', phones: ['7605552222'], title: 'Site walk - new well' }, // not booked work
      { createdAt: '2026-10-07T20:00:00Z', phones: ['7605556666'], title: 'Drill new well 400ft' },
      { createdAt: '2026-08-07T20:00:00Z', phones: ['7605553333'], title: 'Pump replace' }, // before contact
    ],
  });
  const by = Object.fromEntries(cards.map((c) => [c.key, c]));
  assert.equal(by.gbp.calls, 3); assert.equal(by.gbp.callers, 2);
  assert.deepEqual(by.gbp.booked, { total: 1, pump: 1, drilling: 0 });
  assert.equal(by.seo.calls, 1);
  assert.deepEqual(by.seo.forms, { total: 1, pump: 0, drilling: 1 });
  assert.deepEqual(by.seo.booked, { total: 1, pump: 0, drilling: 1 });
  assert.deepEqual(by.yelp.forms, { total: 1, pump: 1, drilling: 0 });
  assert.equal(by.yelp.booked.total, 0);
  assert.equal(by.apple_maps.forms.total, 1);
});
test('empty is zeros, never invented', () => {
  const cards = buildSourceCards({ startMs: start, nowMs: now, calls: [], forms: [], jobs: [] });
  for (const c of cards) { assert.equal(c.calls, 0); assert.equal(c.forms.total, 0); assert.equal(c.booked.total, 0); }
});
test('yelp / apple tracking numbers map to their cards', async () => {
  const { TRACKING_SOURCES } = await import('../phone-calls/config.ts');
  assert.equal(TRACKING_SOURCES['+17608914264'], 'yelp');
  assert.equal(TRACKING_SOURCES['+17604540365'], 'apple_maps');
  const cards = buildSourceCards({ startMs: start, nowMs: now, forms: [], jobs: [], calls: [
    { at: '2026-10-12T19:00:00Z', phone: '+17605550001', source: TRACKING_SOURCES['+17608914264'] },
    { at: '2026-10-12T19:00:00Z', phone: '+17605550002', source: TRACKING_SOURCES['+17604540365'] },
  ] });
  assert.equal(cards.find((c) => c.key === 'yelp')!.calls, 1);
  assert.equal(cards.find((c) => c.key === 'apple_maps')!.calls, 1);
});
