import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendSourceToNotes,
  normalizeBookingSource,
} from './booking-source.ts';

describe('normalizeBookingSource', () => {
  it('defaults empty values to website', () => {
    assert.deepEqual(normalizeBookingSource(undefined), { source: 'website', original: null });
    assert.deepEqual(normalizeBookingSource(null), { source: 'website', original: null });
    assert.deepEqual(normalizeBookingSource(''), { source: 'website', original: null });
    assert.deepEqual(normalizeBookingSource('   '), { source: 'website', original: null });
  });

  it('accepts live-site and app sources case-insensitively', () => {
    for (const source of ['website', 'embed', 'manual', 'phone', 'google_ads', 'cost-calculator', 'other']) {
      assert.deepEqual(normalizeBookingSource(source), { source, original: null });
    }
    assert.deepEqual(normalizeBookingSource('Google_Ads'), { source: 'google_ads', original: null });
  });

  it('maps punctuation aliases for google ads and the cost calculator', () => {
    assert.deepEqual(normalizeBookingSource('google-ads'), { source: 'google_ads', original: null });
    assert.deepEqual(normalizeBookingSource('google ads'), { source: 'google_ads', original: null });
    assert.deepEqual(normalizeBookingSource('cost_calculator'), { source: 'cost-calculator', original: null });
  });

  it('saves unknown UTMs as other instead of rejecting', () => {
    assert.deepEqual(normalizeBookingSource('paid_search'), {
      source: 'other',
      original: 'paid_search',
    });
    assert.deepEqual(normalizeBookingSource('spring_promo_2026'), {
      source: 'other',
      original: 'spring_promo_2026',
    });
  });
});

describe('appendSourceToNotes', () => {
  it('keeps the original source on the lead notes', () => {
    assert.equal(appendSourceToNotes(null, 'paid_search'), '[source: paid_search]');
    assert.equal(
      appendSourceToNotes('boost pump notes', 'paid_search'),
      '[source: paid_search] boost pump notes'
    );
  });
});
