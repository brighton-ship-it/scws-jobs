import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callsViewKeyMatches, readCallsViewKey, scrubForCallsView, CALLS_VIEW_KEY_HEADER } from './calls-view-auth.ts';
import { keyMatchesQuotesGpSecret } from './quotes-gp-auth.ts';

const env = { CALLS_VIEW_KEY: 'calls-secret', QUOTES_GP_KEY: 'office-secret', OPS_DASH_KEY: 'dash-secret' } as unknown as NodeJS.ProcessEnv;

test('calls key matches only CALLS_VIEW_KEY', () => {
  assert.equal(callsViewKeyMatches('calls-secret', env), true);
  assert.equal(callsViewKeyMatches('office-secret', env), false);
  assert.equal(callsViewKeyMatches('', env), false);
  assert.equal(callsViewKeyMatches('calls-secret', {} as NodeJS.ProcessEnv), false, 'unset env never matches');
});

test('calls key never unlocks office / Quote GP / metrics auth', () => {
  assert.equal(keyMatchesQuotesGpSecret('calls-secret', env), false);
});

test('reads calls key from header, ?ckey=, cookie', () => {
  assert.equal(readCallsViewKey({ headers: new Headers({ [CALLS_VIEW_KEY_HEADER]: 'h' }) }), 'h');
  assert.equal(readCallsViewKey({ headers: new Headers(), url: 'https://x/ops/calls-live?ckey=q' }), 'q');
  assert.equal(readCallsViewKey({ headers: new Headers() }, { get: () => ({ value: 'c' }) }), 'c');
  assert.equal(readCallsViewKey({ headers: new Headers(), url: 'https://x/?key=office' }), null, 'office ?key= is not read as a calls key');
});

test('scrub keeps only call fields', () => {
  const out = scrubForCallsView({ callFeed: [1], generatedAt: 't', revenue: 9, adSplit: {}, invoiceFollowUp: {}, weekly: {}, needsCallback: {}, missedCallTexts: {} });
  assert.deepEqual(Object.keys(out).sort(), ['callFeed', 'generatedAt', 'scope']);
});
