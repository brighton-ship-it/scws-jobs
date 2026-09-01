/**
 * SCWS street book for Jobber draft quotes.
 * Footage / seal prices match Jobber quotes #4238 and #4244.
 */

export const PULL_AND_EVAL_TITLE = 'Pull well pump and evaluate';
export const REPLACE_TITLE = 'Pull well pump and replace';
export const AIR_ROTARY_TITLE = 'Air rotary new well';

export const BT2_LABOR_NAME = 'BT2';
export const BT2_LABOR_PRICE = 600;
export const BT2_LABOR_TAXABLE = false;

export const AIR_ROTARY_FOOTAGE_NAME = '7-7/8" Air Rotary with 4.5" SDR17 PVC';
export const AIR_ROTARY_FOOTAGE_PRICE = 48;

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
};

export function buildPullAndEvalLines(): QuoteLineDraft[] {
  return [
    {
      name: BT2_LABOR_NAME,
      description: PULL_AND_EVAL_TITLE,
      quantity: 1,
      unitPrice: BT2_LABOR_PRICE,
      taxable: BT2_LABOR_TAXABLE,
    },
  ];
}

export function buildReplaceMotorLine(brand: 'Franklin' | 'CentriPro'): QuoteLineDraft {
  return {
    name: `${brand} submersible motor`,
    description:
      brand === 'Franklin'
        ? 'Franklin motor — Ramona shop standard. Confirm HP before sending.'
        : 'CentriPro motor — Anza / Goulds shop standard. Confirm HP before sending.',
    quantity: 1,
    unitPrice: 0,
    taxable: true,
  };
}

export function buildAirRotaryLines(input: {
  footageFt: number;
  includeWaterDelivery: boolean;
  travelDays?: number;
}): QuoteLineDraft[] {
  if (!Number.isFinite(input.footageFt) || input.footageFt <= 0) {
    throw new Error('Air rotary footage must be a positive number from DWR');
  }

  const lines: QuoteLineDraft[] = [
    {
      name: MOBILIZATION_NAME,
      quantity: 1,
      unitPrice: MOBILIZATION_PRICE,
      taxable: true,
    },
    {
      name: AIR_ROTARY_FOOTAGE_NAME,
      description: 'Per-foot air rotary drilling with 4.5" SDR17 PVC liner',
      quantity: input.footageFt,
      unitPrice: AIR_ROTARY_FOOTAGE_PRICE,
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

const SERVICE_CALL_RE = /\$?\s*200\b|\bservice call\b/i;

export function mentionsServiceCallCredit(text: string | null | undefined): boolean {
  return Boolean(text && SERVICE_CALL_RE.test(text));
}

export function customerMessageForTechNote(kind: 'pull_and_eval' | 'replace', motorBrand?: string): string {
  if (kind === 'replace') {
    const brand = motorBrand ? ` Replacement motor brand: ${motorBrand}.` : '';
    return `Proposal to pull the well pump and replace the pumping equipment.${brand} Labor is quoted as BT2.`;
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

export function inferTechNoteKind(notes: string | null | undefined): 'pull_and_eval' | 'replace' {
  const text = (notes || '').toLowerCase();
  if (/\breplace\b|\breplacement\b|\bmotor\b/.test(text)) {
    return 'replace';
  }
  return 'pull_and_eval';
}
