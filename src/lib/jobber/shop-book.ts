/**
 * SCWS street book for Jobber draft quotes.
 * Street book from 1,307 Jobber quotes + 248 tech notes.
 * Air ~$45/ft (Braman 4243 sold $48). Mud $70/ft. Seal always qty 20 × $220.
 */

export const PULL_AND_EVAL_TITLE = 'Pull well pump and evaluate';
export const REPLACE_TITLE = 'Pull well pump and replace';
export const PRESSURE_TANK_TITLE = 'Replace pressure tank';
export const HOUSE_TANK_TITLE = 'Replace house tank';
export const HOUSE_TANK_SKU = '42043';
export const HOUSE_TANK_NAME = '42043 5,000-gal poly house tank';
/** Street median from the sold Jobber book. Never catalog $4,295 or 60% $10,738. */
export const HOUSE_TANK_STREET_PRICE = 5998;
export const CONTROLS_TITLE = 'Well controls';
export const ELECTRICAL_TITLE = 'Electrical repair';
export const AIR_ROTARY_TITLE = 'Air rotary new well';
export const MUD_ROTARY_TITLE = 'Mud rotary new well';

export const PROMAX_PM260_NAME = '86-gal Promax PM260';
export const PROMAX_PM260_PRICE = 1370;
export const PLUMBING_PACKAGE_NAME = 'Plumbing package';
export const PLUMBING_PACKAGE_PRICE = 125;
export const TANK_SWAP_LABOR_NAME = 'Tank swap labor';
export const TANK_SWAP_LABOR_PRICE = 200;
export const HOIST_NAME = 'Hoist';

export const BT2_LABOR_NAME = 'BT2';
/** Near-shop band (Ramona / Aguanga / Anza / Menifee / Valley Center / Winchester). */
export const BT2_LABOR_PRICE = 600;
/** Lakeside / El Cajon / Poway / Alpine / Rancho Santa Fe — $800 is the mode. */
export const BT2_LABOR_PRICE_MODE = 800;
export const BT2_LABOR_PRICE_FAR = 1000;
export const BT2_LABOR_PRICE_HARD = 1200;
export const BT2_LABOR_TAXABLE = false;

export const SET_ONLY_HOIST_NEAR = 600;
export const SET_ONLY_HOIST_MODE = 800;
export const PULL_SET_HOIST_NEAR = 1000;
export const PULL_SET_HOIST_MODE = 1200;
export const PULL_SET_HOIST_FAR = 1400;

export const GOULDS_GS_END_NAME = 'Goulds GS end';
export const CENTRIPRO_MOTOR_NAME = 'CentriPro / Goulds CP motor';

/** Street air rotary (~$45/ft). Braman quote 4243 sold $48. */
export const AIR_ROTARY_FOOTAGE_NAME = '7-7/8" Air Rotary with 4.5" SDR17 PVC';
export const AIR_ROTARY_FOOTAGE_PRICE = 45;

export const MUD_ROTARY_FOOTAGE_NAME = 'Mud Rotary with 4.5" SDR17 PVC';
export const MUD_ROTARY_FOOTAGE_PRICE = 70;

export const SANITARY_SEAL_NAME = '8" Sanitary Seal';
export const SANITARY_SEAL_UNIT_PRICE = 220;
export const SANITARY_SEAL_QTY = 20;
export const SANITARY_SEAL_TOTAL = SANITARY_SEAL_UNIT_PRICE * SANITARY_SEAL_QTY;

export const MOBILIZATION_NAME = 'Mobilization';
export const MOBILIZATION_PRICE = 2500;

export const BIT_NAME = 'Bit';
export const BIT_PRICE = 1000;

export const GRAVEL_PACK_NAME = 'Gravel Pack';
export const GRAVEL_PACK_PRICE = 12;

export const WELL_PERMIT_NAME = 'Well Drilling Permit';
export const WELL_PERMIT_PRICE = 2500;

export const WATER_DELIVERY_NAME = 'Water Delivery';
export const WATER_DELIVERY_PRICE = 500;

export const TRAVEL_LINE_NAME = 'Travel and Peridium';
export const TRAVEL_PER_DAY = 500;
export const TRAVEL_MIN_HOURS = 1.5;

export type QuoteLineDraft = {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  taxable: boolean;
  /** SKU used for internal GP scoring only — not sent to Jobber. */
  sku?: string;
  /** Line-level true cost when already known. Never invent this. */
  unitCost?: number;
};

const BT2_NEAR_CITIES = new Set([
  'ramona',
  'aguanga',
  'anza',
  'menifee',
  'valley center',
  'winchester',
]);

const BT2_MODE_CITIES = new Set([
  'lakeside',
  'el cajon',
  'poway',
  'alpine',
  'rancho santa fe',
]);

const BT2_FAR_CITIES = new Set([
  'julian',
  'pine valley',
  'palomar',
  'palomar mountain',
  'warner springs',
  'santa ysabel',
  'ranchita',
  'idyllwild',
  'mountain center',
]);

const BT2_HARD_CITIES = new Set([
  'boulevard',
  'jacumba',
  'campo',
  'borrego',
  'borrego springs',
  'desert hot springs',
  'yucca valley',
]);

function normalizeCity(city: string | null | undefined): string {
  return (city || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** BT2 qty-1 lump by city. $800 is the mode. Far/hard only when the city is in that band. */
export function bt2PriceForCity(city?: string | null): number {
  const key = normalizeCity(city);
  if (BT2_NEAR_CITIES.has(key)) return BT2_LABOR_PRICE;
  if (BT2_HARD_CITIES.has(key)) return BT2_LABOR_PRICE_HARD;
  if (BT2_FAR_CITIES.has(key)) return BT2_LABOR_PRICE_FAR;
  return BT2_LABOR_PRICE_MODE;
}

export function hoistPriceForCity(
  city: string | null | undefined,
  mode: 'set-only' | 'pull-set'
): number {
  const bt2 = bt2PriceForCity(city);
  if (mode === 'set-only') {
    return bt2 <= BT2_LABOR_PRICE ? SET_ONLY_HOIST_NEAR : SET_ONLY_HOIST_MODE;
  }
  if (bt2 >= BT2_LABOR_PRICE_HARD) return PULL_SET_HOIST_FAR;
  if (bt2 >= BT2_LABOR_PRICE_FAR) return PULL_SET_HOIST_FAR;
  if (bt2 <= BT2_LABOR_PRICE) return PULL_SET_HOIST_NEAR;
  return PULL_SET_HOIST_MODE;
}

export function gouldsGsLabel(gpm?: number | null, hp?: number | null): string {
  const bits = [
    gpm != null ? `${gpm}GS` : 'GS',
    hp != null ? `${hp}HP` : null,
  ].filter(Boolean);
  return `Goulds ${bits.join(' ')} end`;
}

/** SKU BT2 qty 1 lump (not hours). Price from the city band. */
export function buildPullAndEvalLines(city?: string | null): QuoteLineDraft[] {
  return [
    {
      name: BT2_LABOR_NAME,
      description: PULL_AND_EVAL_TITLE,
      quantity: 1,
      unitPrice: bt2PriceForCity(city),
      taxable: BT2_LABOR_TAXABLE,
    },
  ];
}

export function buildReplaceMotorLine(
  brand: 'Franklin' | 'CentriPro',
  specs?: { hp?: number | null; volts?: number | null; phase?: 1 | 3 | null }
): QuoteLineDraft {
  const bits = [
    specs?.hp != null ? `${specs.hp} HP` : null,
    specs?.volts != null ? `${specs.volts}V` : null,
    specs?.phase === 1 ? '1-phase' : specs?.phase === 3 ? '3-phase' : null,
  ].filter(Boolean);
  const specLabel = bits.length ? ` ${bits.join(' ')}` : '';
  return {
    name: `${brand}${specLabel} submersible motor`,
    description:
      brand === 'Franklin'
        ? 'Franklin motor — only when notes name Franklin/FE. Sold book is CentriPro/Goulds CP (165 CP vs 14 FE).'
        : 'CentriPro / Goulds CP motor — sold book default. HP taken from notes when present; not invented.',
    quantity: 1,
    unitPrice: 0,
    taxable: true,
  };
}

export function buildPumpReplaceLines(input: {
  brand: 'Franklin' | 'CentriPro';
  hp?: number | null;
  volts?: number | null;
  phase?: 1 | 3 | null;
  gpm?: number | null;
  depthFt?: number | null;
  setOnly: boolean;
  city?: string | null;
}): QuoteLineDraft[] {
  const hoistMode = input.setOnly ? 'set-only' : 'pull-set';
  return [
    {
      name: gouldsGsLabel(input.gpm, input.hp),
      description: 'Goulds *GS* end — sold book. GPM/HP taken from notes; not invented.',
      quantity: 1,
      unitPrice: 0,
      taxable: true,
    },
    buildReplaceMotorLine(input.brand, {
      hp: input.hp,
      volts: input.volts,
      phase: input.phase,
    }),
    {
      name: HOIST_NAME,
      description: input.setOnly
        ? 'Set-only hoist — pull already paid ($600–$800 by city)'
        : 'Pull + set hoist ($1000–$1400 by city)',
      quantity: 1,
      unitPrice: hoistPriceForCity(input.city, hoistMode),
      taxable: false,
    },
  ];
}

export function buildControlsLines(notes?: string | null): QuoteLineDraft[] {
  const text = notes || '';
  const lines: QuoteLineDraft[] = [];
  if (/\bcontrol\s+box\b/i.test(text)) {
    lines.push({
      name: 'Control box',
      description: 'Control box with the pump still in the well — not a pull.',
      quantity: 1,
      unitPrice: 0,
      taxable: true,
    });
  }
  if (/\bpressure\s+switch\b|\b40\s*\/\s*60\b/i.test(text)) {
    lines.push({
      name: 'Pressure switch',
      description: 'Pressure switch with the pump still in the well — not a pull.',
      quantity: 1,
      unitPrice: 0,
      taxable: true,
    });
  }
  if (/\bpump\s*saver\b/i.test(text)) {
    lines.push({
      name: 'Pump saver',
      description: 'Pump saver with the pump still in the well — not a pull.',
      quantity: 1,
      unitPrice: 0,
      taxable: true,
    });
  }
  if (lines.length === 0) {
    lines.push({
      name: CONTROLS_TITLE,
      description: 'Well controls with the pump still in the well — not a pull.',
      quantity: 1,
      unitPrice: 0,
      taxable: true,
    });
  }
  return lines;
}

/** 5k poly house tank at sold street. Catalog book $4,295 is cost-only. */
export function buildHouseTankLines(): QuoteLineDraft[] {
  return [
    {
      name: HOUSE_TANK_NAME,
      description: 'Street-book 5,000-gal poly house tank (SKU 42043). Sold at street, not catalog book.',
      quantity: 1,
      unitPrice: HOUSE_TANK_STREET_PRICE,
      taxable: true,
      sku: HOUSE_TANK_SKU,
    },
  ];
}

/** Promax PM260 + plumbing $125 (not $250 book) + labor $200. Never a hoist. */
export function buildPressureTankLines(_input?: { includeHoist?: boolean }): QuoteLineDraft[] {
  return [
    {
      name: PROMAX_PM260_NAME,
      description: 'Shop-book Promax PM260 86-gallon pressure tank',
      quantity: 1,
      unitPrice: PROMAX_PM260_PRICE,
      taxable: true,
      sku: 'PM260',
    },
    {
      name: PLUMBING_PACKAGE_NAME,
      description: 'Tank plumbing package at street ($125, not the $250 book)',
      quantity: 1,
      unitPrice: PLUMBING_PACKAGE_PRICE,
      taxable: true,
    },
    {
      name: TANK_SWAP_LABOR_NAME,
      description: 'Labor to swap the pressure tank. Not a service-call credit.',
      quantity: 1,
      unitPrice: TANK_SWAP_LABOR_PRICE,
      taxable: false,
    },
  ];
}

export function buildAirRotaryLines(input: {
  footageFt: number;
  includeWaterDelivery: boolean;
  travelDays?: number;
  method?: 'air' | 'mud';
}): QuoteLineDraft[] {
  if (!Number.isFinite(input.footageFt) || input.footageFt <= 0) {
    throw new Error('Air rotary footage must be a positive number from DWR');
  }

  const method = input.method ?? 'air';
  const footageName = method === 'mud' ? MUD_ROTARY_FOOTAGE_NAME : AIR_ROTARY_FOOTAGE_NAME;
  const footagePrice = method === 'mud' ? MUD_ROTARY_FOOTAGE_PRICE : AIR_ROTARY_FOOTAGE_PRICE;
  const footageDesc =
    method === 'mud'
      ? 'Per-foot mud rotary drilling with 4.5" SDR17 PVC liner ($70/ft street)'
      : 'Per-foot air rotary drilling with 4.5" SDR17 PVC liner (~$45/ft street)';

  const lines: QuoteLineDraft[] = [
    {
      name: MOBILIZATION_NAME,
      quantity: 1,
      unitPrice: MOBILIZATION_PRICE,
      taxable: true,
    },
    {
      name: footageName,
      description: footageDesc,
      quantity: input.footageFt,
      unitPrice: footagePrice,
      taxable: true,
    },
    {
      name: SANITARY_SEAL_NAME,
      description: '20 ft sanitary seal at street — never a qty-1 lump',
      quantity: SANITARY_SEAL_QTY,
      unitPrice: SANITARY_SEAL_UNIT_PRICE,
      taxable: true,
    },
    {
      name: BIT_NAME,
      quantity: 1,
      unitPrice: BIT_PRICE,
      taxable: true,
    },
    {
      name: GRAVEL_PACK_NAME,
      description: 'Per-foot gravel pack',
      quantity: input.footageFt,
      unitPrice: GRAVEL_PACK_PRICE,
      taxable: true,
    },
    {
      name: WELL_PERMIT_NAME,
      quantity: 1,
      unitPrice: WELL_PERMIT_PRICE,
      taxable: true,
    },
  ];

  if (input.includeWaterDelivery) {
    lines.push({
      name: WATER_DELIVERY_NAME,
      quantity: 1,
      unitPrice: WATER_DELIVERY_PRICE,
      taxable: true,
    });
  }

  const travelDays = input.travelDays ?? 0;
  if (travelDays > 0) {
    lines.push({
      name: TRAVEL_LINE_NAME,
      description: 'Travel / per diem when the hole is more than 1.5 hours from the assigned shop',
      quantity: travelDays,
      unitPrice: TRAVEL_PER_DAY,
      taxable: true,
    });
  }

  return lines;
}

export function sanitarySealIsLump(line: QuoteLineDraft): boolean {
  return (
    /sanitary seal/i.test(line.name) &&
    (line.quantity === 1 || line.unitPrice === SANITARY_SEAL_TOTAL)
  );
}

export function assertShopBookLines(lines: QuoteLineDraft[]): void {
  const seal = lines.find((line) => /sanitary seal/i.test(line.name));
  if (seal && sanitarySealIsLump(seal)) {
    throw new Error('8" sanitary seal must be qty 20 × $220, never a qty-1 lump');
  }
}

const SERVICE_CALL_CREDIT_RE =
  /\bservice call\b|\bcredit\b.{0,24}\$?\s*200\b|\$?\s*200\b.{0,24}\bcredit\b/i;

export function mentionsServiceCallCredit(text: string | null | undefined): boolean {
  return Boolean(text && SERVICE_CALL_CREDIT_RE.test(text));
}

export function customerMessageForTechNote(
  kind:
    | 'pull_and_eval'
    | 'replace'
    | 'pressure_tank'
    | 'house_tank'
    | 'pump_replace'
    | 'electrical'
    | 'controls',
  extras?: {
    motorBrand?: string;
    hp?: number | null;
    volts?: number | null;
    phase?: 1 | 3 | null;
    gpm?: number | null;
    setOnly?: boolean;
  }
): string {
  if (kind === 'house_tank') {
    return 'Proposal to replace the house tank with a 5,000-gallon poly tank.';
  }
  if (kind === 'pressure_tank') {
    return 'Proposal to replace the pressure tank with an 86-gallon Promax PM260, including the plumbing package and tank-swap labor.';
  }
  if (kind === 'pump_replace' || kind === 'replace') {
    const spec = [
      extras?.hp != null ? `${extras.hp} HP` : null,
      extras?.gpm != null ? `${extras.gpm} GPM Goulds GS` : 'Goulds GS',
      extras?.volts != null ? `${extras.volts}V` : null,
      extras?.phase === 1 ? 'single-phase' : extras?.phase === 3 ? 'three-phase' : null,
    ]
      .filter(Boolean)
      .join(' ');
    const brand = extras?.motorBrand || 'CentriPro';
    const set = extras?.setOnly ? 'set-only' : 'pull and set';
    return `Proposal to ${set} a ${spec} end with a ${brand} motor.`;
  }
  if (kind === 'controls' || kind === 'electrical') {
    return 'Proposal for well controls / switch work with the pump still in the well.';
  }
  return 'Proposal to pull the well pump and evaluate the pumping system. Labor is quoted as BT2.';
}

export function customerMessageForAirRotary(footageFt: number): string {
  return [
    `Proposal for drilling a ${footageFt}-foot air rotary water well lined with 4.5-inch SDR17 PVC liner.`,
    'Estimated depth is the rounded median of nearby domestic CA DWR Well Completion Reports.',
    'This estimate pertains exclusively to the well drilling process.',
    'This quote is a draft and has not been sent.',
  ].join(' ');
}

/** @deprecated Use parseTechNoteIntent — never default to pull-and-eval. */
export function inferTechNoteKind(notes: string | null | undefined): 'pull_and_eval' | 'replace' | 'unclear' {
  const text = (notes || '').toLowerCase();
  if (/\bpull\s*(and|&|\/|-)?\s*eval/.test(text) || /\bout of the well\b/.test(text)) {
    return 'pull_and_eval';
  }
  if (/\breplace\w*(?:\s+\w+){0,8}\s+(the )?(pump|motor)\b/.test(text)) {
    return 'replace';
  }
  return 'unclear';
}
