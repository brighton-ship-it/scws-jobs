/**
 * Internal 60% GP flags for unsent Jobber drafts.
 * Sell prices stay street. Never auto-raise. Never invent a cost.
 *
 * GP = (street − cost) / street. Flag only when GP is strictly under 60%.
 *
 * True cost priority:
 *   1. line unitCost when > 0
 *   2. Jobber product internalUnitCost when > 0
 *   3. vendor net already stored in this repo
 *   4. catalog book (Jobber defaultUnitCost) only when it is NOT the sell price
 *
 * Jobber defaultUnitCost that equals the sell price is catalog list, not cost.
 * Rotary $/ft internal $0 — cannot score. Labor lumps without hours — skip.
 */

import {
  AIR_ROTARY_FOOTAGE_NAME,
  AIR_ROTARY_FOOTAGE_PRICE,
  BT2_LABOR_NAME,
  HOIST_NAME,
  MUD_ROTARY_FOOTAGE_NAME,
  MUD_ROTARY_FOOTAGE_PRICE,
  TANK_SWAP_LABOR_NAME,
  type QuoteLineDraft,
} from './shop-book.ts';

export const TARGET_GROSS_PROFIT = 0.6;

/** Invented 60% rotary / raised-street numbers that must never appear as sell prices. */
export const FORBIDDEN_SIXTY_PRICES = [95, 137.5, 1541, 10738] as const;

export type CostSource = 'line' | 'internal' | 'vendor_net' | 'catalog_book';

export type JobberProductCost = {
  name?: string | null;
  sku?: string | null;
  internalUnitCost?: number | null;
  defaultUnitCost?: number | null;
};

export type TrueCostEntry = {
  sku: string;
  match: RegExp;
  /** Jobber internalUnitCost / vendor net when a true cost is stored. */
  internalUnitCost: number | null;
  /** Catalog book (defaultUnitCost) used only when it is not the sell price. */
  catalogBookCost: number | null;
  kind: 'product' | 'labor_lump' | 'rotary_footage' | 'service_call';
};

export type ResolvedCost = {
  cost: number;
  source: CostSource;
  sku: string;
};

export type GpFlag = {
  text: string;
  sku: string;
  street: number;
  cost: number | null;
  gp: number | null;
  sixtyStreet: number | null;
  kind: 'under_target' | 'cannot_score';
};

export const TRUE_COSTS: TrueCostEntry[] = [
  {
    sku: '1MS',
    match: /\b1ms\b/i,
    internalUnitCost: 80,
    catalogBookCost: null,
    kind: 'service_call',
  },
  {
    sku: 'PM260',
    match: /\bpm\s*-?\s*260\b|promax\s+pm260/i,
    internalUnitCost: 616.5,
    catalogBookCost: null,
    kind: 'product',
  },
  {
    sku: '10GS20',
    match: /\b10gs20\b/i,
    internalUnitCost: 849.6,
    catalogBookCost: null,
    kind: 'product',
  },
  {
    sku: 'HSC20',
    match: /\bhsc20\b/i,
    internalUnitCost: 2400,
    catalogBookCost: 2400,
    kind: 'product',
  },
  {
    sku: '42043',
    match: /\b42043\b/i,
    // Jobber internalUnitCost is $0. Catalog book $4,295 is not the street sell.
    internalUnitCost: null,
    catalogBookCost: 4295,
    kind: 'product',
  },
];

const LABOR_LUMP_RE = new RegExp(
  `^(${escapeRe(BT2_LABOR_NAME)}|${escapeRe(TANK_SWAP_LABOR_NAME)}|${escapeRe(HOIST_NAME)})$`,
  'i'
);

export function formatMoney(amount: number): string {
  if (Number.isInteger(amount)) return `$${amount}`;
  const cents = Math.round(amount * 100) / 100;
  return Number.isInteger(cents) ? `$${cents}` : `$${cents.toFixed(2)}`;
}

export function impliedGrossProfit(street: number, cost: number): number {
  if (!(street > 0)) return Number.NaN;
  return (street - cost) / street;
}

export function streetForSixtyGp(cost: number): number {
  return Math.round(cost / (1 - TARGET_GROSS_PROFIT));
}

export function matchTrueCostEntry(line: QuoteLineDraft): TrueCostEntry | null {
  const hay = `${line.sku || ''} ${line.name} ${line.description || ''}`;
  return TRUE_COSTS.find((entry) => entry.match.test(hay)) ?? null;
}

export function isLaborLumpWithoutHours(line: QuoteLineDraft): boolean {
  if (line.sku === 'BT2' || LABOR_LUMP_RE.test(line.name)) return true;
  return /bt2|tank swap labor|^hoist$/i.test(line.name) && line.quantity === 1;
}

export function isRotaryFootageLine(line: QuoteLineDraft): boolean {
  return (
    line.name === AIR_ROTARY_FOOTAGE_NAME ||
    line.name === MUD_ROTARY_FOOTAGE_NAME ||
    /air rotary|mud rotary/i.test(line.name)
  );
}

export function resolveTrueCost(
  line: QuoteLineDraft,
  products: JobberProductCost[] = []
): ResolvedCost | null {
  if (isLaborLumpWithoutHours(line)) {
    return null;
  }

  const catalog = matchTrueCostEntry(line);
  const product = findProductCost(line, products, catalog);

  if (line.unitCost != null && line.unitCost > 0) {
    return { cost: line.unitCost, source: 'line', sku: catalog?.sku || line.sku || line.name };
  }

  if (product?.internalUnitCost != null && product.internalUnitCost > 0) {
    return {
      cost: product.internalUnitCost,
      source: 'internal',
      sku: catalog?.sku || product.sku || line.sku || line.name,
    };
  }

  if (catalog?.internalUnitCost != null && catalog.internalUnitCost > 0) {
    return { cost: catalog.internalUnitCost, source: 'vendor_net', sku: catalog.sku };
  }

  const book = product?.defaultUnitCost ?? catalog?.catalogBookCost ?? null;
  if (book != null && book > 0 && book !== line.unitPrice) {
    return {
      cost: book,
      source: 'catalog_book',
      sku: catalog?.sku || product?.sku || line.sku || line.name,
    };
  }

  return null;
}

export function scoreLineGrossProfit(
  line: QuoteLineDraft,
  products: JobberProductCost[] = []
): GpFlag | null {
  if (!(line.unitPrice > 0)) return null;

  if (isRotaryFootageLine(line)) {
    return cannotScoreFlag(rotarySku(line), line.unitPrice);
  }

  if (isLaborLumpWithoutHours(line)) {
    return null;
  }

  const resolved = resolveTrueCost(line, products);
  if (!resolved) {
    return null;
  }

  const gp = impliedGrossProfit(line.unitPrice, resolved.cost);
  if (!Number.isFinite(gp) || gp >= TARGET_GROSS_PROFIT) {
    return null;
  }

  const sixtyStreet = streetForSixtyGp(resolved.cost);
  const gpPct = Math.round(gp * 100);
  return {
    text: `FLAG ${resolved.sku} street ${formatMoney(line.unitPrice)} vs cost ${formatMoney(resolved.cost)} = ${gpPct}% GP (60% would be ${formatMoney(sixtyStreet)} — not applied)`,
    sku: resolved.sku,
    street: line.unitPrice,
    cost: resolved.cost,
    gp,
    sixtyStreet,
    kind: 'under_target',
  };
}

export function scoreGrossProfit(
  lines: QuoteLineDraft[],
  products: JobberProductCost[] = []
): { flags: GpFlag[]; texts: string[]; internalNote: string | null } {
  const flags = lines
    .map((line) => scoreLineGrossProfit(line, products))
    .filter((flag): flag is GpFlag => Boolean(flag));
  const texts = flags.map((flag) => flag.text);
  return {
    flags,
    texts,
    internalNote: texts.length ? texts.join('\n') : null,
  };
}

export function officeTitleWithGpFlags(title: string, flags: GpFlag[]): string {
  if (!flags.length) return title;
  if (/FLAG under 60% GP/i.test(title)) return title;
  return `${title} — FLAG under 60% GP`;
}

export function mentionsGpFlag(text: string | null | undefined): boolean {
  if (!text) return false;
  return (
    /\bFLAG\b/.test(text) ||
    /\b\d{1,3}%\s*GP\b/i.test(text) ||
    /60%\s+would\s+be/i.test(text) ||
    /cannot score 60%/i.test(text)
  );
}

export function assertNoInventedSixtyPrices(lines: QuoteLineDraft[]): void {
  for (const line of lines) {
    if ((FORBIDDEN_SIXTY_PRICES as readonly number[]).includes(line.unitPrice)) {
      throw new Error(
        `Street book must not emit 60% raised price ${line.unitPrice} on ${line.name}`
      );
    }
    if (/42043/i.test(line.name) && line.unitPrice === 4295) {
      throw new Error('42043 must sell street (~$5998), not catalog book $4295');
    }
    if (isRotaryFootageLine(line)) {
      if (line.name.includes('Air') && line.unitPrice !== AIR_ROTARY_FOOTAGE_PRICE) {
        throw new Error('Air rotary must stay $45/ft street');
      }
      if (line.name.includes('Mud') && line.unitPrice !== MUD_ROTARY_FOOTAGE_PRICE) {
        throw new Error('Mud rotary must stay $70/ft street');
      }
    }
  }
}

export function assertCustomerMessageHasNoGp(message: string): void {
  if (mentionsGpFlag(message)) {
    throw new Error('Customer-facing quote message must not contain GP FLAG math');
  }
}

function cannotScoreFlag(sku: string, street: number): GpFlag {
  return {
    text: `FLAG ${sku} cannot score 60% — no true cost stored.`,
    sku,
    street,
    cost: null,
    gp: null,
    sixtyStreet: null,
    kind: 'cannot_score',
  };
}

function rotarySku(line: QuoteLineDraft): string {
  if (/mud/i.test(line.name)) return 'mud rotary $/ft';
  return 'air rotary $/ft';
}

function findProductCost(
  line: QuoteLineDraft,
  products: JobberProductCost[],
  catalog: TrueCostEntry | null
): JobberProductCost | null {
  if (!products.length) return null;
  const hay = `${line.sku || ''} ${line.name}`.toLowerCase();
  return (
    products.find((product) => {
      const sku = (product.sku || '').toLowerCase();
      const name = (product.name || '').toLowerCase();
      if (catalog && (sku === catalog.sku.toLowerCase() || name.includes(catalog.sku.toLowerCase()))) {
        return true;
      }
      if (line.sku && (sku === line.sku.toLowerCase() || name.includes(line.sku.toLowerCase()))) {
        return true;
      }
      return Boolean(name && hay.includes(name));
    }) ?? null
  );
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
