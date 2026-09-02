import { getCountyByCity } from '../tax-rates.ts';
import type { County } from './types.ts';
export type { County } from './types.ts';

const COUNTY_FROM_LABEL: Record<string, County> = {
  'san diego': 'san_diego',
  riverside: 'riverside',
  'san bernardino': 'san_bernardino',
};

const UNSUPPORTED_COUNTIES = new Set([
  'los angeles',
  'orange',
  'imperial',
  'ventura',
  'kern',
  'santa barbara',
  'san luis obispo',
]);

export type CountyResolution =
  | { status: 'supported'; county: County; source: string; label: string }
  | { status: 'unsupported'; countyName: string; source: string; flag: string }
  | { status: 'unknown'; source: string; flag: string };

/**
 * Resolve county from geocode admin area first.
 * Manual override wins only when the caller sets countyOverride (UI picker).
 * A leftover `county: san_diego` hint never beats Anza / geocode.
 * Never silently default to San Diego.
 */
export function resolveCounty(input: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  geocodeCounty?: string | null;
  /** Explicit office picker — wins over geocode. */
  countyOverride?: County | string | null;
  /** Legacy hint from older clients; does not beat geocode / address. */
  county?: County | string | null;
}): CountyResolution {
  if (input.countyOverride && isCounty(input.countyOverride)) {
    return {
      status: 'supported',
      county: input.countyOverride,
      source: 'manual override',
      label: labelFor(input.countyOverride),
    };
  }

  const fromGeocode = parseCountyName(input.geocodeCounty);
  if (fromGeocode.status !== 'unknown') return { ...fromGeocode, source: fromGeocode.source || 'geocode county' };

  const fromAddress = countyFromAddress(input.address);
  if (fromAddress === 'unsupported') {
    return unsupportedResult(input.address || 'address', 'address');
  }
  if (fromAddress) {
    return {
      status: 'supported',
      county: fromAddress,
      source: 'address / city',
      label: labelFor(fromAddress),
    };
  }

  const fromCoords = countyFromCoords(input.lat, input.lng);
  if (fromCoords) {
    return {
      status: 'supported',
      county: fromCoords,
      source: 'coordinate heuristic (confirm with geocode county)',
      label: labelFor(fromCoords),
    };
  }

  if (input.county && isCounty(input.county)) {
    return {
      status: 'supported',
      county: input.county,
      source: 'caller county hint',
      label: labelFor(input.county),
    };
  }

  return {
    status: 'unknown',
    source: 'none',
    flag: 'FLAG: county could not be determined. Select San Diego, Riverside, or San Bernardino — do not assume San Diego.',
  };
}

/** Prefer resolveCounty. Returns null instead of defaulting to San Diego. */
export function detectCounty(input: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  county?: County | string | null;
  countyOverride?: County | string | null;
  geocodeCounty?: string | null;
}): County | null {
  const resolved = resolveCounty(input);
  if (resolved.status === 'supported') return resolved.county;
  return null;
}

export function isCounty(value: string): value is County {
  return value === 'san_diego' || value === 'riverside' || value === 'san_bernardino';
}

export function parseCountyName(raw?: string | null): CountyResolution {
  if (!raw) return { status: 'unknown', source: 'geocode county', flag: 'No county name from geocode' };
  const normalized = raw
    .toLowerCase()
    .replace(/\bcounty\b/g, '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (COUNTY_FROM_LABEL[normalized]) {
    const county = COUNTY_FROM_LABEL[normalized];
    return { status: 'supported', county, source: 'geocode county', label: labelFor(county) };
  }
  if (UNSUPPORTED_COUNTIES.has(normalized)) {
    return unsupportedResult(raw, 'geocode county');
  }
  return { status: 'unknown', source: 'geocode county', flag: `Unrecognized county label: ${raw}` };
}

function unsupportedResult(name: string, source: string): Extract<CountyResolution, { status: 'unsupported' }> {
  const clean = String(name).replace(/\s+/g, ' ').trim();
  return {
    status: 'unsupported',
    countyName: clean,
    source,
    flag: `FLAG: county not supported (${clean}). SCWS plot-plan tool covers San Diego, Riverside, and San Bernardino only. Do not default to San Diego.`,
  };
}

function labelFor(county: County): string {
  if (county === 'san_diego') return 'San Diego County';
  if (county === 'riverside') return 'Riverside County';
  return 'San Bernardino County';
}

export function countyFromAddress(address?: string | null): County | 'unsupported' | null {
  if (!address) return null;
  const city = extractCity(address);
  if (city) {
    const labeled = getCountyByCity(city);
    if (labeled && COUNTY_FROM_LABEL[labeled.toLowerCase()]) {
      return COUNTY_FROM_LABEL[labeled.toLowerCase()];
    }
  }
  const lower = address.toLowerCase();
  const parsed = parseCountyName(lower.match(/\b(san diego|riverside|san bernardino|los angeles|orange|imperial)\s+county\b/)?.[0] || '');
  if (parsed.status === 'supported') return parsed.county;
  if (parsed.status === 'unsupported') return 'unsupported';

  if (/\banza\b|\b92539\b|\bca-?371\b|\bhighway\s*371\b|\bstate\s*rte\s*371\b|\baguanga\b|\b92536\b/.test(lower)) {
    return 'riverside';
  }
  if (/\bramona\b|\b92065\b/.test(lower)) return 'san_diego';
  if (/\bcrestline\b|\blake arrowhead\b|\b92325\b|\b92352\b|\b92322\b/.test(lower)) {
    return 'san_bernardino';
  }
  if (/\bsan\s*bernardino\b|\bsb\s*county\b/.test(lower)) return 'san_bernardino';
  if (/\briverside\b/.test(lower)) return 'riverside';
  if (/\bsan\s*diego\b/.test(lower)) return 'san_diego';
  if (/\blos\s*angeles\b|\borange county\b|\bimperial\b/.test(lower)) return 'unsupported';
  return null;
}

/**
 * Rough lat/lng boxes for the three SCWS counties only.
 * Returns null outside those boxes (Imperial / Orange / LA) — never SD-by-default.
 */
export function countyFromCoords(lat?: number | null, lng?: number | null): County | null {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lng > -114.1 || lng < -118.0 || lat < 32.5 || lat > 35.9) return null;

  // Imperial County is south of ~32.67 along the SD border — refuse the SD default.
  if (lat < 32.62 && lng > -116.3) return null;

  // San Bernardino mountains / valley / high desert (Crestline ~34.24)
  if (lat >= 34.05 && lng < -116.0) return 'san_bernardino';

  // Riverside (Temecula / Murrieta / Anza / Hemet / Coachella)
  if (lat >= 33.43 && lat < 34.45 && lng > -117.7 && lng < -114.4) {
    // NW corner near Ontario is SB; keep that as SB when lat is high enough.
    if (lat >= 34.05) return 'san_bernardino';
    return 'riverside';
  }

  // Unincorporated / incorporated SD (Ramona 33.04, Fallbrook 33.38, Valley Center 33.28)
  if (lat >= 32.53 && lat < 33.43 && lng <= -116.08 && lng >= -117.6) return 'san_diego';

  return null;
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
  if (county === 'san_bernardino' && digits.length === 9) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 9)}`;
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
