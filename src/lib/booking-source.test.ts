import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendAttributionToNotes,
  appendSourceToNotes,
  BOOKING_SOURCES,
  extractBookingUtms,
  inboundBookingSource,
  normalizeBookingSource,
} from './booking-source.ts';
import { extractAdsClickIds } from './ads/click-ids.ts';

/** Live Production CHECK from 20260205_receptionist_calls.sql */
const LIVE_SOURCE_CHECK = ['website', 'embed', 'manual', 'phone'] as const;

describe('normalizeBookingSource', () => {
  it('defaults empty values to website', () => {
    assert.deepEqual(normalizeBookingSource(undefined), { source: 'website', original: null });
    assert.deepEqual(normalizeBookingSource(null), { source: 'website', original: null });
    assert.deepEqual(normalizeBookingSource(''), { source: 'website', original: null });
    assert.deepEqual(normalizeBookingSource('   '), { source: 'website', original: null });
  });

  it('accepts live Production CHECK values case-insensitively', () => {
    for (const source of ['website', 'embed', 'manual', 'phone']) {
      assert.deepEqual(normalizeBookingSource(source), { source, original: null });
    }
    assert.deepEqual(normalizeBookingSource('Website'), { source: 'website', original: null });
    assert.deepEqual(normalizeBookingSource('PHONE'), { source: 'phone', original: null });
  });

  it('maps google_ads and other Ads aliases to website before insert', () => {
    for (const raw of [
      'google_ads',
      'Google_Ads',
      'google-ads',
      'google ads',
      'googleads',
      'adwords',
      'cpc',
      'ppc',
      'bing_ads',
      'facebook_ads',
    ]) {
      assert.deepEqual(normalizeBookingSource(raw), {
        source: 'website',
        original: raw,
      });
    }
  });

  it('maps form / calculator aliases to website', () => {
    assert.deepEqual(normalizeBookingSource('website_form'), {
      source: 'website',
      original: 'website_form',
    });
    assert.deepEqual(normalizeBookingSource('cost-calculator'), {
      source: 'website',
      original: 'cost-calculator',
    });
    assert.deepEqual(normalizeBookingSource('cost_calculator'), {
      source: 'website',
      original: 'cost_calculator',
    });
  });

  it('saves unknown UTMs as website instead of other (other is not in the live CHECK)', () => {
    assert.deepEqual(normalizeBookingSource('paid_search'), {
      source: 'website',
      original: 'paid_search',
    });
    assert.deepEqual(normalizeBookingSource('spring_promo_2026'), {
      source: 'website',
      original: 'spring_promo_2026',
    });
  });
});

describe('inboundBookingSource', () => {
  it('prefers source, then lead_source from the marketing site', () => {
    assert.equal(inboundBookingSource({ source: 'website' }), 'website');
    assert.equal(inboundBookingSource({ lead_source: 'google_ads' }), 'google_ads');
    assert.equal(
      inboundBookingSource({ source: 'website', lead_source: 'google_ads' }),
      'website'
    );
    assert.equal(inboundBookingSource({ source: '  ', lead_source: 'google_ads' }), 'google_ads');
    assert.equal(inboundBookingSource({}), undefined);
  });
});

describe('extractBookingUtms', () => {
  it('keeps inbound UTM fields and ignores empties', () => {
    assert.deepEqual(
      extractBookingUtms({
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'pump-repair',
        utm_term: '  ',
        notes: 'leave me',
      }),
      {
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'pump-repair',
        utm_term: null,
        utm_content: null,
      }
    );
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

describe('Production booking insert shape', () => {
  it('accepts google_ads lead_source without violating the live CHECK', () => {
    const body = {
      lead_source: 'google_ads',
      notes: 'no water',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'pump-repair',
      gclid: 'TeSt-gclid.1',
      gbraid: 'TeSt-gbraid.1',
      wbraid: 'TeSt-wbraid.1',
      ga_client_id: '123.456',
      ga_session_id: '789',
    };
    const { source, original } = normalizeBookingSource(inboundBookingSource(body));
    const utms = extractBookingUtms(body);
    const clickIds = extractAdsClickIds(body);
    const notes = appendAttributionToNotes(body.notes, original, utms);

    assert.equal(source, 'website');
    assert.ok((LIVE_SOURCE_CHECK as readonly string[]).includes(source));
    assert.deepEqual([...BOOKING_SOURCES], [...LIVE_SOURCE_CHECK]);
    assert.equal(clickIds.gclid, 'TeSt-gclid.1');
    assert.equal(clickIds.gbraid, 'TeSt-gbraid.1');
    assert.equal(clickIds.wbraid, 'TeSt-wbraid.1');
    assert.equal(clickIds.ga_client_id, '123.456');
    assert.equal(clickIds.ga_session_id, '789');
    assert.match(notes ?? '', /\[source: google_ads\]/);
    assert.match(notes ?? '', /utm_source=google/);
    assert.match(notes ?? '', /utm_medium=cpc/);
    assert.match(notes ?? '', /no water$/);
  });

  it('leaves existing website and phone inserts unchanged', () => {
    assert.deepEqual(normalizeBookingSource(inboundBookingSource({ source: 'website' })), {
      source: 'website',
      original: null,
    });
    assert.deepEqual(normalizeBookingSource(inboundBookingSource({ source: 'phone' })), {
      source: 'phone',
      original: null,
    });
    assert.equal(
      appendAttributionToNotes('callback after 5', null, extractBookingUtms({})),
      'callback after 5'
    );
  });
});

describe('appendAttributionToNotes', () => {
  it('prefixes remapped source and UTMs without dropping customer notes', () => {
    assert.equal(
      appendAttributionToNotes('no water since Tuesday', 'google_ads', {
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'brand',
        utm_term: null,
        utm_content: null,
      }),
      '[source: google_ads] [utm_source=google utm_medium=cpc utm_campaign=brand] no water since Tuesday'
    );
  });

  it('returns notes unchanged when there is no extra attribution', () => {
    assert.equal(
      appendAttributionToNotes('just notes', null, {
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        utm_term: null,
        utm_content: null,
      }),
      'just notes'
    );
    assert.equal(
      appendAttributionToNotes(null, null, {
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        utm_term: null,
        utm_content: null,
      }),
      null
    );
  });
});
