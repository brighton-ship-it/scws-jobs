import { queryCnraWells } from '../wells/cnra.ts';
import { GIS, haversineFeet, lonLatTo3857, queryArcGis } from './gis.ts';
import { WELL_SEARCH_RADIUS_FT, type WellInfo } from './types.ts';

function mapDwrFeature(attrs: Record<string, any>, lat: number, lng: number, radiusFeet: number): WellInfo | null {
  const wellLat = attrs.DecimalLatitude;
  const wellLng = attrs.DecimalLongitude;
  if (!wellLat || !wellLng) return null;
  const distance = Math.round(haversineFeet(lat, lng, wellLat, wellLng));
  if (distance > radiusFeet) return null;
  return {
    wcr_number: attrs.WCRNumber || attrs.LegacyLogNumber || '—',
    apn: attrs.APN || undefined,
    date_work_ended: attrs.DateWorkEnded
      ? new Date(attrs.DateWorkEnded).toISOString().split('T')[0]
      : undefined,
    total_completed_depth: attrs.TotalCompletedDepth ?? undefined,
    top_of_perforations: attrs.TopOfPerforatedInterval ?? undefined,
    bottom_of_perforations: attrs.BottomofPerforatedInterval ?? undefined,
    static_water_level: attrs.StaticWaterLevel ?? undefined,
    well_use: attrs.PlannedUseFormerUse || undefined,
    latitude: wellLat,
    longitude: wellLng,
    distance_from_parcel: distance,
    source: 'DWR ArcGIS',
  };
}

async function fetchDwrArcGis(
  lat: number,
  lng: number,
  radiusFeet: number,
  fetchImpl: typeof fetch
): Promise<WellInfo[]> {
  const radiusMiles = radiusFeet / 5280;
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.cos((lat * Math.PI) / 180));
  const sw = lonLatTo3857(lng - lngDelta, lat - latDelta);
  const ne = lonLatTo3857(lng + lngDelta, lat + latDelta);
  const envelope = {
    xmin: Math.min(sw.x, ne.x),
    ymin: Math.min(sw.y, ne.y),
    xmax: Math.max(sw.x, ne.x),
    ymax: Math.max(sw.y, ne.y),
    spatialReference: { wkid: 3857 },
  };

  const result = await queryArcGis(
    GIS.dwrWells,
    {
      geometry: JSON.stringify(envelope),
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      inSR: '3857',
      outFields:
        'WCRNumber,LegacyLogNumber,APN,DateWorkEnded,TotalCompletedDepth,TopOfPerforatedInterval,BottomofPerforatedInterval,StaticWaterLevel,PlannedUseFormerUse,DecimalLatitude,DecimalLongitude',
      returnGeometry: 'false',
      resultRecordCount: '100',
    },
    fetchImpl
  );

  const wells: WellInfo[] = [];
  for (const feature of result.features || []) {
    const well = mapDwrFeature(feature.attributes || {}, lat, lng, radiusFeet);
    if (well) wells.push(well);
  }
  return wells;
}

async function fetchCnraAsWells(
  lat: number,
  lng: number,
  radiusFeet: number,
  fetchImpl: typeof fetch
): Promise<WellInfo[]> {
  const wells = await queryCnraWells(lat, lng, radiusFeet / 5280, fetchImpl);
  return wells
    .filter((w) => w.latitude != null && w.longitude != null)
    .map((w) => ({
      wcr_number: w.wcr_number || '—',
      date_work_ended: w.date_work_ended || undefined,
      total_completed_depth: w.total_drill_depth ?? undefined,
      static_water_level: w.static_water_level ?? undefined,
      well_use: w.planned_use || undefined,
      latitude: w.latitude as number,
      longitude: w.longitude as number,
      distance_from_parcel: w.distance_feet,
      source: 'CNRA WCR datastore',
    }));
}

function mergeWells(groups: WellInfo[][]): WellInfo[] {
  const byKey = new Map<string, WellInfo>();
  for (const group of groups) {
    for (const well of group) {
      const key = `${well.wcr_number}|${well.latitude.toFixed(5)}|${well.longitude.toFixed(5)}`;
      const prev = byKey.get(key);
      if (!prev || (well.distance_from_parcel || 9e9) < (prev.distance_from_parcel || 9e9)) {
        byKey.set(key, well);
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => (a.distance_from_parcel || 0) - (b.distance_from_parcel || 0));
}

export async function fetchDwrWells(
  lat: number,
  lng: number,
  options?: { radiusFeet?: number; fetchImpl?: typeof fetch }
): Promise<WellInfo[]> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const radiusFeet = options?.radiusFeet ?? WELL_SEARCH_RADIUS_FT;
  const groups: WellInfo[][] = [];
  let dwrError: Error | null = null;
  let cnraError: Error | null = null;

  try {
    groups.push(await fetchDwrArcGis(lat, lng, radiusFeet, fetchImpl));
  } catch (error) {
    dwrError = error instanceof Error ? error : new Error('DWR query failed');
  }

  try {
    groups.push(await fetchCnraAsWells(lat, lng, radiusFeet, fetchImpl));
  } catch (error) {
    cnraError = error instanceof Error ? error : new Error('CNRA query failed');
  }

  const merged = mergeWells(groups);
  if (dwrError && cnraError) {
    throw dwrError;
  }
  return merged;
}
