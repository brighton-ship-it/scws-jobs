import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORBIDDEN_SIXTY_PRICES,
  assertNoInventedSixtyPrices,
  formatMoney,
  impliedGrossProfit,
  mentionsGpFlag,
  officeTitleWithGpFlags,
  scoreGrossProfit,
  scoreLineGrossProfit,
  streetForSixtyGp,
} from './gross-profit.ts';
import {
  AIR_ROTARY_FOOTAGE_NAME,
  AIR_ROTARY_FOOTAGE_PRICE,
  BT2_LABOR_NAME,
  HOUSE_TANK_NAME,
  HOUSE_TANK_STREET_PRICE,
  MUD_ROTARY_FOOTAGE_NAME,
  MUD_ROTARY_FOOTAGE_PRICE,
  PROMAX_PM260_NAME,
  PROMAX_PM260_PRICE,
  TANK_SWAP_LABOR_NAME,
  buildHouseTankLines,
  buildPressureTankLines,
  type QuoteLineDraft,
} from './shop-book.ts';

describe('gross profit scoring', () => {
  it('flags PM260 at street $1370 vs true cost $616.50 as 55% and does not raise to $1541', () => {
    const [tank] = buildPressureTankLines();
    const flag = scoreLineGrossProfit(tank);
    assert.ok(flag);
    assert.equal(flag.kind, 'under_target');
    assert.equal(tank.unitPrice, PROMAX_PM260_PRICE);
    assert.equal(flag.street, 1370);
    assert.equal(flag.cost, 616.5);
    assert.equal(Math.round((flag.gp || 0) * 100), 55);
    assert.equal(flag.sixtyStreet, 1541);
    assert.match(flag.text, /FLAG PM260 street \$1370 vs cost \$616\.50 = 55% GP/);
    assert.match(flag.text, /60% would be \$1541 — not applied/);
    assert.ok(!buildPressureTankLines().some((line) => line.unitPrice === 1541));
  });

  it('flags 42043 at street $5998 vs catalog book $4295 as 28% and never sells $4295 or $10738', () => {
    const [tank] = buildHouseTankLines();
    assert.equal(tank.unitPrice, HOUSE_TANK_STREET_PRICE);
    assert.equal(tank.name, HOUSE_TANK_NAME);
    const flag = scoreLineGrossProfit(tank);
    assert.ok(flag);
    assert.equal(flag.sku, '42043');
    assert.equal(flag.street, 5998);
    assert.equal(flag.cost, 4295);
    assert.equal(Math.round((flag.gp || 0) * 100), 28);
    assert.equal(flag.sixtyStreet, 10738);
    assert.match(flag.text, /FLAG 42043 street \$5998 vs cost \$4295 = 28% GP/);
    assert.match(flag.text, /60% would be \$10738 — not applied/);
    assert.notEqual(tank.unitPrice, 4295);
    assert.notEqual(tank.unitPrice, 10738);
  });

  it('does not flag a $200 1MS call when internal $80 holds 60%', () => {
    const line: QuoteLineDraft = {
      name: '1MS',
      sku: '1MS',
      quantity: 1,
      unitPrice: 200,
      taxable: false,
    };
    const gp = impliedGrossProfit(200, 80);
    assert.equal(gp, 0.6);
    assert.equal(scoreLineGrossProfit(line), null);
  });

  it('does not invent a cost for BT2 / tank-swap labor lumps', () => {
    assert.equal(
      scoreLineGrossProfit({
        name: BT2_LABOR_NAME,
        quantity: 1,
        unitPrice: 600,
        taxable: false,
      }),
      null
    );
    assert.equal(
      scoreLineGrossProfit({
        name: TANK_SWAP_LABOR_NAME,
        quantity: 1,
        unitPrice: 200,
        taxable: false,
      }),
      null
    );
  });

  it('cannot-scores rotary footage and never emits $95 or $137.50', () => {
    const air = scoreLineGrossProfit({
      name: AIR_ROTARY_FOOTAGE_NAME,
      quantity: 400,
      unitPrice: AIR_ROTARY_FOOTAGE_PRICE,
      taxable: true,
    });
    const mud = scoreLineGrossProfit({
      name: MUD_ROTARY_FOOTAGE_NAME,
      quantity: 300,
      unitPrice: MUD_ROTARY_FOOTAGE_PRICE,
      taxable: true,
    });
    assert.equal(air?.kind, 'cannot_score');
    assert.equal(mud?.kind, 'cannot_score');
    assert.match(air?.text || '', /cannot score 60% — no true cost stored/);
    assert.ok(!/95|137\.50/.test(air?.text || ''));
    assert.ok(!/95|137\.50/.test(mud?.text || ''));
    assert.equal(AIR_ROTARY_FOOTAGE_PRICE, 45);
    assert.equal(MUD_ROTARY_FOOTAGE_PRICE, 70);
  });

  it('does not treat Jobber defaultUnitCost as cost when it equals the sell price', () => {
    const flag = scoreLineGrossProfit(
      {
        name: PROMAX_PM260_NAME,
        sku: 'PM260',
        quantity: 1,
        unitPrice: 1370,
        taxable: true,
      },
      [{ name: 'Promax PM260', internalUnitCost: 0, defaultUnitCost: 1370 }]
    );
    // Repo vendor net $616.50 still scores — catalog list $1370 is ignored.
    assert.equal(flag?.cost, 616.5);
  });

  it('uses Jobber internalUnitCost when it is a true stored cost', () => {
    const flag = scoreLineGrossProfit(
      {
        name: '10GS20 Goulds end',
        sku: '10GS20',
        quantity: 1,
        unitPrice: 1888,
        taxable: true,
      },
      [{ name: '10GS20', sku: '10GS20', internalUnitCost: 849.6, defaultUnitCost: 1888 }]
    );
    assert.equal(flag?.cost, 849.6);
    assert.equal(Math.round((flag?.gp || 0) * 100), 55);
    assert.notEqual(flag?.sixtyStreet, 1888);
  });

  it('flags HSC20 at street $4719 vs book/cost $2400 as 49%', () => {
    const flag = scoreLineGrossProfit({
      name: 'HSC20',
      sku: 'HSC20',
      quantity: 1,
      unitPrice: 4719,
      taxable: true,
    });
    assert.equal(flag?.cost, 2400);
    assert.equal(Math.round((flag?.gp || 0) * 100), 49);
    assert.match(flag?.text || '', /FLAG HSC20 street \$4719 vs cost \$2400 = 49% GP/);
  });

  it('keeps FLAG text off the customer message and on the office title suffix', () => {
    const { flags, internalNote } = scoreGrossProfit(buildPressureTankLines());
    const customer = 'Proposal to replace the pressure tank with an 86-gallon Promax PM260.';
    assert.equal(mentionsGpFlag(customer), false);
    assert.ok(internalNote && mentionsGpFlag(internalNote));
    assert.match(officeTitleWithGpFlags('Replace pressure tank (job 3266)', flags), /FLAG under 60% GP/);
  });

  it('rejects invented 60% street numbers on quote lines', () => {
    for (const price of FORBIDDEN_SIXTY_PRICES) {
      assert.throws(
        () =>
          assertNoInventedSixtyPrices([
            { name: 'raised', quantity: 1, unitPrice: price, taxable: true },
          ]),
        /60% raised/
      );
    }
    assert.throws(
      () =>
        assertNoInventedSixtyPrices([
          { name: HOUSE_TANK_NAME, quantity: 1, unitPrice: 4295, taxable: true },
        ]),
      /catalog book/
    );
  });

  it('rounds 60% street from book cost the way Brighton wrote it', () => {
    assert.equal(streetForSixtyGp(4295), 10738);
    assert.equal(streetForSixtyGp(616.5), 1541);
    assert.equal(formatMoney(616.5), '$616.50');
    assert.equal(formatMoney(5998), '$5998');
  });
});
