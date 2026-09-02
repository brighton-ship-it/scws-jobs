import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { internalAirRotaryCostBand, mentionsGpFlag } from './cost.ts';

describe('internal air rotary cost band', () => {
  it('uses SCWS street ~$45–48/ft and never mentions GP FLAG', () => {
    const band = internalAirRotaryCostBand(400);
    assert.ok(band);
    assert.equal(band?.low, 18000);
    assert.equal(band?.high, 19200);
    assert.equal(band?.perFootLow, 45);
    assert.equal(band?.perFootHigh, 48);
    assert.match(band?.label || '', /\$45–\$48\/ft/);
    assert.equal(mentionsGpFlag(band?.label), false);
    assert.doesNotMatch(band?.label || '', /\$50-80|\$50–80|GP FLAG/i);
  });
});
