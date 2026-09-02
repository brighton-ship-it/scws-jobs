import { getCountyByCity } from '../tax-rates.ts';
import type { County } from './types.ts';
export type { County } from './types.ts';

const COUNTY_FROM_LABEL: Record<string, County> = {
  'san diego': 'san_diego',
  riverside: 'riverside',
  'san bernardino': 'san_bernardino',
};

/**
 * Detect county from a street address / city first, then coordinates.
 * Temecula (~33.50) is Riverside; Fallbrook (~33.38) stays San Diego.
 * Anza (33.55) is Riverside; Ramona (33.04) is San Diego.
 */
export function detectCounty(input: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  county?: County | string | null;
}): County {
  const fromAddress = countyFromAddress(input.address);
  if (fromAddress) return fromAddress;

  const fromCoords = countyFromCoords(input.lat, input.lng);
  if (fromCoords) return fromCoords;

  if (input.county && isCounty(input.county)) return input.county;
  return 'san_diego';
}

export function isCounty(value: string): value is County {
  return value === 'san_diego' || value === 'riverside' || value === 'san_bernardino';
}

export function countyFromAddress(address?: string | null): County | null {
  if (!address) return null;
  const city = extractCity(address);
  if (city) {
    const labeled = getCountyByCity(city);
    if (labeled && COUNTY_FROM_LABEL[labeled.toLowerCase()]) {
      return COUNTY_FROM_LABEL[labeled.toLowerCase()];
    }
  }
  const lower = address.toLowerCase();
  if (/\banza\b|\b92539\b|\bca-?371\b|\bhighway\s*371\b|\bstate\s*rte\s*371\b/.test(lower)) {
    return 'riverside';
  }
  if (/\bramona\b|\b92065\b/.test(lower)) return 'san_diego';
  if (/\bsan\s*bernardino\b|\bsb\s*county\b/.test(lower)) return 'san_bernardino';
  if (/\briverside\b/.test(lower)) return 'riverside';
  if (/\bsan\s*diego\b/.test(lower)) return 'san_diego';
  return null;
}

export function countyFromCoords(lat?: number | null, lng?: number | null): County | null {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lng > -114.1 || lng < -117.8 || lat < 32.5 || lat > 35.9) return null;

  // High desert / San Bernardino mountains and valley
  if (lat >= 34.05) return 'san_bernardino';

  // Riverside (Temecula / Murrieta / Anza / Hemet / Coachella)
  if (lat >= 33.43) return 'riverside';

  return 'san_diego';
}

export function extractCity(address: string): string | null {
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    const maybeCity = parts[parts.length - 2].replace(/\bCA\b/i, '').trim();
    if (maybeCity && !/^\d/.test(maybeCity)) return maybeCity;
  }
  if (parts.length >= 2) {
    const mid = parts[1].replace(/\bCA\b.*$/i, '').replace(/\d{5}(-\d{4})?/, '').trim();
    if (mid && !/^unit\b/i.test(mid) && !/^(ste|suite|apt|#)/i.test(mid)) return mid;
  }
  return null;
}

export function formatApn(raw: string | number | null | undefined, county: County): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return String(raw ?? '');
  if (county === 'san_diego' && digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
  }
  if (county === 'riverside' && digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
  }
  return digits;
}

export function cleanApn(raw: string | number | null | undefined): string {
  return String(raw ?? '').replace(/[-\s]/g, '');
}

/** Street number + name for county ADDRAPN-style queries. Drops unit/suite. */
export function parseStreetAddress(address: string): {
  number?: number;
  name?: string;
  city?: string | null;
  zip?: string | null;
} {
  const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  const city = extractCity(address);
  const first = address.split(',')[0] || address;
  const withoutUnit = first.replace(/\b(unit|ste|suite|apt|#)\s*[a-z0-9-]+\b/gi, '').trim();
  const match = withoutUnit.match(/^(\d+)\s+(.+)$/);
  if (!match) return { city, zip: zipMatch?.[1] || null };
  const name = match[2]
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|way|highway|hwy|state rte|state route)\b/gi, '')
    .replace(/\b(ca-?|sr-?)\s*/gi, '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return {
    number: parseInt(match[1], 10),
    name: name || undefined,
    city,
    zip: zipMatch?.[1] || null,
  };
}
