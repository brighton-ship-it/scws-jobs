/**
 * CA DWR Well Completion Reports — same FeatureServer as /api/wells/nearby
 * and permit research.
 */

export const DWR_WELLS_ENDPOINT =
  'https://gis.water.ca.gov/arcgis/rest/services/Environment/i07_WellCompletionReports/FeatureServer/0/query';

export type WcrSample = {
  wcr_number: string | null;
  apn: string | null;
  total_completed_depth: number | null;
  planned_use: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_miles: number | null;
  drilling_method: string | null;
};

export type DwrEstimate =
  | {
      ok: true;
      footageFt: number;
      medianDepth: number;
      sampleSize: number;
      wells: WcrSample[];
    }
  | {
      ok: false;
      reason: 'no_dwr_rows' | 'no_domestic_depth';
      wells: WcrSample[];
    };

const DOMESTIC_RE = /\b(domestic|home|residential|house|single[\s-]?family)\b/i;
const NON_DOMESTIC_RE =
  /\b(monitor|monitoring|cathodic|destruction|injection|test hole|geotechnical)\b/i;

export function isDomesticWell(plannedUse: string | null | undefined): boolean {
  const text = plannedUse || '';
  if (NON_DOMESTIC_RE.test(text) && !DOMESTIC_RE.test(text)) return false;
  return DOMESTIC_RE.test(text);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/** Street footage is the nearby domestic median, rounded to 10 ft. */
export function roundFootage(depthFt: number): number {
  return Math.max(10, Math.round(depthFt / 10) * 10);
}

export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = (lat2 - lat1) * 69;
  const dLng = (lng2 - lng1) * 69 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function estimateFootageFromWcrs(wells: WcrSample[]): DwrEstimate {
  if (wells.length === 0) {
    return { ok: false, reason: 'no_dwr_rows', wells };
  }

  const domesticDepths = wells
    .filter((well) => isDomesticWell(well.planned_use))
    .map((well) => well.total_completed_depth)
    .filter((depth): depth is number => typeof depth === 'number' && depth > 0);

  const medianDepth = median(domesticDepths);
  if (medianDepth == null) {
    return { ok: false, reason: 'no_domestic_depth', wells };
  }

  return {
    ok: true,
    footageFt: roundFootage(medianDepth),
    medianDepth,
    sampleSize: domesticDepths.length,
    wells,
  };
}

export async function queryNearbyWcrs(
  lat: number,
  lng: number,
  options?: { radiusMiles?: number; fetchImpl?: typeof fetch }
): Promise<WcrSample[]> {
  const radiusMiles = options?.radiusMiles ?? 2;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.cos((lat * Math.PI) / 180));

  const envelope = {
    xmin: lng - lngDelta,
    ymin: lat - latDelta,
    xmax: lng + lngDelta,
    ymax: lat + latDelta,
    spatialReference: { wkid: 4326 },
  };

  const params = new URLSearchParams({
    geometry: JSON.stringify(envelope),
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields:
      'WCRNumber,APN,DateWorkEnded,TotalCompletedDepth,PlannedUseFormerUse,DecimalLatitude,DecimalLongitude,CountyName,DrillingMethod',
    returnGeometry: 'false',
    resultRecordCount: '200',
    f: 'json',
  });

  const response = await fetchImpl(`${DWR_WELLS_ENDPOINT}?${params}`, {
    headers: { 'User-Agent': 'SCWS-DrillQuote/1.0' },
  });
  if (!response.ok) {
    throw new Error(`DWR API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    error?: { message?: string };
    features?: Array<{ attributes?: Record<string, any> }>;
  };
  if (data.error) {
    throw new Error(data.error.message || 'DWR API error');
  }

  return (data.features || [])
    .map((feature) => {
      const attrs = feature.attributes || {};
      const wellLat = attrs.DecimalLatitude ?? null;
      const wellLng = attrs.DecimalLongitude ?? null;
      const distance =
        wellLat != null && wellLng != null ? haversineMiles(lat, lng, wellLat, wellLng) : null;
      return {
        wcr_number: attrs.WCRNumber ?? null,
        apn: attrs.APN ?? null,
        total_completed_depth: attrs.TotalCompletedDepth ?? null,
        planned_use: attrs.PlannedUseFormerUse ?? null,
        county: attrs.CountyName ?? null,
        latitude: wellLat,
        longitude: wellLng,
        distance_miles: distance != null ? Math.round(distance * 100) / 100 : null,
        drilling_method: attrs.DrillingMethod ?? null,
      } satisfies WcrSample;
    })
    .filter((well) => well.latitude && well.longitude)
    .sort((a, b) => (a.distance_miles ?? 99) - (b.distance_miles ?? 99));
}
