import test from 'node:test';
import assert from 'node:assert/strict';
import { leadChannel, channelFromReferrer, pathOnly, isTestLead } from './lead-channel.ts';

test('google ads wins', () => {
  assert.equal(leadChannel({ site_source: 'seo' }, true), 'google_ads');
  assert.equal(leadChannel({ utm_source: 'google', utm_medium: 'cpc' }), 'google_ads');
});
test('site_source from scwellservice.com', () => {
  for (const c of ['gbp', 'seo', 'yelp', 'apple_maps', 'referral', 'direct']) assert.equal(leadChannel({ site_source: c }), c);
  assert.equal(leadChannel({ site_source: 'bogus', referrer: 'https://www.yelp.com/biz/x' }), 'yelp');
});
test('utm', () => {
  assert.equal(leadChannel({ utm_source: 'gbp', utm_medium: 'organic' }), 'gbp');
  assert.equal(leadChannel({ utm_source: 'yelp' }), 'yelp');
  assert.equal(leadChannel({ utm_source: 'apple_maps' }), 'apple_maps');
  assert.equal(leadChannel({ utm_source: 'google', utm_medium: 'organic' }), 'seo');
  assert.equal(leadChannel({ utm_source: 'newsletter', utm_medium: 'email' }), 'referral');
});
test('referrer', () => {
  assert.equal(channelFromReferrer('https://www.google.com/'), 'seo');
  assert.equal(channelFromReferrer('https://www.bing.com/search?q=x'), 'seo');
  assert.equal(channelFromReferrer('https://www.google.com/maps/place/x'), 'gbp');
  assert.equal(channelFromReferrer('https://maps.google.com/'), 'gbp');
  assert.equal(channelFromReferrer('https://m.yelp.com/biz/scws'), 'yelp');
  assert.equal(channelFromReferrer('https://maps.apple.com/place?x=1'), 'apple_maps');
  assert.equal(channelFromReferrer('https://scwellservice.com/contact.html'), null);
  assert.equal(channelFromReferrer('https://nextdoor.com/x'), 'referral');
  assert.equal(channelFromReferrer('direct'), null);
  assert.equal(leadChannel({ referrer: 'direct' }), 'direct');
  assert.equal(leadChannel({}), 'direct');
});
test('helpers', () => {
  assert.equal(pathOnly('https://scwellservice.com/pump-repair.html?gclid=abc'), 'scwellservice.com/pump-repair.html');
  assert.equal(pathOnly('direct'), null);
  assert.ok(isTestLead({ scws_test: '1' }));
  assert.ok(!isTestLead({}));
});
