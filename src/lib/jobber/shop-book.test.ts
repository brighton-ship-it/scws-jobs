import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIR_ROTARY_FOOTAGE_PRICE,
  BT2_LABOR_PRICE,
  HOIST_NAME,
  PLUMBING_PACKAGE_PRICE,
  PROMAX_PM260_PRICE,
  SANITARY_SEAL_QTY,
  SANITARY_SEAL_TOTAL,
  SANITARY_SEAL_UNIT_PRICE,
  TANK_SWAP_LABOR_PRICE,
  TRAVEL_LINE_NAME,
  WATER_DELIVERY_NAME,
  assertShopBookLines,
  buildAirRotaryLines,
  buildPressureTankLines,
  buildPullAndEvalLines,
  customerMessageForAirRotary,
  customerMessageForTechNote,
  inferTechNoteKind,
  mentionsServiceCallCredit,
  sanitarySealIsLump,
} from './shop-book.ts';

describe('pull-and-eval shop book', () => {
  it('quotes BT2 labor at $600 non-taxable', () => {
    const [labor] = buildPullAndEvalLines();
    assert.equal(labor.name, 'BT2');
    assert.equal(labor.unitPrice, BT2_LABOR_PRICE);
    assert.equal(labor.taxable, false);
    assert.equal(labor.description, 'Pull well pump and evaluate');
  });

  it('customer message never mentions the $200 service call', () => {
    const evalMsg = customerMessageForTechNote('pull_and_eval');
    const replaceMsg = customerMessageForTechNote('replace', { motorBrand: 'Franklin' });
    const tankMsg = customerMessageForTechNote('pressure_tank');
    assert.equal(mentionsServiceCallCredit(evalMsg), false);
    assert.equal(mentionsServiceCallCredit(replaceMsg), false);
    assert.equal(mentionsServiceCallCredit(tankMsg), false);
    assert.equal(mentionsServiceCallCredit('credit the $200 service call'), true);
  });

  it('does not treat tank-swap labor copy as a service-call credit', () => {
    assert.equal(mentionsServiceCallCredit('Tank swap labor at street'), false);
  });

  it('only infers pull-and-eval from explicit pull/eval language', () => {
    assert.equal(inferTechNoteKind('pump seized, evaluate'), 'unclear');
    assert.equal(inferTechNoteKind('replace 2hp motor'), 'replace');
    assert.equal(inferTechNoteKind('pull and eval'), 'pull_and_eval');
  });
});

describe('pressure tank shop book', () => {
  it('quotes PM260 $1370 + plumbing $125 + tank-swap labor $200 and omits hoist', () => {
    const lines = buildPressureTankLines();
    assert.equal(lines.find((line) => line.name.includes('PM260'))?.unitPrice, PROMAX_PM260_PRICE);
    assert.equal(lines.find((line) => line.name.includes('Plumbing'))?.unitPrice, PLUMBING_PACKAGE_PRICE);
    assert.equal(lines.find((line) => line.name.includes('Tank swap'))?.unitPrice, TANK_SWAP_LABOR_PRICE);
    assert.ok(!lines.some((line) => line.name === HOIST_NAME));
    assert.ok(!lines.some((line) => line.name === 'BT2'));
  });
});

describe('air rotary shop book', () => {
  it('uses $48/ft street and sanitary seal qty 20 × $220', () => {
    const lines = buildAirRotaryLines({ footageFt: 420, includeWaterDelivery: true });
    const footage = lines.find((line) => line.name.includes('Air Rotary'));
    const seal = lines.find((line) => line.name.includes('Sanitary Seal'));
    assert.equal(footage?.unitPrice, AIR_ROTARY_FOOTAGE_PRICE);
    assert.equal(footage?.quantity, 420);
    assert.equal(seal?.quantity, SANITARY_SEAL_QTY);
    assert.equal(seal?.unitPrice, SANITARY_SEAL_UNIT_PRICE);
    assert.equal((seal?.quantity || 0) * (seal?.unitPrice || 0), SANITARY_SEAL_TOTAL);
    assert.equal(sanitarySealIsLump(seal!), false);
  });

  it('rejects a qty-1 sanitary seal lump', () => {
    assert.throws(
      () =>
        assertShopBookLines([
          { name: '8" Sanitary Seal', quantity: 1, unitPrice: 4400, taxable: true },
        ]),
      /qty 20/
    );
  });

  it('includes SD water delivery and travel only when asked', () => {
    const withWater = buildAirRotaryLines({
      footageFt: 400,
      includeWaterDelivery: true,
      travelDays: 0,
    });
    assert.ok(withWater.some((line) => line.name === WATER_DELIVERY_NAME));
    assert.ok(!withWater.some((line) => line.name === TRAVEL_LINE_NAME));

    const withTravel = buildAirRotaryLines({
      footageFt: 400,
      includeWaterDelivery: false,
      travelDays: 1,
    });
    const travel = withTravel.find((line) => line.name === TRAVEL_LINE_NAME);
    assert.equal(travel?.unitPrice, 500);
    assert.ok(!withTravel.some((line) => line.name === WATER_DELIVERY_NAME));
  });

  it('refuses to invent footage', () => {
    assert.throws(() => buildAirRotaryLines({ footageFt: 0, includeWaterDelivery: false }), /DWR/);
  });

  it('mentions air rotary and DWR in the customer message', () => {
    const message = customerMessageForAirRotary(430);
    assert.match(message, /430-foot air rotary/);
    assert.match(message, /DWR/);
    assert.equal(mentionsServiceCallCredit(message), false);
  });
});
