import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inboundCallEmailPlan, lookupShopLeg, shopLegFromTwilio, shortPickupDecision, sweepInboundEmail, withAmd, withParty } from './missed-alert.ts';
import { classifyInboundParents } from '../receptionist/missed-call-text.ts';

const PARENT = 'CAca5e246635eda92c926428c76dc5a8cc';
const SHOP_LEG = {
  sid: 'CAa0a9cd3737b53db6f70aadb6b4b23f5f', parent_call_sid: PARENT, to: '+17602763468', status: 'completed',
  date_created: 'Tue, 03 Nov 2026 16:53:52 +0000', start_time: 'Tue, 03 Nov 2026 16:54:04 +0000',
  end_time: 'Tue, 03 Nov 2026 16:54:13 +0000', duration: '9', answered_by: 'human',
};
const short = { dialStatus: 'completed', canHandoff: false, party: null, mikeOnly: false, mikeInDial: false, shopSeconds: 9 } as const;

describe('short shop pickup vs late AMD (CAca5e24…)', () => {
  it('completed 9s with no AMD stored defers instead of emailing missed', () => {
    assert.deepEqual(inboundCallEmailPlan({ ...short, amdPending: true }), { handoff: false, send: 'defer', who: 'missed' });
  });
  it('without amdPending keeps the old immediate send (AMD known not human)', () => {
    assert.equal(inboundCallEmailPlan(short).send, 'now');
  });
  it('AMD human found on the Twilio child leg -> answered, no missed email', () => {
    const leg = shopLegFromTwilio({ calls: [SHOP_LEG] });
    assert.equal(leg.answeredBy, 'human');
    assert.equal(shortPickupDecision(leg), 'answered');
  });
  it('AMD human arrives after the status callback -> sweep sends no missed email', () => {
    const now = Date.parse('2026-11-03T17:10:00Z');
    const row = { dial_status: 'completed', answered: true, duration_seconds: 9, updated_at: '2026-11-03T16:54:14Z' };
    // status callback deferred and wrote leg:shop; AMD human landed afterward.
    assert.equal(sweepInboundEmail({ ...row, processing_error: withAmd(withParty(null, 'shop'), 'human') }, now), null);
  });
  it('AMD machine on the child leg -> missed email', () => {
    const leg = shopLegFromTwilio({ calls: [{ ...SHOP_LEG, answered_by: 'machine_start' }] });
    assert.equal(shortPickupDecision(leg), 'missed');
  });
  it('AMD never arrives -> sweep emails missed after the retry wait', () => {
    const row = { dial_status: 'completed', answered: true, duration_seconds: 9, updated_at: '2026-11-03T16:54:14Z', processing_error: withParty(null, 'shop') };
    assert.equal(shortPickupDecision(shopLegFromTwilio({ calls: [{ ...SHOP_LEG, answered_by: null }] })), 'wait');
    assert.equal(sweepInboundEmail(row, Date.parse('2026-11-03T16:55:00Z')), null);
    assert.equal(sweepInboundEmail(row, Date.parse('2026-11-03T16:57:00Z')), 'missed');
  });
  it('lookup failure waits for the sweep', () => {
    assert.equal(shortPickupDecision(null), 'wait');
  });
});

describe('Twilio ring time', () => {
  it('answered leg: start_time - date_created (12s, not 21s)', () => {
    assert.equal(shopLegFromTwilio({ calls: [SHOP_LEG] }).ringSeconds, 12);
  });
  it('unanswered leg: end_time - start_time', () => {
    const leg = { ...SHOP_LEG, status: 'no-answer', duration: '0', answered_by: null, start_time: 'Tue, 03 Nov 2026 17:22:07 +0000', end_time: 'Tue, 03 Nov 2026 17:22:22 +0000' };
    assert.equal(shopLegFromTwilio({ calls: [leg] }).ringSeconds, 15);
  });
  it('ignores the Mike leg', () => {
    const mike = { ...SHOP_LEG, to: '+17605551234', answered_by: null };
    assert.equal(shopLegFromTwilio({ calls: [mike] }, ['+17605551234']).answeredBy, null);
  });
  it('lookupShopLeg queries ParentCallSid', async () => {
    let url = '';
    const fake = (async (u: string) => { url = u; return new Response(JSON.stringify({ calls: [SHOP_LEG] })); }) as unknown as typeof fetch;
    const out = await lookupShopLeg(PARENT, { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' } as any, fake);
    assert.match(url, /ParentCallSid=CAca5e24/);
    assert.equal(out?.answeredBy, 'human');
  });
});

describe('auto-text uses the same answered rule', () => {
  const lines = new Set(['9516510957']);
  const parent = { sid: PARENT, parentSid: null, from: '+19519889136', to: '+19516510957', direction: 'inbound', status: 'completed', at: '2026-11-03T16:53:48Z', durationSeconds: 26 };
  const child = { sid: SHOP_LEG.sid, parentSid: PARENT, from: '+19516510957', to: '+17602763468', direction: 'outbound-dial', status: 'completed', at: '2026-11-03T16:54:04Z', durationSeconds: 9 };
  it('9s shop leg with AMD human is answered: no text', () => {
    const [c] = classifyInboundParents({ legs: [parent, { ...child, answeredBy: 'human' }], lines, mikeNumbers: new Set() });
    assert.equal(c.shopAnswered, true);
    assert.equal(c.candidate, null);
  });
  it('9s shop leg with AMD machine is still a text candidate', () => {
    const [c] = classifyInboundParents({ legs: [parent, { ...child, answeredBy: 'machine_start' }], lines, mikeNumbers: new Set() });
    assert.equal(c.shopAnswered, false);
    assert.ok(c.candidate);
  });
});

describe('status route wiring', () => {
  const src = readFileSync(new URL('../../app/api/calls/inbound/status/route.ts', import.meta.url), 'utf8');
  it('passes amdPending and looks up the child leg before a deferred missed email', () => {
    assert.match(src, /amdPending:/);
    assert.match(src, /lookupShopLeg\(/);
    assert.match(src, /plan\.who !== 'missed' && !party && mikeInDial/);
  });
});
