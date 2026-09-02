import { haversineMiles, isDomesticWell } from '../jobber/dwr.ts';

/** Official CA DWR Well Completion Reports index on data.cnra.ca.gov (CKAN datastore). */
export const CNRA_WCR_RESOURCE_ID = '8da7b93b-4e69-495d-9caa-335691a1896b';
export const CNRA_DATASTORE_SQL = 'https://data.cnra.ca.gov/api/3/action/datastore_search_sql';

export type NearbyWell = {
  wcr_number: string | null;
  total_drill_depth: number | null;
  well_yield: number | null;
  well_yield_unit: string | null;
  static_water_level: number | null;
  date_work_ended: string | null;
  drilling_method: string | null;
  planned_use: string | null;
  county: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_miles: number;
  distance_feet: number;
};

export type CnraRecord = Record<string, unknown>;

export function parseSignedNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parseWellNumber(value: unknown): number | null {
  const n = parseSignedNumber(value);
  return n != null && n > 0 ? n : null;
}

export function parseWellDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && value > 1e11) {
    return new Date(value).toISOString().split('T')[0] ?? null;
  }
  const text = String(value);
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const mdY = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdY) {
    const mm = mdY[1].padStart(2, '0');
    const dd = mdY[2].padStart(2, '0');
    return `${mdY[3]}-${mm}-${dd}`;
  }
  return text.slice(0, 10);
}

export function bboxForRadius(lat: number, lng: number, radiusMiles: number) {
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

export function buildCnraSql(lat: number, lng: number, radiusMiles: number, limit = 200): string {
  if (![lat, lng, radiusMiles, limit].every(Number.isFinite)) {
    throw new Error('Invalid CNRA query numbers');
  }
  const box = bboxForRadius(lat, lng, radiusMiles);
  const fmt = (n: number) => n.toFixed(6);
  return [
    'SELECT "WCRNUMBER","CITY","COUNTYNAME","TOTALCOMPLETEDDEPTH","STATICWATERLEVEL",',
    '"WELLYIELD","WELLYIELDUNITOFMEASURE","DRILLINGMETHOD","PLANNEDUSEFORMERUSE",',
    '"DECIMALLATITUDE","DECIMALLONGITUDE","DATEWORKENDED","RECORDTYPE"',
    `FROM "${CNRA_WCR_RESOURCE_ID}"`,
    `WHERE "DECIMALLATITUDE" BETWEEN ${fmt(box.minLat)} AND ${fmt(box.maxLat)}`,
    `AND "DECIMALLONGITUDE" BETWEEN ${fmt(box.minLng)} AND ${fmt(box.maxLng)}`,
    'AND "DECIMALLATITUDE" IS NOT NULL',
    'AND "DECIMALLONGITUDE" IS NOT NULL',
    `LIMIT ${Math.min(Math.max(Math.trunc(limit), 1), 500)}`,
  ].join(' ');
}

export function mapCnraRecord(record: CnraRecord, origin: { lat: number; lng: number }): NearbyWell | null {
  const lat = parseSignedNumber(record.DECIMALLATITUDE);
  const lng = parseSignedNumber(record.DECIMALLONGITUDE);
  if (lat == null || lng == null) return null;
  // Longitude in CA must be west (negative). Reject swapped / zero points.
  if (lng > -110 || lng < -125 || lat < 32 || lat > 42) return null;
  const miles = haversineMiles(origin.lat, origin.lng, lat, lng);
  const wcr = record.WCRNUMBER == null ? null : String(record.WCRNUMBER).trim() || null;
  return {
    wcr_number: wcr,
    total_drill_depth: parseWellNumber(record.TOTALCOMPLETEDDEPTH),
    well_yield: parseWellNumber(record.WELLYIELD),
    well_yield_unit: record.WELLYIELDUNITOFMEASURE ? String(record.WELLYIELDUNITOFMEASURE) : null,
    static_water_level: parseWellNumber(record.STATICWATERLEVEL),
    date_work_ended: parseWellDate(record.DATEWORKENDED),
    drilling_method: record.DRILLINGMETHOD ? String(record.DRILLINGMETHOD) : null,
    planned_use: record.PLANNEDUSEFORMERUSE ? String(record.PLANNEDUSEFORMERUSE) : null,
    county: record.COUNTYNAME ? String(record.COUNTYNAME) : null,
    city: record.CITY ? String(record.CITY) : null,
    latitude: lat,
    longitude: lng,
    distance_miles: Math.round(miles * 100) / 100,
    distance_feet: Math.round(miles * 5280),
  };
}

export function filterByRadius(wells: NearbyWell[], radiusMiles: number): NearbyWell[] {
  return wells
    .filter((well) => well.distance_miles <= radiusMiles + 0.01)
    .sort((a, b) => a.distance_miles - b.distance_miles);
}

export async function queryCnraWells(
  lat: number,
  lng: number,
  radiusMiles: number,
  fetchImpl: typeof fetch = fetch
): Promise<NearbyWell[]> {
  const sql = buildCnraSql(lat, lng, radiusMiles * 1.15, 200);
  const url = `${CNRA_DATASTORE_SQL}?${new URLSearchParams({ sql }).toString()}`;
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': 'SCWS-WellLookup/1.0 (office@scwellservice.com)',
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`CNRA WCR API error: ${response.status}`);
  }
  const data = (await response.json()) as {
    success?: boolean;
    error?: { message?: string };
    result?: { records?: CnraRecord[] };
  };
  if (data.success === false) {
    throw new Error(data.error?.message || 'CNRA WCR query failed');
  }
  const records = data.result?.records || [];
  const mapped: NearbyWell[] = [];
  for (const record of records) {
    const well = mapCnraRecord(record, { lat, lng });
    if (well) mapped.push(well);
  }
  return filterByRadius(mapped, radiusMiles);
}

export function wellsWithDepth(wells: NearbyWell[]): NearbyWell[] {
  return wells.filter((well) => well.total_drill_depth && well.total_drill_depth > 0);
}

export function domesticWellsWithDepth(wells: NearbyWell[]): NearbyWell[] {
  return wellsWithDepth(wells).filter((well) => isDomesticWell(well.planned_use));
}
