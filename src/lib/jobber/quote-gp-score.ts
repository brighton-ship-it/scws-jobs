/**
 * Quote-level GP for the internal tracker.
 *
 * Reuses the unsent-draft FLAG costing path (resolveTrueCost / scoreGrossProfit).
 * Does not invent mud $95/ft, tank $10,738, or any other 60% raised street.
 * Street prices stay street. Missing cost is unknown — never a guess.
 *
 * Labor lumps without hours are skipped (same as FLAG). Rotary footage
 * cannot score. Quote GP is only known when every priced, non-labor line
 * has a true cost.
 */

import {
  FORBIDDEN_SIXTY_PRICES,
  TARGET_GROSS_PROFIT,
  impliedGrossProfit,
  isLaborLumpWithoutHours,
  isRotaryFootageLine,
  resolveTrueCost,
  scoreGrossProfit,
  type GpFlag,
  type JobberProductCost,
} from './gross-profit.ts';
import type { QuoteLineDraft } from './shop-book.ts';

export type QuoteCostStatus = 'full' | 'partial' | 'unknown';

export type QuoteGpScore = {
  sell: number;
  estimatedCost: number | null;
  gpDollars: number | null;
  /** 0–100 when known. Null when any costable line is unknown. */
  gpPercent: number | null;
  /** Quote-level GP known and strictly under 60%. */
  underTarget: boolean;
  /**
   * True when this quote should appear on the under-60% filter:
   * known quote GP < 60%, or any line FLAG under_target (same as draft FLAG).
   */
  flaggedUnder60: boolean;
  /** GP $ short of 60% on the sell we can score. Null when GP is unknown. */
  missingMarginDollars: number | null;
  costStatus: QuoteCostStatus;
  flags: GpFlag[];
  unknownLineCount: number;
  costedLineCount: number;
};

export function lineSell(line: QuoteLineDraft): number {
  return (Number(line.unitPrice) || 0) * (Number(line.quantity) || 0);
}

export function missingMarginToTarget(sell: number, cost: number): number {
  if (!(sell > 0)) return 0;
  const gpDollars = sell - cost;
  return TARGET_GROSS_PROFIT * sell - gpDollars;
}

/**
 * Score one Jobber quote with the same cost priority as draft FLAGs.
 * `subtotal` is Jobber amounts.subtotal when present (street sell, pre-tax).
 */
export function scoreQuoteGrossProfit(
  lines: QuoteLineDraft[],
  products: JobberProductCost[] = [],
  subtotal?: number | null
): QuoteGpScore {
  const flags = scoreGrossProfit(lines, products).flags;
  let sellFromLines = 0;
  let estimatedCost = 0;
  let costedLineCount = 0;
  let unknownLineCount = 0;

  for (const line of lines) {
    sellFromLines += lineSell(line);
    if (!(line.unitPrice > 0)) continue;

    if (isLaborLumpWithoutHours(line)) {
      continue;
    }

    if (isRotaryFootageLine(line)) {
      unknownLineCount += 1;
      continue;
    }

    const resolved = resolveTrueCost(line, products);
    if (!resolved) {
      unknownLineCount += 1;
      continue;
    }

    if ((FORBIDDEN_SIXTY_PRICES as readonly number[]).includes(resolved.cost)) {
      // Never treat an invented 60% street number as a cost.
      unknownLineCount += 1;
      continue;
    }

    estimatedCost += resolved.cost * (Number(line.quantity) || 0);
    costedLineCount += 1;
  }

  const sell = subtotal != null && subtotal > 0 ? subtotal : sellFromLines;
  const hasLineUnderTarget = flags.some((flag) => flag.kind === 'under_target');

  if (costedLineCount === 0) {
    return {
      sell,
      estimatedCost: null,
      gpDollars: null,
      gpPercent: null,
      underTarget: false,
      flaggedUnder60: hasLineUnderTarget,
      missingMarginDollars: null,
      costStatus: 'unknown',
      flags,
      unknownLineCount,
      costedLineCount,
    };
  }

  if (unknownLineCount > 0) {
    return {
      sell,
      estimatedCost,
      gpDollars: null,
      gpPercent: null,
      underTarget: false,
      flaggedUnder60: hasLineUnderTarget,
      missingMarginDollars: null,
      costStatus: 'partial',
      flags,
      unknownLineCount,
      costedLineCount,
    };
  }

  if (!(sell > 0)) {
    return {
      sell,
      estimatedCost,
      gpDollars: null,
      gpPercent: null,
      underTarget: false,
      flaggedUnder60: hasLineUnderTarget,
      missingMarginDollars: null,
      costStatus: 'unknown',
      flags,
      unknownLineCount,
      costedLineCount,
    };
  }

  const gpRatio = impliedGrossProfit(sell, estimatedCost);
  const gpDollars = sell - estimatedCost;
  const gpPercent = gpRatio * 100;
  const underTarget = Number.isFinite(gpRatio) && gpRatio < TARGET_GROSS_PROFIT;
  const short = missingMarginToTarget(sell, estimatedCost);

  return {
    sell,
    estimatedCost,
    gpDollars,
    gpPercent,
    underTarget,
    flaggedUnder60: underTarget || hasLineUnderTarget,
    missingMarginDollars: underTarget ? Math.max(0, short) : 0,
    costStatus: 'full',
    flags,
    unknownLineCount,
    costedLineCount,
  };
}

export type QuoteGpSummary = {
  loaded: number;
  under60Count: number;
  under60Sell: number;
  scoredCount: number;
  scoredSell: number;
  scoredCost: number;
  overallGpPercent: number | null;
  unknownCount: number;
};

export function summarizeQuoteGpScores(
  scores: Array<Pick<
    QuoteGpScore,
    | 'sell'
    | 'estimatedCost'
    | 'flaggedUnder60'
    | 'costStatus'
    | 'gpPercent'
  >>
): QuoteGpSummary {
  let under60Count = 0;
  let under60Sell = 0;
  let scoredCount = 0;
  let scoredSell = 0;
  let scoredCost = 0;
  let unknownCount = 0;

  for (const score of scores) {
    if (score.flaggedUnder60) {
      under60Count += 1;
      under60Sell += score.sell;
    }
    if (score.costStatus === 'full' && score.estimatedCost != null && score.gpPercent != null) {
      scoredCount += 1;
      scoredSell += score.sell;
      scoredCost += score.estimatedCost;
    } else if (score.costStatus === 'unknown') {
      unknownCount += 1;
    }
  }

  const overallGpPercent =
    scoredSell > 0 ? impliedGrossProfit(scoredSell, scoredCost) * 100 : null;

  return {
    loaded: scores.length,
    under60Count,
    under60Sell,
    scoredCount,
    scoredSell,
    scoredCost,
    overallGpPercent,
    unknownCount,
  };
}
