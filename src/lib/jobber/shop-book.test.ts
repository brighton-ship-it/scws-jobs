import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIR_ROTARY_FOOTAGE_PRICE,
  BT2_LABOR_PRICE,
  SANITARY_SEAL_QTY,
  SANITARY_SEAL_TOTAL,
  SANITARY_SEAL_UNIT_PRICE,
  TRAVEL_LINE_NAME,
  WATER_DELIVERY_NAME,
  assertShopBookLines,
  buildAirRotaryLines,
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
    const replaceMsg = customerMessageForTechNote('replace', 'Franklin');
    assert.equal(mentionsServiceCallCredit(evalMsg), false);
    assert.equal(mentionsServiceCallCredit(replaceMsg), false);
    assert.equal(mentionsServiceCallCredit('credit the $200 service call'), true);
  });

  it('infers replace vs pull-and-eval from tech notes', () => {
    assert.equal(inferTechNoteKind('pump seized, evaluate'), 'pull_and_eval');
    assert.equal(inferTechNoteKind('replace 2hp motor'), 'replace');
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
