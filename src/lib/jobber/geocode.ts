export type GeoPoint = {
  lat: number;
  lng: number;
  city?: string | null;
  street?: string | null;
  postalCode?: string | null;
  formatted?: string | null;
  ownerName?: string | null;
  apn?: string | null;
  county?: string | null;
};

const SD_PARCELS =
  'https://gis-public.sandiegocounty.gov/arcgis/rest/services/sdep_warehouse/PARCELS_ALL/MapServer/0/query';
const RIV_PARCELS =
  'https://content.rcflood.org/arcgis/rest/services/FacilitiesAndProperties/DynamicLayerEP/MapServer/5/query';

function centroidFromGeometry(geometry: any): { lat: number; lng: number } | null {
  if (!geometry) return null;
  if (typeof geometry.y === 'number' && typeof geometry.x === 'number') {
    return { lat: geometry.y, lng: geometry.x };
  }
  const ring = geometry.rings?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const point of ring) {
    x += point[0];
    y += point[1];
  }
  return { lat: y / ring.length, lng: x / ring.length };
}

async function queryArcGis(
  url: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch
): Promise<any> {
  const search = new URLSearchParams({ f: 'json', ...params });
  const response = await fetchImpl(`${url}?${search}`);
  if (!response.ok) {
    throw new Error(`Parcel GIS HTTP ${response.status}`);
  }
  return response.json();
}

export async function lookupParcel(
  apn: string,
  fetchImpl: typeof fetch = fetch
): Promise<GeoPoint | null> {
  const clean = apn.replace(/[-\s]/g, '');
  if (clean.length < 7) return null;

  const sdApn = clean.padStart(10, '0');
  const sd = await queryArcGis(
    SD_PARCELS,
    {
      where: `APN = '${sdApn}'`,
      outFields:
        'APN,OWN_NAME1,OWN_NAME2,SITUS_ADDRESS,SITUS_STREET,SITUS_SUFFIX,SITUS_COMMUNITY,SITUS_ZIP',
      returnGeometry: 'true',
      outSR: '4326',
    },
    fetchImpl
  );
  if (sd.features?.[0]) {
    const attrs = sd.features[0].attributes || {};
    const point = centroidFromGeometry(sd.features[0].geometry);
    const street = [attrs.SITUS_ADDRESS, attrs.SITUS_STREET, attrs.SITUS_SUFFIX]
      .filter(Boolean)
      .join(' ');
    return {
      lat: point?.lat ?? 0,
      lng: point?.lng ?? 0,
      city: attrs.SITUS_COMMUNITY || null,
      street: street || null,
      postalCode: attrs.SITUS_ZIP || null,
      ownerName: [attrs.OWN_NAME1, attrs.OWN_NAME2].filter(Boolean).join(' ') || null,
      apn: attrs.APN || apn,
      county: 'San Diego',
      formatted: [street, attrs.SITUS_COMMUNITY, attrs.SITUS_ZIP].filter(Boolean).join(', '),
    };
  }

  const riv = await queryArcGis(
    RIV_PARCELS,
    {
      where: `APN = '${clean}' OR APN LIKE '%${clean}%'`,
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
    },
    fetchImpl
  );
  if (riv.features?.[0]) {
    const attrs = riv.features[0].attributes || {};
    const point = centroidFromGeometry(riv.features[0].geometry);
    return {
      lat: point?.lat ?? 0,
      lng: point?.lng ?? 0,
      city: attrs.SITUSCITY || attrs.CITY || null,
      street: attrs.SITEADDR || attrs.SITE_ADDRESS || null,
      ownerName: attrs.OWNERNAME || attrs.OWNER_NAME || null,
      apn: attrs.APN || apn,
      county: 'Riverside',
      formatted: attrs.SITEADDR || attrs.SITE_ADDRESS || null,
    };
  }

  return null;
}

export async function geocodeAddress(
  address: string,
  fetchImpl: typeof fetch = fetch
): Promise<GeoPoint | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    address
  )}&format=json&limit=1&countrycodes=us`;
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'SCWS-DrillQuote/1.0' },
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
  }>;
  const first = rows[0];
  if (!first?.lat || !first?.lon) return null;
  const display = first.display_name || address;
  const cityMatch = display.match(/,\s*([^,]+),\s*California/i);
  return {
    lat: parseFloat(first.lat),
    lng: parseFloat(first.lon),
    city: cityMatch?.[1] || null,
    street: address.split(',')[0] || null,
    formatted: display,
  };
}

export async function resolveSiteLocation(input: {
  apn?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  city?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<GeoPoint> {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (input.lat && input.lng) {
    return {
      lat: input.lat,
      lng: input.lng,
      city: input.city || null,
      street: input.address || null,
      formatted: input.address || null,
    };
  }
  if (input.apn) {
    const parcel = await lookupParcel(input.apn, fetchImpl);
    if (parcel && parcel.lat && parcel.lng) return parcel;
  }
  if (input.address) {
    const geo = await geocodeAddress(input.address, fetchImpl);
    if (geo) return geo;
  }
  throw new Error('Could not resolve APN or address to a map point');
}
