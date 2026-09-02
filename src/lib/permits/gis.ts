import { cleanApn, formatApn, parseStreetAddress } from './county.ts';
import type { County, ParcelInfo } from './types.ts';
import { NEIGHBOR_ENVELOPE_FT } from './types.ts';

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
  // Parcel FLAG only (Known Septic Connected) — not tank/leach polygons. Use FeatureServer (MapServer attribute query is 400).
  sdSeptic:
    'https://gis-public.sandiegocounty.gov/arcgis/rest/services/sdep_warehouse/WW_SEPTIC_SEWER_PUBLIC/FeatureServer/0',
  sdRoads:
    'https://gis-public.sandiegocounty.gov/arcgis/rest/services/sdep_warehouse/ROADS_ALL/MapServer/0',
  rivParcels:
    'https://gis.countyofriverside.us/arcgis/rest/services/mmc/mmc_mSrvc/MapServer/8',
  sbParcels:
    'https://services.arcgis.com/aA3snZwJfFkVyDuP/arcgis/rest/services/Parcels_for_San_Bernardino_County/FeatureServer/0',
  dwrWells:
    'https://gis.water.ca.gov/arcgis/rest/services/Environment/i07_WellCompletionReports/FeatureServer/0',
  worldImagery:
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export',
};

export const RIV_PARCEL_FIELDS =
  'APN,SITUS_STREET,SITUS_CITY,MAIL_STREET,MAIL_CITY,MAIL_TO_NAME,HOUSE_NO,STREET,ACREAGE,ACRE,FULL_SITUS_ADDRESS,CLASS_CODE,REALUSE,PRIMARY_OWNER,OWNERNAME,OWNER_NAME';

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

const FEET_PER_DEG_LAT = 364000;

export function lonLatTo3857(lng: number, lat: number): { x: number; y: number } {
  const x = (lng * 20037508.34) / 180;
  const y =
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180);
  return { x, y };
}

export function ringBBox(ring: number[][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of ring) {
    minX = Math.min(minX, pt[0]);
    minY = Math.min(minY, pt[1]);
    maxX = Math.max(maxX, pt[0]);
    maxY = Math.max(maxY, pt[1]);
  }
  return { minX, minY, maxX, maxY };
}

export function expandBboxFeet(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  feet: number
): { minX: number; minY: number; maxX: number; maxY: number } {
  const midLat = (bbox.minY + bbox.maxY) / 2;
  const dLat = feet / FEET_PER_DEG_LAT;
  const dLng = feet / (FEET_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180));
  return {
    minX: bbox.minX - dLng,
    minY: bbox.minY - dLat,
    maxX: bbox.maxX + dLng,
    maxY: bbox.maxY + dLat,
  };
}

/** Ring vertices are [lng, lat]. */
export function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-16) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distPointToSegmentFt(
  lat: number,
  lng: number,
  a: number[],
  b: number[]
): number {
  const midLat = (a[1] + b[1]) / 2;
  const feetLng = FEET_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const ax = 0;
  const ay = 0;
  const bx = (b[0] - a[0]) * feetLng;
  const by = (b[1] - a[1]) * FEET_PER_DEG_LAT;
  const px = (lng - a[0]) * feetLng;
  const py = (lat - a[1]) * FEET_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Minimum distance from a point to the ring boundary (0 if on an edge). */
export function distanceToRingFt(lat: number, lng: number, ring: number[][]): number {
  if (!ring || ring.length < 2) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length - 1; i++) {
    best = Math.min(best, distPointToSegmentFt(lat, lng, ring[i], ring[i + 1]));
  }
  best = Math.min(best, distPointToSegmentFt(lat, lng, ring[ring.length - 1], ring[0]));
  return best;
}

export function minDistanceToPolygonsFt(lat: number, lng: number, rings: number[][][]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    if (pointInRing(lng, lat, ring)) return 0;
    best = Math.min(best, distanceToRingFt(lat, lng, ring));
  }
  return best;
}

/** Minimum distance between two parcel rings (0 if they touch or overlap). */
export function minRingsDistanceFt(a?: number[][], b?: number[][]): number {
  if (!a?.length || !b?.length) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const pt of a) {
    if (pointInRing(pt[0], pt[1], b)) return 0;
    best = Math.min(best, distanceToRingFt(pt[1], pt[0], b));
  }
  for (const pt of b) {
    if (pointInRing(pt[0], pt[1], a)) return 0;
    best = Math.min(best, distanceToRingFt(pt[1], pt[0], a));
  }
  return best;
}

export function ringsIntersectParcel(structureRings: number[][][], parcelRing: number[][]): boolean {
  for (const ring of structureRings) {
    for (const pt of ring) {
      if (pointInRing(pt[0], pt[1], parcelRing)) return true;
    }
    const c = centroidFromRings([ring]);
    if (c && pointInRing(c.lng, c.lat, parcelRing)) return true;
  }
  const pc = centroidFromRings([parcelRing]);
  if (pc) {
    for (const ring of structureRings) {
      if (pointInRing(pc.lng, pc.lat, ring)) return true;
    }
  }
  return false;
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
  fetchImpl: typeof fetch = fetch,
  parcelRing?: number[][]
): Promise<import('./types').StructureFootprint[]> {
  const bbox = parcelRing
    ? expandBboxFeet(ringBBox(parcelRing), NEIGHBOR_ENVELOPE_FT)
    : {
        minX: lng - 0.0012,
        minY: lat - 0.0012,
        maxX: lng + 0.0012,
        maxY: lat + 0.0012,
      };
  try {
    const result = await queryArcGis(
      GIS.sdBuildings,
      {
        geometry: `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: '*',
        returnGeometry: 'true',
        outSR: '4326',
        resultRecordCount: '80',
      },
      fetchImpl
    );
    return (result.features || [])
      .filter((f: { geometry?: { rings?: number[][][] } }) => f.geometry?.rings)
      .map((f: { geometry: { rings: number[][][] }; attributes?: Record<string, any> }) => {
        const rings = f.geometry.rings;
        const published =
          Number(f.attributes?.['SDEP.SANGIS.BUILDING_OUTLINES.AREA']) ||
          Number(f.attributes?.AREA) ||
          0;
        const areaSqFt = Math.round(published || ringAreaSqFt(rings[0] || []));
        return {
          rings,
          areaSqFt,
          onSubjectParcel: parcelRing ? ringsIntersectParcel(rings, parcelRing) : undefined,
        };
      });
  } catch {
    return [];
  }
}

export interface WwSepticFlag {
  apn: string;
  designation: string;
  /** Representative parcel point — NOT a tank or leach location. */
  lat?: number;
  lng?: number;
}

export async function fetchWwSepticFlags(
  input: { apn?: string; bbox?: { minX: number; minY: number; maxX: number; maxY: number } },
  fetchImpl: typeof fetch = fetch
): Promise<WwSepticFlag[]> {
  const params: Record<string, string> = {
    outFields: 'APN,Sewer_Septic_Parcel_Designation',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '80',
  };
  if (input.apn) {
    const clean = cleanApn(input.apn);
    params.where = `APN='${clean}' OR APN='${formatApn(clean, 'san_diego')}'`;
  } else if (input.bbox) {
    const { minX, minY, maxX, maxY } = input.bbox;
    params.geometry = `${minX},${minY},${maxX},${maxY}`;
    params.geometryType = 'esriGeometryEnvelope';
    params.inSR = '4326';
    params.spatialRel = 'esriSpatialRelIntersects';
    params.where = '1=1';
  } else {
    return [];
  }
  try {
    const result = await queryArcGis(GIS.sdSeptic, params, fetchImpl);
    return (result.features || []).map((f: any) => ({
      apn: formatApn(f.attributes?.APN, 'san_diego'),
      designation: String(f.attributes?.Sewer_Septic_Parcel_Designation || 'Not Known'),
      lat: f.geometry?.y,
      lng: f.geometry?.x,
    }));
  } catch {
    return [];
  }
}

export async function fetchParcelsInEnvelope(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  fetchImpl: typeof fetch = fetch
): Promise<import('./types').ParcelInfo[]> {
  try {
    const result = await queryArcGis(
      GIS.sdParcels,
      {
        geometry: `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: SD_PARCEL_FIELDS,
        returnGeometry: 'true',
        outSR: '4326',
        resultRecordCount: '40',
      },
      fetchImpl
    );
    return (result.features || [])
      .map((f: any) => parcelFromSd(f.attributes, f.geometry, 'san_diego'))
      .filter(Boolean) as import('./types').ParcelInfo[];
  } catch {
    return [];
  }
}

export async function fetchRoadLabels(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  fetchImpl: typeof fetch = fetch
): Promise<import('./types').RoadLabel[]> {
  try {
    const result = await queryArcGis(
      GIS.sdRoads,
      {
        geometry: `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'RD20FULL,RD30FULL,ROAD_NAME,FENAME,NAME',
        returnGeometry: 'true',
        outSR: '4326',
        resultRecordCount: '20',
      },
      fetchImpl
    );
    const labels: import('./types').RoadLabel[] = [];
    for (const f of result.features || []) {
      const name =
        f.attributes?.RD20FULL ||
        f.attributes?.RD30FULL ||
        f.attributes?.ROAD_NAME ||
        f.attributes?.FENAME ||
        f.attributes?.NAME;
      if (!name) continue;
      const paths = f.geometry?.paths?.[0] || f.geometry?.rings?.[0];
      if (!paths?.length) continue;
      const mid = paths[Math.floor(paths.length / 2)];
      labels.push({ name: String(name), lng: mid[0], lat: mid[1] });
    }
    return labels;
  } catch {
    return [];
  }
}

export async function fetchAerialJpeg(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  size = { width: 1600, height: 1200 },
  fetchImpl: typeof fetch = fetch
): Promise<Uint8Array | null> {
  const url =
    GIS.worldImagery +
    '?' +
    new URLSearchParams({
      bbox: `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`,
      bboxSR: '4326',
      imageSR: '4326',
      size: `${size.width},${size.height}`,
      format: 'jpg',
      f: 'image',
    });
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'image/jpeg', 'User-Agent': 'SCWS-PermitResearch/1.0' },
    });
    if (!response.ok) return null;
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.length < 800 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    return buf;
  } catch {
    return null;
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
            outFields: RIV_PARCEL_FIELDS,
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
        outFields: RIV_PARCEL_FIELDS,
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
      RIV_PARCEL_FIELDS,
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
