import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildForwardBody, forwardLine, forwardTargets, mediaUrls, planForward, EMPTY_TWIML } from './forward.ts';

const base = { From: '+17605550100', To: '+17604408520', Body: 'Pump is out', NumMedia: '0', MessageSid: 'SM1' };

describe('sms-forward', () => {
  it('labels the two ported lines only', () => {
    assert.equal(forwardLine('+17604408520')?.label, 'Main line');
    assert.equal(forwardLine('+17607895955')?.label, 'Ransom line');
    assert.equal(forwardLine('+18773863995'), null);
    assert.equal(forwardLine('+17608237963'), null);
  });
  it('builds "From ... to <line>: body"', () => {
    assert.equal(buildForwardBody(base, 'Main line'), 'From +17605550100 to Main line: Pump is out');
  });
  it('forwards MMS media and notes it', () => {
    const p = { ...base, Body: '', NumMedia: '2', MediaUrl0: 'https://api.twilio.com/m/0', MediaUrl1: 'https://api.twilio.com/m/1' };
    assert.deepEqual(mediaUrls(p), ['https://api.twilio.com/m/0', 'https://api.twilio.com/m/1']);
    assert.equal(buildForwardBody(p, 'Ransom line'), 'From +17605550100 to Ransom line: (no text) [2 photos/files attached]');
  });
  it('truncates long bodies under the Twilio limit', () => {
    assert.ok(buildForwardBody({ ...base, Body: 'x'.repeat(3000) }, 'Main line').length <= 1500);
  });
  it('defaults to Liz and honours SMS_FORWARD_TO', () => {
    assert.deepEqual(forwardTargets({} as any), ['+16193208264']);
    assert.deepEqual(forwardTargets({ SMS_FORWARD_TO: '+16195550000, junk' } as any), ['+16195550000']);
  });
  it('plans a forward for a customer text to the main line', () => {
    const p = planForward(base, {} as any);
    assert.equal(p.action, 'forward');
    if (p.action === 'forward') { assert.deepEqual(p.to, ['+16193208264']); assert.equal(p.line.source, 'main_line'); }
  });
  it('skips other numbers, our own numbers, and the target (no loops)', () => {
    assert.deepEqual(planForward({ ...base, To: '+18773863995' }, {} as any), { action: 'skip', reason: 'not_forwarded_line' });
    assert.deepEqual(planForward({ ...base, From: '+17608237963' }, {} as any), { action: 'skip', reason: 'own_number' });
    assert.deepEqual(planForward({ ...base, From: '+16193208264' }, {} as any), { action: 'skip', reason: 'own_number' });
    assert.deepEqual(planForward(base, { SMS_FORWARD_TO: '+17604408520' } as any), { action: 'skip', reason: 'no_target' });
  });
  it('never replies to the texter', () => {
    assert.doesNotMatch(EMPTY_TWIML, /<Message/);
  });
});

import { isPublicApiRoute } from '../public-api.ts';
describe('sms-forward middleware', () => {
  it('lets Twilio POST reach the route (route checks the signature)', () => {
    assert.equal(isPublicApiRoute('POST', '/api/sms/forward'), true);
    assert.equal(isPublicApiRoute('GET', '/api/sms/forward'), false);
  });
});
