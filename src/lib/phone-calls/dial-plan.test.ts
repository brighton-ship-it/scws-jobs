import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AI_RECEPTIONIST, PORTED_LINES, SHOP_NUMBER, TRACKING_SOURCES } from './config.ts';
import { selectInHoursDial } from './dial-plan.ts';
import { dialTimeoutAttribute } from './ring-timeout.ts';
import { buildInboundTwiml } from './twiml.ts';

const SHOP = '+17602763468';
const EXTRA = '+17605550111';
const THIRD = '+17605550222';
const MIKE = AI_RECEPTIONIST;

function dialedNumbers(xml: string): string[] {
  return [...xml.matchAll(/<Number[^>]*>([^<]+)<\/Number>/g)].map((match) => match[1]);
}

describe('in-hours dial reaches Mike about 15s after the first ring', () => {
  const env = {
    PHONE_CALL_SHOP_NUMBERS: `${SHOP},${EXTRA},${THIRD}`,
    PHONE_CALL_FORWARD_MAIN: `${SHOP},${EXTRA}`,
    PHONE_CALL_FORWARD_RANSOM: `${EXTRA},${SHOP}`,
  } as NodeJS.ProcessEnv;

  it('uses exactly one shop number before Mike on every tracking line', () => {
    const cases = [
      ...Object.entries(TRACKING_SOURCES).map(([to, source]) => ({ to, lineKey: null as string | null, source, ring: `${SHOP},${EXTRA},${THIRD}` })),
      { to: PORTED_LINES.main.number, lineKey: 'main', source: PORTED_LINES.main.source, ring: null },
      { to: PORTED_LINES.ransom.number, lineKey: 'ransom', source: PORTED_LINES.ransom.source, ring: null },
    ];
    assert.equal(cases.length, Object.keys(TRACKING_SOURCES).length + Object.keys(PORTED_LINES).length);
    for (const line of cases) {
      const dial = selectInHoursDial({ to: line.to, ring: line.ring, lineKey: line.lineKey, ai: MIKE, env });
      const expectedShop = line.lineKey === 'ransom' ? EXTRA : SHOP;
      assert.equal(dial.voicemail, false, line.source);
      assert.equal(dial.directToMike, false, line.source);
      assert.deepEqual(dial.shop, [expectedShop], line.source);
      assert.equal(dial.mike, MIKE, line.source);
      const xml = buildInboundTwiml({
        shopNumbers: dial.shop,
        nextNumber: dial.mike,
        baseUrl: 'https://scws-jobs.vercel.app/',
        timeout: dialTimeoutAttribute(15),
        notice: 'This call may be recorded for quality and training purposes.',
      });
      assert.deepEqual(dialedNumbers(xml), [expectedShop, MIKE], line.source);
      assert.match(xml, /sequential="true"/, line.source);
      assert.match(xml, /timeout="10"/, line.source);
      assert.ok(xml.indexOf('party=shop') < xml.indexOf('party=mike'), line.source);
    }
  });

  it('keeps a single production ?ring= as the only shop number', () => {
    for (const to of Object.keys(TRACKING_SOURCES)) {
      const dial = selectInHoursDial({ to, ring: SHOP, lineKey: null, ai: MIKE, env: {} as NodeJS.ProcessEnv });
      assert.deepEqual(dial.shop, [SHOP], to);
      assert.equal(dial.mike, MIKE, to);
    }
  });

  it('does not drop extra shop numbers when Mike is not in the dial', () => {
    const dial = selectInHoursDial({
      to: '+17603312502',
      ring: `${SHOP},${EXTRA}`,
      lineKey: null,
      ai: null,
      env,
    });
    assert.deepEqual(dial.shop, [SHOP, EXTRA]);
    assert.equal(dial.mike, null);
    const xml = buildInboundTwiml({ shopNumbers: dial.shop, baseUrl: 'https://x.test', timeout: 10 });
    assert.deepEqual(dialedNumbers(xml), [SHOP, EXTRA]);
    assert.doesNotMatch(xml, /sequential/);
  });

  it('takes a voicemail when a ported line would ring itself', () => {
    const dial = selectInHoursDial({
      to: PORTED_LINES.main.number,
      ring: null,
      lineKey: 'main',
      ai: MIKE,
      env: { PHONE_CALL_FORWARD_MAIN: PORTED_LINES.main.number } as NodeJS.ProcessEnv,
    });
    assert.equal(dial.voicemail, true);
    assert.deepEqual(dial.shop, []);
  });

  it('falls back to the default shop number, still only one, before Mike', () => {
    const dial = selectInHoursDial({
      to: '+17603312502',
      ring: null,
      lineKey: null,
      ai: MIKE,
      env: {} as NodeJS.ProcessEnv,
    });
    assert.deepEqual(dial.shop, [SHOP_NUMBER]);
    assert.equal(dial.mike, MIKE);
  });
});
