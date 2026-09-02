import { GIS, haversineFeet, queryArcGis } from './gis.ts';
import { WELL_SEARCH_RADIUS_FT, type WellInfo } from './types.ts';

export async function fetchDwrWells(
  lat: number,
  lng: number,
  options?: { radiusFeet?: number; fetchImpl?: typeof fetch }
): Promise<WellInfo[]> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const radiusFeet = options?.radiusFeet ?? WELL_SEARCH_RADIUS_FT;
  const radiusMiles = radiusFeet / 5280;
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.cos((lat * Math.PI) / 180));
  const envelope = {
    xmin: lng - lngDelta,
    ymin: lat - latDelta,
    xmax: lng + lngDelta,
    ymax: lat + latDelta,
    spatialReference: { wkid: 4326 },
  };

  const result = await queryArcGis(
    GIS.dwrWells,
    {
      geometry: JSON.stringify(envelope),
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      inSR: '4326',
      outFields:
        'WCRNumber,APN,DateWorkEnded,TotalCompletedDepth,TopOfPerforatedInterval,BottomofPerforatedInterval,StaticWaterLevel,PlannedUseFormerUse,DecimalLatitude,DecimalLongitude',
      returnGeometry: 'false',
      resultRecordCount: '100',
    },
    fetchImpl
  );

  const wells: WellInfo[] = [];
  for (const feature of result.features || []) {
    const attrs = feature.attributes || {};
    const wellLat = attrs.DecimalLatitude;
    const wellLng = attrs.DecimalLongitude;
    if (!wellLat || !wellLng) continue;
    const distance = Math.round(haversineFeet(lat, lng, wellLat, wellLng));
    if (distance > radiusFeet) continue;
    wells.push({
      wcr_number: attrs.WCRNumber || '—',
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
    });
  }

  return wells.sort((a, b) => (a.distance_from_parcel || 0) - (b.distance_from_parcel || 0));
}
