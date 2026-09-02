/**
 * Server-side geocode for office well lookup.
 * Nominatim from the browser is blocked (CORS / UA). Call this from /api only.
 */

export type WellGeoPoint = {
  lat: number;
  lng: number;
  city: string | null;
  formatted: string;
  source: 'nominatim' | 'census';
};

function cityFromDisplay(display: string, address: string): string | null {
  const beforeCounty = display.match(/,\s*([^,]+),\s*[^,]+County,\s*California/i);
  if (beforeCounty?.[1]) return beforeCounty[1].trim();
  const ca = display.match(/,\s*([^,]+),\s*California/i);
  if (ca?.[1] && !/county/i.test(ca[1])) return ca[1].trim();
  const parts = address.split(',').map((part) => part.trim());
  return parts[1] || null;
}

export async function geocodeNominatim(
  address: string,
  fetchImpl: typeof fetch = fetch
): Promise<WellGeoPoint | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    address
  )}&format=json&limit=1&countrycodes=us`;
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': 'SCWS-WellLookup/1.0 (office@scwellservice.com)',
      Accept: 'application/json',
    },
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
  }>;
  const first = rows[0];
  if (!first?.lat || !first?.lon) return null;
  const lat = parseFloat(first.lat);
  const lng = parseFloat(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const formatted = first.display_name || address;
  return {
    lat,
    lng,
    city: cityFromDisplay(formatted, address),
    formatted,
    source: 'nominatim',
  };
}

export async function geocodeCensus(
  address: string,
  fetchImpl: typeof fetch = fetch
): Promise<WellGeoPoint | null> {
  const url =
    'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?' +
    new URLSearchParams({
      address,
      benchmark: 'Public_AR_Current',
      format: 'json',
    }).toString();
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    result?: {
      addressMatches?: Array<{
        coordinates?: { x?: number; y?: number };
        addressComponents?: { city?: string };
        matchedAddress?: string;
      }>;
    };
  };
  const match = data.result?.addressMatches?.[0];
  const lat = match?.coordinates?.y;
  const lng = match?.coordinates?.x;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return {
    lat,
    lng,
    city: match.addressComponents?.city || cityFromDisplay(match.matchedAddress || '', address),
    formatted: match.matchedAddress || address,
    source: 'census',
  };
}

/** Nominatim first (good for CA-371 / rural), Census Bureau fallback. */
export async function geocodeWellAddress(
  address: string,
  fetchImpl: typeof fetch = fetch
): Promise<WellGeoPoint | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;
  try {
    const nominatim = await geocodeNominatim(trimmed, fetchImpl);
    if (nominatim) return nominatim;
  } catch {
    // Census still has a chance.
  }
  try {
    return await geocodeCensus(trimmed, fetchImpl);
  } catch {
    return null;
  }
}

export function parseCoord(value: string | null): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
