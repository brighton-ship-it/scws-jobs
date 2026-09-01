import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORBIDDEN_SIXTY_PRICES,
  TARGET_GROSS_PROFIT,
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
import {
  missingMarginToTarget,
  scoreQuoteGrossProfit,
  summarizeQuoteGpScores,
} from './quote-gp-score.ts';

describe('scoreQuoteGrossProfit', () => {
  it('scores a pressure-tank book quote under 60% using FLAG vendor net, not $1541', () => {
    const lines = buildPressureTankLines();
    const score = scoreQuoteGrossProfit(lines);
    assert.equal(score.costStatus, 'partial');
    assert.equal(score.gpPercent, null);
    assert.equal(score.underTarget, false);
    assert.equal(score.flaggedUnder60, true);
    assert.ok(score.flags.some((flag) => flag.sku === 'PM260' && flag.kind === 'under_target'));
    assert.equal(score.flags.find((flag) => flag.sku === 'PM260')?.cost, 616.5);
    assert.ok(!lines.some((line) => line.unitPrice === 1541));
    assert.ok(score.flags.every((flag) => !/95|137\.50|10738/.test(flag.text)));
  });

  it('computes full quote GP when every costable line has a true cost', () => {
    const lines: QuoteLineDraft[] = [
      { name: PROMAX_PM260_NAME, sku: 'PM260', quantity: 1, unitPrice: PROMAX_PM260_PRICE, taxable: true },
    ];
    const score = scoreQuoteGrossProfit(lines);
    assert.equal(score.costStatus, 'full');
    assert.equal(score.estimatedCost, 616.5);
    assert.equal(score.sell, 1370);
    assert.equal(Math.round(score.gpPercent || 0), 55);
    assert.equal(score.underTarget, true);
    assert.equal(score.flaggedUnder60, true);
    assert.ok((score.missingMarginDollars || 0) > 0);
    assert.equal(
      Math.round(score.missingMarginDollars || 0),
      Math.round(missingMarginToTarget(1370, 616.5))
    );
  });

  it('flags 42043 street $5998 vs book $4295 as 28% and never uses $10738 as cost', () => {
    const [tank] = buildHouseTankLines();
    assert.equal(tank.unitPrice, HOUSE_TANK_STREET_PRICE);
    const score = scoreQuoteGrossProfit([tank]);
    assert.equal(score.costStatus, 'full');
    assert.equal(score.estimatedCost, 4295);
    assert.equal(Math.round(score.gpPercent || 0), 28);
    assert.equal(score.underTarget, true);
    assert.ok(!(score.estimatedCost != null && (FORBIDDEN_SIXTY_PRICES as readonly number[]).includes(score.estimatedCost)));
    assert.notEqual(tank.name, HOUSE_TANK_NAME + ' $10738');
  });

  it('does not invent a cost for BT2 or tank-swap labor — GP unknown on labor-only', () => {
    const score = scoreQuoteGrossProfit([
      { name: BT2_LABOR_NAME, quantity: 1, unitPrice: 600, taxable: false },
      { name: TANK_SWAP_LABOR_NAME, quantity: 1, unitPrice: 200, taxable: false },
    ]);
    assert.equal(score.costStatus, 'unknown');
    assert.equal(score.estimatedCost, null);
    assert.equal(score.gpPercent, null);
    assert.equal(score.flaggedUnder60, false);
  });

  it('labels rotary footage unknown and never uses $95 or $137.50', () => {
    const score = scoreQuoteGrossProfit([
      {
        name: AIR_ROTARY_FOOTAGE_NAME,
        quantity: 400,
        unitPrice: AIR_ROTARY_FOOTAGE_PRICE,
        taxable: true,
      },
      {
        name: MUD_ROTARY_FOOTAGE_NAME,
        quantity: 300,
        unitPrice: MUD_ROTARY_FOOTAGE_PRICE,
        taxable: true,
      },
    ]);
    assert.equal(score.costStatus, 'unknown');
    assert.equal(score.gpPercent, null);
    assert.ok(score.flags.every((flag) => flag.kind === 'cannot_score'));
    assert.ok(score.flags.every((flag) => !/95|137\.50/.test(flag.text)));
    assert.equal(AIR_ROTARY_FOOTAGE_PRICE, 45);
    assert.equal(MUD_ROTARY_FOOTAGE_PRICE, 70);
  });

  it('uses Jobber line unitCost when present and does not guess plumbing', () => {
    const score = scoreQuoteGrossProfit([
      {
        name: 'Plumbing package',
        quantity: 1,
        unitPrice: 125,
        taxable: true,
        unitCost: 40,
      },
    ]);
    assert.equal(score.costStatus, 'full');
    assert.equal(score.estimatedCost, 40);
    assert.ok((score.gpPercent || 0) >= TARGET_GROSS_PROFIT * 100);
    assert.equal(score.underTarget, false);
  });

  it('keeps a $200 1MS call at 60% — not flagged, not credited to a pump', () => {
    const score = scoreQuoteGrossProfit([
      { name: '1MS', sku: '1MS', quantity: 1, unitPrice: 200, taxable: false },
    ]);
    assert.equal(score.costStatus, 'full');
    assert.equal(score.estimatedCost, 80);
    assert.equal(score.gpPercent, 60);
    assert.equal(score.underTarget, false);
    assert.equal(score.flaggedUnder60, false);
    assert.equal(score.missingMarginDollars, 0);
  });

  it('does not treat catalog list as cost when it equals the sell price', () => {
    const score = scoreQuoteGrossProfit(
      [{ name: PROMAX_PM260_NAME, sku: 'PM260', quantity: 1, unitPrice: 1370, taxable: true }],
      [{ name: 'Promax PM260', internalUnitCost: 0, defaultUnitCost: 1370 }]
    );
    assert.equal(score.estimatedCost, 616.5);
  });
});

describe('summarizeQuoteGpScores', () => {
  it('rolls under-60% count, sell, and overall GP on fully costed quotes only', () => {
    const under = scoreQuoteGrossProfit([
      { name: PROMAX_PM260_NAME, sku: 'PM260', quantity: 1, unitPrice: 1370, taxable: true },
    ]);
    const ok = scoreQuoteGrossProfit([
      { name: '1MS', sku: '1MS', quantity: 1, unitPrice: 200, taxable: false },
    ]);
    const unknown = scoreQuoteGrossProfit([
      { name: AIR_ROTARY_FOOTAGE_NAME, quantity: 100, unitPrice: 45, taxable: true },
    ]);
    const summary = summarizeQuoteGpScores([under, ok, unknown]);
    assert.equal(summary.loaded, 3);
    assert.equal(summary.under60Count, 1);
    assert.equal(summary.under60Sell, 1370);
    assert.equal(summary.scoredCount, 2);
    assert.equal(summary.unknownCount, 1);
    assert.ok(summary.overallGpPercent != null);
    assert.ok(summary.overallGpPercent < 60);
  });
});
