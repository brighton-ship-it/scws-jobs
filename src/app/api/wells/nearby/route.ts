import { NextRequest, NextResponse } from 'next/server';

// Query CA DWR ArcGIS API directly (same as permit research)
const DWR_WELLS_ENDPOINT = 'https://gis.water.ca.gov/arcgis/rest/services/Environment/i07_WellCompletionReports/FeatureServer/0/query';

// Property line setbacks by county (feet)
const SETBACKS: Record<string, number> = {
  'San Diego': 10,
  'Riverside': 50,
  'San Bernardino': 20
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat') || '0');
  const lng = parseFloat(searchParams.get('lng') || '0');
  const radiusMiles = parseFloat(searchParams.get('radius') || '2');
  const county = searchParams.get('county') || 'all';

  if (!lat || !lng) {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 });
  }

  try {
    // Convert miles to degrees for bounding box
    const latDelta = radiusMiles / 69;
    const lngDelta = radiusMiles / (69 * Math.cos(lat * Math.PI / 180));

    // Create envelope (bounding box) for query
    const envelope = {
      xmin: lng - lngDelta,
      ymin: lat - latDelta,
      xmax: lng + lngDelta,
      ymax: lat + latDelta,
      spatialReference: { wkid: 4326 }
    };

    // Query CA DWR ArcGIS API
    const params = new URLSearchParams({
      geometry: JSON.stringify(envelope),
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'WCRNumber,APN,DateWorkEnded,TotalCompletedDepth,TopOfPerforatedInterval,BottomofPerforatedInterval,StaticWaterLevel,PlannedUseFormerUse,DecimalLatitude,DecimalLongitude,WellYieldUnitOfMeasure,WellYield,CountyName,MTRS,DrillingMethod',
      returnGeometry: 'false',
      resultRecordCount: '500',
      f: 'json'
    });

    const response = await fetch(`${DWR_WELLS_ENDPOINT}?${params}`, {
      headers: { 'User-Agent': 'SCWS-WellLookup/1.0' }
    });

    if (!response.ok) {
      throw new Error(`DWR API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || 'DWR API error');
    }

    // Transform to our format and calculate distances
    const wells = (data.features || []).map((f: any) => {
      const attrs = f.attributes;
      const wellLat = attrs.DecimalLatitude;
      const wellLng = attrs.DecimalLongitude;
      
      // Calculate distance
      let distanceMiles = 0;
      if (wellLat && wellLng) {
        const dLat = (wellLat - lat) * 69;
        const dLng = (wellLng - lng) * 69 * Math.cos(lat * Math.PI / 180);
        distanceMiles = Math.sqrt(dLat * dLat + dLng * dLng);
      }

      return {
        wcr_number: attrs.WCRNumber,
        apn: attrs.APN,
        total_drill_depth: attrs.TotalCompletedDepth,
        static_water_level: attrs.StaticWaterLevel,
        well_yield: attrs.WellYield,
        well_yield_unit: attrs.WellYieldUnitOfMeasure,
        date_work_ended: attrs.DateWorkEnded ? new Date(attrs.DateWorkEnded).toISOString().split('T')[0] : null,
        drilling_method: attrs.DrillingMethod,
        planned_use: attrs.PlannedUseFormerUse,
        county: attrs.CountyName,
        mtrs: attrs.MTRS,
        latitude: wellLat,
        longitude: wellLng,
        distance_miles: Math.round(distanceMiles * 100) / 100,
        distance_feet: Math.round(distanceMiles * 5280)
      };
    })
    .filter((w: any) => w.latitude && w.longitude) // Only wells with coordinates
    .sort((a: any, b: any) => a.distance_miles - b.distance_miles);

    // Calculate stats
    const depths = wells
      .filter((w: any) => w.total_drill_depth && w.total_drill_depth > 0)
      .map((w: any) => w.total_drill_depth);
    
    const yields = wells
      .filter((w: any) => w.well_yield && w.well_yield > 0)
      .map((w: any) => w.well_yield);

    // Determine county from first result or default
    const detectedCounty = wells[0]?.county || county;

    const stats = {
      totalWells: wells.length,
      avgDepth: depths.length ? Math.round(depths.reduce((a: number, b: number) => a + b, 0) / depths.length) : null,
      minDepth: depths.length ? Math.min(...depths) : null,
      maxDepth: depths.length ? Math.max(...depths) : null,
      avgYield: yields.length ? Math.round(yields.reduce((a: number, b: number) => a + b, 0) / yields.length * 10) / 10 : null,
      setbackFeet: SETBACKS[detectedCounty] || 50,
      radiusMiles
    };

    return NextResponse.json({
      wells: wells.slice(0, 50), // Return top 50 nearest
      stats,
      setbacks: SETBACKS,
      source: 'CA DWR Well Completion Reports'
    });

  } catch (err: any) {
    console.error('Wells API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
