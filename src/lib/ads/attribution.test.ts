import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ADS_ATTRIBUTION_COOKIE,
  ADS_ATTRIBUTION_MAX_AGE_SEC,
  attributionCookieAssignment,
  attributionFromCookieHeader,
  gaClientIdFromCookie,
  gaSessionIdFromCookie,
  isGoogleAdsTouch,
  mergeAttribution,
  parseAttributionCookie,
  serializeAttributionCookie,
  type AdsAttribution,
} from './attribution.ts';

const NOW = new Date('2026-10-10T12:00:00.000Z');

function stored(partial: Partial<AdsAttribution>): AdsAttribution {
  return mergeAttribution(null, partial, NOW);
}

describe('ads attribution cookie', () => {
  it('keeps a click id for 90 days and does not wipe it on a later page', () => {
    assert.equal(ADS_ATTRIBUTION_MAX_AGE_SEC, 90 * 24 * 60 * 60);
    const first = mergeAttribution(
      null,
      { gclid: 'click-1', utm_campaign: 'Search-1', utm_term: 'well pump', utm_medium: 'cpc' },
      NOW
    );
    const later = mergeAttribution(first, { utm_source: null, gclid: null }, NOW);
    assert.equal(later.gclid, 'click-1');
    assert.equal(later.utm_campaign, 'Search-1');
    assert.equal(later.utm_term, 'well pump');
    assert.equal(later.captured_at, NOW.toISOString());
  });

  it('replaces the click id when a new ad click arrives', () => {
    const first = stored({ gclid: 'click-1', utm_campaign: 'Search-1' });
    const next = mergeAttribution(
      first,
      { gclid: 'click-2', utm_campaign: 'Drilling', utm_term: 'new well' },
      new Date('2026-10-11T00:00:00.000Z')
    );
    assert.equal(next.gclid, 'click-2');
    assert.equal(next.utm_campaign, 'Drilling');
    assert.equal(next.utm_term, 'new well');
    assert.equal(next.captured_at, '2026-10-11T00:00:00.000Z');
  });

  it('round-trips the cookie and reads a GA client id', () => {
    const value = stored({
      gclid: 'Cj0KCQ',
      ga_client_id: '111.222',
      utm_medium: 'cpc',
    });
    const raw = serializeAttributionCookie(value);
    const parsed = parseAttributionCookie(encodeURIComponent(raw));
    assert.equal(parsed?.gclid, 'Cj0KCQ');
    assert.equal(parsed?.ga_client_id, '111.222');
    assert.equal(gaClientIdFromCookie('GA1.1.111.222'), '111.222');
    assert.equal(gaSessionIdFromCookie('GS1.1.1690000000.1.1.1690000000.0.0.0'), '1690000000');

    const header = attributionFromCookieHeader(
      `${ADS_ATTRIBUTION_COOKIE}=${encodeURIComponent(raw)}; _ga=GA1.1.999.888`
    );
    assert.equal(header?.gclid, 'Cj0KCQ');
    assert.equal(header?.ga_client_id, '999.888');
  });

  it('sets a host-only 90-day cookie assignment', () => {
    const assignment = attributionCookieAssignment(stored({ gclid: 'abc' }), { secure: true });
    assert.match(assignment, new RegExp(`^${ADS_ATTRIBUTION_COOKIE}=`));
    assert.match(assignment, /Max-Age=7776000/);
    assert.match(assignment, /Path=\//);
    assert.match(assignment, /SameSite=Lax/);
    assert.match(assignment, /Secure/);
    assert.equal(assignment.includes('Domain='), false);
  });

  it('treats a click id or cpc medium as Google Ads', () => {
    assert.equal(isGoogleAdsTouch({ gclid: 'abc' }), true);
    assert.equal(isGoogleAdsTouch({ gbraid: 'b' }), true);
    assert.equal(isGoogleAdsTouch({ utm_medium: 'CPC' }), true);
    assert.equal(isGoogleAdsTouch({ leadSourceLabel: 'google_ads' }), true);
    assert.equal(isGoogleAdsTouch({ utm_medium: 'organic' }), false);
    assert.equal(isGoogleAdsTouch({ leadSourceLabel: 'facebook_ads' }), false);
    assert.equal(isGoogleAdsTouch({}), false);
  });

  it('ships the same cookie contract in the public script', () => {
    const script = readFileSync('public/ads-attribution.js', 'utf8');
    assert.match(script, /scws_ads/);
    assert.match(script, /7776000/);
    for (const field of ['gclid', 'gbraid', 'wbraid', 'ga_client_id', 'utm_campaign', 'utm_term']) {
      assert.match(script, new RegExp(field));
    }
  });
});
