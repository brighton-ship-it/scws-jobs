import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diversionNumbers, jobberClientLine, leadSourceLine, resolveLeadSource, vapiAnsweredNumber } from './lead-source.ts';
import { buildCallEmail, extractCallOutcome } from './call-email.ts';

const sipCall = (diversion: string | null) => ({
  phoneCallProviderDetails: {
    sip: {
      headers: { to: '<sip:+17604915348@192.168.250.45>', ...(diversion ? { Diversion: diversion } : {}) },
      raw: `INVITE sip:7604915348@x SIP/2.0\r\n${diversion ? `Diversion: ${diversion}\r\n` : ''}\r\n`,
    },
  },
});

describe('lead source for the Mike call email', () => {
  it('Google Voice main line via Diversion (Oct 19 9:34 AM call)', () => {
    const call = sipCall('<sip:+17604408520@64.125.111.10:5060>;reason=unknown;privacy=off;screen=no;counter=1');
    assert.deepEqual(diversionNumbers(call), ['7604408520']);
    const line = leadSourceLine(resolveLeadSource({ diversions: diversionNumbers(call), answered: vapiAnsweredNumber(call) }));
    assert.equal(line, 'Lead source: Main line (760) 440-8520');
  });

  it('Twilio Google Ads tracking number via Diversion', () => {
    const call = sipCall('<sip:+17603312502@54.172.60.1:5060>;reason=unconditional');
    assert.equal(leadSourceLine(resolveLeadSource({ diversions: diversionNumbers(call) })), 'Lead source: Google Ads (760) 331-2502');
  });

  it('raw INVITE fallback when headers object lacks Diversion', () => {
    const call = { phoneCallProviderDetails: { sip: { headers: {}, raw: 'INVITE x\r\nDiversion: <sip:+17604630493@1.2.3.4:5060>;counter=1\r\n' } } };
    assert.equal(leadSourceLine(resolveLeadSource({ diversions: diversionNumbers(call) })), 'Lead source: Website (SEO) (760) 463-0493');
  });

  it('tracking recording beats a generic Main diversion', () => {
    const src = resolveLeadSource({ diversions: ['7604408520'], recordings: [{ tracking_number: '+17602791262', source: 'gbp_ramona' }] });
    assert.equal(leadSourceLine(src), 'Lead source: Google Business Profile (Ramona) (760) 279-1262');
    const anza = resolveLeadSource({ recordings: [{ tracking_number: '+19516510957', source: 'gbp_anza' }] });
    assert.equal(leadSourceLine(anza), 'Lead source: Google Business Profile (Anza) (951) 651-0957');
  });

  it('ignores test recordings; Ransom line', () => {
    const src = resolveLeadSource({ diversions: ['7607895955'], recordings: [{ tracking_number: '+17603312502', source: 'test' }] });
    assert.equal(leadSourceLine(src), 'Lead source: Ransom line (760) 789-5955');
  });

  it('unknown channel shows the dialed number', () => {
    assert.equal(leadSourceLine(resolveLeadSource({ diversions: ['6195550100'] })), 'Lead source: Unknown (dialed (619) 555-0100)');
    const direct = sipCall(null);
    assert.equal(leadSourceLine(resolveLeadSource({ diversions: diversionNumbers(direct), answered: vapiAnsweredNumber(direct) })), 'Lead source: Unknown (dialed (760) 491-5348)');
    assert.equal(leadSourceLine(resolveLeadSource({})), 'Lead source: Unknown (dialed number not available)');
  });

  it('Jobber client line from Mike lookupCustomer', () => {
    assert.equal(jobberClientLine([{ role: 'tool_call_result', name: 'lookupCustomer', result: '{"found":false,"message":"x"}' }]), 'Client: New caller (number not in Jobber)');
    assert.equal(jobberClientLine([{ role: 'tool_call_result', name: 'lookupCustomer', result: JSON.stringify({ found: true, customerName: 'Ann Lee' }) }]), 'Client: Existing Jobber client (Ann Lee)');
    assert.equal(jobberClientLine([]), null);
  });

  it('email puts Lead source right under Number', () => {
    const outcome = extractCallOutcome([], { phone: '3233970313' });
    const mail = buildCallEmail({ outcome, leadSourceLine: 'Lead source: Main line (760) 440-8520', clientLine: 'Client: New caller (number not in Jobber)' });
    const lines = mail.text.split('\n');
    const i = lines.findIndex((l) => l.startsWith('Number:'));
    assert.equal(lines[i + 1], 'Lead source: Main line (760) 440-8520');
    assert.equal(lines[i + 2], 'Client: New caller (number not in Jobber)');
    assert.ok(!/Lead source/.test(buildCallEmail({ outcome }).text));
  });
});
