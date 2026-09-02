import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAllowedMotorBrand,
  calculateRequiredHP,
  calculateTotalDynamicHead,
  nextCommonHp,
  pressureHeadFt,
  recommendedWireSize,
  sizePump,
} from './pump-sizing.ts';

describe('pump sizing', () => {
  it('builds TDH from pumping level + pressure + friction + elevation', () => {
    const tdh = calculateTotalDynamicHead({
      pumpingLevelFt: 150,
      pressurePsi: 50,
      frictionLossFt: 10,
      elevationChangeFt: 20,
    });
    assert.equal(tdh, 150 + pressureHeadFt(50) + 10 + 20);
  });

  it('sizes HP, wire, and tank from real inputs — no invented model numbers', () => {
    const result = sizePump({
      wellDepthFt: 400,
      staticLevelFt: 120,
      drawdownFt: 40,
      gpm: 15,
      pressurePsi: 50,
      pipeLengthFt: 80,
      pipeDiameterIn: 1.25,
      elevationChangeFt: 0,
      motorBrand: 'CentriPro',
    });
    assert.ok(result.tdhFt > 200);
    assert.equal(result.pumpingLevelFt, 160);
    assert.equal(result.recommendedHp, nextCommonHp(calculateRequiredHP(15, result.tdhFt)));
    assert.equal(result.motorBrand, 'CentriPro');
    assert.equal(result.tankGallons, 62);
    assert.match(result.wireSize, /AWG/);
    assert.equal(result.pumpSettingFt, 210);
    assert.ok(result.notes.some((note) => /Franklin or CentriPro/i.test(note)));
    assert.ok(!result.notes.some((note) => /\b(GS\d|25S50|model)\s*\d/i.test(note)));
    const blob = JSON.stringify(result);
    assert.doesNotMatch(blob, /Grundfos|Goulds \d+GS|25S50/);
  });

  it('allows Franklin or CentriPro only', () => {
    assert.equal(assertAllowedMotorBrand('Franklin'), 'Franklin');
    assert.equal(assertAllowedMotorBrand('CentriPro'), 'CentriPro');
    assert.throws(() => assertAllowedMotorBrand('Grundfos'), /Franklin or CentriPro/);
  });

  it('refuses to size without static level or GPM', () => {
    assert.throws(
      () =>
        sizePump({
          wellDepthFt: 400,
          staticLevelFt: Number.NaN,
          drawdownFt: 0,
          gpm: 10,
          pressurePsi: 50,
          pipeLengthFt: 0,
          pipeDiameterIn: 1.25,
          elevationChangeFt: 0,
          motorBrand: 'CentriPro',
        }),
      /Static/
    );
    assert.equal(recommendedWireSize(3, 80), '8 AWG');
  });
});
