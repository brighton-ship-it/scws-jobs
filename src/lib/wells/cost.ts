import { AIR_ROTARY_FOOTAGE_PRICE } from '../jobber/shop-book.ts';

/** Street air rotary ~$45/ft. Braman 4243 sold $48. Internal office band only. */
export const AIR_ROTARY_STREET_LOW = AIR_ROTARY_FOOTAGE_PRICE;
export const AIR_ROTARY_STREET_HIGH = 48;

export type DrillingCostBand = {
  low: number;
  high: number;
  perFootLow: number;
  perFootHigh: number;
  footageFt: number;
  label: string;
};

export function internalAirRotaryCostBand(footageFt: number): DrillingCostBand | null {
  if (!Number.isFinite(footageFt) || footageFt <= 0) return null;
  const low = Math.round(footageFt * AIR_ROTARY_STREET_LOW);
  const high = Math.round(footageFt * AIR_ROTARY_STREET_HIGH);
  return {
    low,
    high,
    perFootLow: AIR_ROTARY_STREET_LOW,
    perFootHigh: AIR_ROTARY_STREET_HIGH,
    footageFt,
    label:
      `Internal street air rotary ~$${AIR_ROTARY_STREET_LOW}–$${AIR_ROTARY_STREET_HIGH}/ft` +
      ` (${footageFt}' × $${AIR_ROTARY_STREET_LOW}–$${AIR_ROTARY_STREET_HIGH}). ` +
      'Office only — not a customer quote.',
  };
}

export function mentionsGpFlag(text: string | null | undefined): boolean {
  return /\bgp\s*flag\b/i.test(text || '');
}
