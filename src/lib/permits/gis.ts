import { cleanApn, formatApn, parseStreetAddress } from './county.ts';
import type { County, ParcelInfo } from './types.ts';

export const GIS = {
  // Token-free public parcels (PARCELS_ALL on gis-public is 499 Token Required).
  sdParcels:
    'https://gis-public.sandiegocounty.gov/arcgis/rest/services/cosd_warehouse/parcels_all_for_public_use/MapServer/0',
  sdAddrApn:
    'https://gis-public.sandiegocounty.gov/arcgis/rest/services/sdep_warehouse/ADDRAPN/FeatureServer/0',
  sdLocator:
    'https://gis-public.sandiegocounty.gov/arcgis/rest/services/addrapn_Composite/GeocodeServer/findAddressCandidates',
  sdBuildings:
    'https://gis-public.sandiegocounty.gov/arcgis/rest/services/sdep_warehouse/BUILDING_OUTLINES/FeatureServer/0',
  rivParcels:
    'https://gis.countyofriverside.us/arcgis/rest/services/mmc/mmc_mSrvc/MapServer/8',
  sbParcels:
    'https://services.arcgis.com/aA3snZwJfFkVyDuP/arcgis/rest/services/Parcels_for_San_Bernardino_County/FeatureServer/0',
  dwrWells:
    'https://gis.water.ca.gov/arcgis/rest/services/Environment/i07_WellCompletionReports/FeatureServer/0',
};

const SD_PARCEL_FIELDS =
  'APN,APN_8,SITUS_ADDRESS,SITUS_STREET,SITUS_SUFFIX,SITUS_ZIP,SITUS_JURIS,ACREAGE,SITUS_BUILDING,SITUS_SUITE';

const BLOCKED_ATTRS = new Set([
  'FLAG',
  'flag',
  'GP',
  'GROSS_PROFIT',
  'GROSSPROFIT',
  'MARGIN',
]);

export async function queryArcGis(
  layerUrl: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch
): Promise<any> {
  const search = new URLSearchParams({ f: 'json', ...params });
  const url = `${layerUrl.replace(/\/$/, '')}/query?${search}`;
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'SCWS-PermitResearch/1.0' },
  });
  if (!response.ok) {
    throw new Error(`GIS HTTP ${response.status} for ${layerUrl}`);
  }
  const data = await response.json();
  if (data?.error) {
    throw new Error(data.error.message || 'GIS query failed');
  }
  return data;
}

export function publicAttrs(attrs: Record<string, any> | null | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  if (!attrs) return out;
  for (const [key, value] of Object.entries(attrs)) {
    if (BLOCKED_ATTRS.has(key) || BLOCKED_ATTRS.has(key.toUpperCase())) continue;
    out[key] = value;
  }
  return out;
}

export function centroidFromRings(rings?: number[][][]): { lat: number; lng: number } | null {
  const ring = rings?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const point of ring) {
    x += point[0];
    y += point[1];
  }
  return { lng: x / ring.length, lat: y / ring.length };
}

/** Equirectangular shoelace in feet around the ring centroid. */
export function ringAreaSqFt(ring: number[][]): number {
  if (!ring || ring.length < 3) return 0;
  const lat0 = ring.reduce((sum, pt) => sum + pt[1], 0) / ring.length;
  const feetPerDegLat = 364000;
  const feetPerDegLng = 364000 * Math.cos((lat0 * Math.PI) / 180);
  const pts = ring.map((pt) => ({
    x: (pt[0] - ring[0][0]) * feetPerDegLng,
    y: (pt[1] - ring[0][1]) * feetPerDegLat,
  }));
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area / 2);
}

export function haversineFeet(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 20902231;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface GeoResult {
  lat: number;
  lng: number;
  formatted?: string;
  city?: string | null;
}

export async function geocodeAddress(
  address: string,
  fetchImpl: typeof fetch = fetch
): Promise<GeoResult | null> {
  const locator = await geocodeSdLocator(address, fetchImpl);
  if (locator) return locator;
  const census = await geocodeCensus(address, fetchImpl);
  if (census) return census;
  return geocodeNominatim(address, fetchImpl);
}

async function geocodeSdLocator(address: string, fetchImpl: typeof fetch): Promise<GeoResult | null> {
  try {
    const url =
      GIS.sdLocator +
      '?' +
      new URLSearchParams({
        f: 'json',
        singleLine: address,
        outSR: '4326',
        maxLocations: '3',
      });
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'SCWS-PermitResearch/1.0' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const hit = (data?.candidates || []).find((c: any) => c?.score >= 90 && c?.location);
    if (!hit) return null;
    return {
      lat: Number(hit.location.y),
      lng: Number(hit.location.x),
      formatted: hit.address,
      city: null,
    };
  } catch {
    return null;
  }
}

async function geocodeCensus(address: string, fetchImpl: typeof fetch): Promise<GeoResult | null> {
  try {
    const url =
      'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?' +
      new URLSearchParams({
        address,
        benchmark: 'Public_AR_Current',
        format: 'json',
      });
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'SCWS-PermitResearch/1.0' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const match = data?.result?.addressMatches?.[0];
    if (!match?.coordinates) return null;
    const city =
      match.addressComponents?.city ||
      match.matchedAddress?.split(',')?.[1]?.trim() ||
      null;
    return {
      lat: Number(match.coordinates.y),
      lng: Number(match.coordinates.x),
      formatted: match.matchedAddress,
      city,
    };
  } catch {
    return null;
  }
}

async function geocodeNominatim(address: string, fetchImpl: typeof fetch): Promise<GeoResult | null> {
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({
        q: address,
        format: 'json',
        limit: '1',
        countrycodes: 'us',
      });
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'SCWS-PermitResearch/1.0' },
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    const first = rows[0];
    if (!first?.lat || !first?.lon) return null;
    const cityMatch = (first.display_name || '').match(/,\s*([^,]+),\s*California/i);
    return {
      lat: parseFloat(first.lat),
      lng: parseFloat(first.lon),
      formatted: first.display_name,
      city: cityMatch?.[1] || null,
    };
  } catch {
    return null;
  }
}

function publishedOwner(...values: Array<string | null | undefined>): string | undefined {
  const name = values.filter(Boolean).join(' ').trim();
  if (!name) return undefined;
  if (/protected|redacted|unknown/i.test(name)) return undefined;
  return name;
}

function isUsableApn(apn: string | undefined): boolean {
  const clean = cleanApn(apn || '');
  if (!clean || clean.length < 6) return false;
  if (clean === 'RW' || /^RW/i.test(apn || '')) return false;
  return true;
}

function parcelFromSd(attrs: Record<string, any>, geometry: any, county: County): ParcelInfo | null {
  const a = publicAttrs(attrs);
  const rawApn = a.APN || a.APN_8 || a.APN_10;
  if (!isUsableApn(rawApn)) return null;
  const siteAddr = [a.SITUS_ADDRESS, a.SITUS_STREET, a.SITUS_SUFFIX].filter(Boolean).join(' ');
  const acres = parseFloat(a.ACREAGE) || undefined;
  const ring = geometry?.rings?.[0];
  const sqftFromRing = ring ? Math.round(ringAreaSqFt(ring)) : undefined;
  return {
    apn: formatApn(rawApn, county),
    ownerName: publishedOwner(a.OWN_NAME1, a.OWN_NAME2),
    ownerAddress: [a.OWN_ADDR1, a.OWN_ADDR2].filter(Boolean).join(', ') || undefined,
    siteAddress: [siteAddr, a.SITUS_ZIP].filter(Boolean).join(', ') || undefined,
    lotSizeAcres: acres || (sqftFromRing ? Math.round((sqftFromRing / 43560) * 100) / 100 : undefined),
    lotSizeSqFt: acres ? Math.round(acres * 43560) : sqftFromRing,
    geometry: geometry?.rings ? { rings: geometry.rings, spatialReference: { wkid: 4326 } } : undefined,
    landUse: a.NUCLEUS_USE_CD || a.ASR_LANDUSE || undefined,
    zoning: a.NUCLEUS_ZONE_CD || a.ASR_ZONE || undefined,
  };
}

function parcelFromRiv(attrs: Record<string, any>, geometry: any): ParcelInfo | null {
  const a = publicAttrs(attrs);
  if (!isUsableApn(a.APN)) return null;
  const acres = parseFloat(a.ACREAGE ?? a.ACRE) || undefined;
  const ring = geometry?.rings?.[0];
  const sqftFromRing = ring ? Math.round(ringAreaSqFt(ring)) : undefined;
  return {
    apn: formatApn(a.APN, 'riverside'),
    ownerName: publishedOwner(a.PRIMARY_OWNER, a.OWNERNAME, a.OWNER_NAME, a.MAIL_TO_NAME),
    ownerAddress: [a.MAIL_STREET, a.MAIL_CITY].filter(Boolean).join(', ') || undefined,
    siteAddress:
      a.FULL_SITUS_ADDRESS ||
      [a.SITUS_STREET, a.SITUS_CITY].filter(Boolean).join(', ') ||
      [a.HOUSE_NO, a.STREET].filter(Boolean).join(' ') ||
      undefined,
    lotSizeAcres: acres || (sqftFromRing ? Math.round((sqftFromRing / 43560) * 100) / 100 : undefined),
    lotSizeSqFt: acres ? Math.round(acres * 43560) : sqftFromRing,
    geometry: geometry?.rings ? { rings: geometry.rings, spatialReference: { wkid: 4326 } } : undefined,
    landUse: a.CLASS_CODE || a.REALUSE || undefined,
    zoning: a.CLASS_CODE || undefined,
  };
}

function parcelFromSb(attrs: Record<string, any>, geometry: any): ParcelInfo {
  const a = publicAttrs(attrs);
  const acres = parseFloat(a.Acreage ?? a.ACREAGE) || undefined;
  const ring = geometry?.rings?.[0];
  const sqftFromRing = ring ? Math.round(ringAreaSqFt(ring)) : undefined;
  const owner = a.OwnerName && !/protected/i.test(String(a.OwnerName)) ? a.OwnerName : undefined;
  return {
    apn: String(a.ParcelNumber || a.APN || ''),
    ownerName: owner,
    siteAddress: a.SitusAddress || a.SITEADDR || undefined,
    lotSizeAcres: acres || (sqftFromRing ? Math.round((sqftFromRing / 43560) * 100) / 100 : undefined),
    lotSizeSqFt: acres ? Math.round(acres * 43560) : sqftFromRing,
    geometry: geometry?.rings ? { rings: geometry.rings, spatialReference: { wkid: 4326 } } : undefined,
    zoning: a.Zoning || undefined,
  };
}

async function queryPoint(
  layerUrl: string,
  lat: number,
  lng: number,
  outFields: string,
  fetchImpl: typeof fetch
): Promise<any | null> {
  const result = await queryArcGis(
    layerUrl,
    {
      geometry: `${lng},${lat}`,
      geometryType: 'esriGeometryPoint',
      spatialRel: 'esriSpatialRelIntersects',
      inSR: '4326',
      outFields,
      returnGeometry: 'true',
      outSR: '4326',
      resultRecordCount: '3',
    },
    fetchImpl
  );
  return result.features?.[0] || null;
}

export async function fetchSanDiegoParcel(input: {
  apn?: string;
  address?: string;
  lat?: number;
  lng?: number;
  fetchImpl?: typeof fetch;
}): Promise<ParcelInfo | null> {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (input.apn) {
    const clean = cleanApn(input.apn).padStart(10, '0');
    const result = await queryArcGis(
      GIS.sdParcels,
      {
        where: `APN = '${clean}' OR APN_8 = '${clean.slice(0, 8)}'`,
        outFields: SD_PARCEL_FIELDS,
        returnGeometry: 'true',
        outSR: '4326',
      },
      fetchImpl
    );
    if (result.features?.[0]) {
      return parcelFromSd(result.features[0].attributes, result.features[0].geometry, 'san_diego');
    }
  }

  if (input.address) {
    const parsed = parseStreetAddress(input.address);
    if (parsed.number && parsed.name) {
      const community = (parsed.city || '').replace(/'/g, "''");
      const name = parsed.name.replace(/'/g, "''");
      const where = community
        ? `ADDRNMBR=${parsed.number} AND UPPER(ADDRNAME)='${name}' AND UPPER(COMMUNITY)='${community.toUpperCase()}'`
        : `ADDRNMBR=${parsed.number} AND UPPER(ADDRNAME)='${name}'`;
      try {
        const addr = await queryArcGis(
          GIS.sdAddrApn,
          {
            where,
            outFields: 'APN,ADDRNMBR,ADDRNAME,ADDRSFX,COMMUNITY,ADDRZIP',
            returnGeometry: 'false',
            resultRecordCount: '5',
          },
          fetchImpl
        );
        const apn = addr.features?.[0]?.attributes?.APN;
        if (apn) {
          const byApn = await fetchSanDiegoParcel({ apn, fetchImpl });
          if (byApn) return byApn;
        }
      } catch {
        // Fall through to coordinate query
      }
    }
  }

  if (input.lat != null && input.lng != null) {
    const feature = await queryPoint(GIS.sdParcels, input.lat, input.lng, SD_PARCEL_FIELDS, fetchImpl);
    if (feature) return parcelFromSd(feature.attributes, feature.geometry, 'san_diego');
  }
  return null;
}

export async function fetchNearbyStructures(
  lat: number,
  lng: number,
  fetchImpl: typeof fetch = fetch
): Promise<import('./types').StructureFootprint[]> {
  const pad = 0.002;
  try {
    const result = await queryArcGis(
      GIS.sdBuildings,
      {
        geometry: `${lng - pad},${lat - pad},${lng + pad},${lat + pad}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'OBJECTID',
        returnGeometry: 'true',
        outSR: '4326',
        resultRecordCount: '20',
      },
      fetchImpl
    );
    return (result.features || [])
      .filter((f: { geometry?: { rings?: number[][][] } }) => f.geometry?.rings)
      .map((f: { geometry: { rings: number[][][] } }) => ({ rings: f.geometry.rings }));
  } catch {
    return [];
  }
}

export async function fetchRiversideParcel(input: {
  apn?: string;
  address?: string;
  lat?: number;
  lng?: number;
  fetchImpl?: typeof fetch;
}): Promise<ParcelInfo | null> {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (input.address) {
    const parsed = parseStreetAddress(input.address);
    if (parsed.number) {
      const city = (parsed.city || '').replace(/'/g, "''").toUpperCase();
      const where = city
        ? `SITUS_STREET LIKE '%${parsed.number}%' AND UPPER(SITUS_CITY) LIKE '%${city}%'`
        : `SITUS_STREET LIKE '%${parsed.number}%' OR FULL_SITUS_ADDRESS LIKE '%${parsed.number}%'`;
      try {
        const result = await queryArcGis(
          GIS.rivParcels,
          {
            where,
            outFields:
              'APN,SITUS_STREET,SITUS_CITY,MAIL_STREET,MAIL_CITY,ACREAGE,FULL_SITUS_ADDRESS,CLASS_CODE',
            returnGeometry: 'true',
            outSR: '4326',
            resultRecordCount: '8',
          },
          fetchImpl
        );
        const features = result.features || [];
        const match =
          features.find((f: any) =>
            String(f.attributes?.SITUS_STREET || '').startsWith(String(parsed.number))
          ) || features[0];
        if (match) {
          const parcel = parcelFromRiv(match.attributes, match.geometry);
          if (parcel) return parcel;
        }
      } catch {
        // Fall through to APN / point
      }
    }
  }
  if (input.apn) {
    const clean = cleanApn(input.apn);
    const result = await queryArcGis(
      GIS.rivParcels,
      {
        where: `APN = '${clean}' OR APN = '${formatApn(clean, 'riverside')}'`,
        outFields:
          'APN,SITUS_STREET,SITUS_CITY,MAIL_STREET,MAIL_CITY,ACREAGE,FULL_SITUS_ADDRESS,CLASS_CODE',
        returnGeometry: 'true',
        outSR: '4326',
      },
      fetchImpl
    );
    if (result.features?.[0]) {
      const parcel = parcelFromRiv(result.features[0].attributes, result.features[0].geometry);
      if (parcel) return parcel;
    }
  }
  if (input.lat != null && input.lng != null) {
    const feature = await queryPoint(
      GIS.rivParcels,
      input.lat,
      input.lng,
      'APN,SITUS_STREET,SITUS_CITY,MAIL_STREET,MAIL_CITY,ACREAGE,FULL_SITUS_ADDRESS,CLASS_CODE',
      fetchImpl
    );
    if (feature) {
      const parcel = parcelFromRiv(feature.attributes, feature.geometry);
      if (parcel) return parcel;
    }
  }
  return null;
}

export async function fetchSanBernardinoParcel(input: {
  apn?: string;
  lat?: number;
  lng?: number;
  fetchImpl?: typeof fetch;
}): Promise<ParcelInfo | null> {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (input.apn) {
    const clean = cleanApn(input.apn);
    const result = await queryArcGis(
      GIS.sbParcels,
      {
        where: `ParcelNumber = '${clean}' OR ParcelNumber LIKE '%${clean}%'`,
        outFields: 'ParcelNumber,OwnerName,Zoning,Acreage',
        returnGeometry: 'true',
        outSR: '4326',
      },
      fetchImpl
    );
    if (result.features?.[0]) {
      return parcelFromSb(result.features[0].attributes, result.features[0].geometry);
    }
  }
  if (input.lat != null && input.lng != null) {
    const feature = await queryPoint(
      GIS.sbParcels,
      input.lat,
      input.lng,
      'ParcelNumber,OwnerName,Zoning,Acreage',
      fetchImpl
    );
    if (feature) return parcelFromSb(feature.attributes, feature.geometry);
  }
  return null;
}

export async function fetchParcelForCounty(
  county: County,
  input: {
    apn?: string;
    address?: string;
    lat?: number;
    lng?: number;
    fetchImpl?: typeof fetch;
  }
): Promise<ParcelInfo | null> {
  if (county === 'riverside') {
    return fetchRiversideParcel(input);
  }
  if (county === 'san_bernardino') return fetchSanBernardinoParcel(input);
  return fetchSanDiegoParcel(input);
}
