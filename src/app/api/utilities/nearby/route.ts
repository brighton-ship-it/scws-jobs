import { NextRequest, NextResponse } from 'next/server';
import { createApiClient } from '@/lib/supabase/api-client';

interface UtilityFeature {
  type: 'Feature';
  properties: {
    id: number;
    utility_type: string;
    source_table: string;
    city?: string;
    [key: string]: any;
  };
  geometry: any;
}

// Helper to check if a geometry intersects with bounding box
function geometryIntersectsBbox(geometry: any, minLng: number, maxLng: number, minLat: number, maxLat: number): boolean {
  if (!geometry || !geometry.coordinates) return false;
  
  try {
    const type = geometry.type;
    
    if (type === 'Point') {
      const [lng, lat] = geometry.coordinates;
      return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
    }
    
    if (type === 'LineString') {
      return geometry.coordinates.some(([lng, lat]: number[]) => 
        lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat
      );
    }
    
    if (type === 'MultiLineString') {
      return geometry.coordinates.some((line: number[][]) =>
        line.some(([lng, lat]: number[]) => 
          lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat
        )
      );
    }
    
    if (type === 'Polygon') {
      return geometry.coordinates[0].some(([lng, lat]: number[]) => 
        lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat
      );
    }
    
    return false;
  } catch (e) {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = parseFloat(searchParams.get('lat') || '0');
  const lng = parseFloat(searchParams.get('lng') || '0');
  const radius = parseInt(searchParams.get('radius') || '500'); // meters
  const types = searchParams.get('types')?.split(',') || ['sewer', 'water', 'storm'];

  if (!lat || !lng) {
    return NextResponse.json({ error: 'Missing lat/lng parameters' }, { status: 400 });
  }

  const supabase = createApiClient();
  const features: UtilityFeature[] = [];
  const sources: string[] = [];
  const errors: string[] = [];
  const queryStats: any = {};

  // Convert radius to degrees (rough approximation: 1 degree ≈ 111km)
  const radiusDegrees = radius / 111000;
  const minLat = lat - radiusDegrees;
  const maxLat = lat + radiusDegrees;
  const minLng = lng - radiusDegrees;
  const maxLng = lng + radiusDegrees;

  // Query San Diego sewer mains - columns are: id, properties (jsonb), geometry, created_at
  if (types.includes('sewer')) {
    try {
      const { data: sdSewer, error: sdSewerErr } = await supabase
        .from('sd_sewer_mains')
        .select('id, properties, geometry')
        .limit(500);

      queryStats.sd_sewer_raw = sdSewer?.length || 0;
      
      if (sdSewerErr) {
        errors.push(`sd_sewer_mains: ${sdSewerErr.message}`);
      } else if (sdSewer && sdSewer.length > 0) {
        const filtered = sdSewer.filter((row: any) => 
          geometryIntersectsBbox(row.geometry, minLng, maxLng, minLat, maxLat)
        );
        
        queryStats.sd_sewer_filtered = filtered.length;
        
        if (filtered.length > 0) {
          sources.push('sd_sewer_mains');
          filtered.slice(0, 200).forEach((row: any) => {
            features.push({
              type: 'Feature',
              properties: {
                id: row.id,
                utility_type: 'sewer',
                source_table: 'sd_sewer_mains',
                city: 'San Diego',
                ...(row.properties || {}),
              },
              geometry: row.geometry,
            });
          });
        }
      }
    } catch (e: any) {
      errors.push(`sd_sewer_mains exception: ${e.message}`);
    }

    // Query Riverside sewer mains - columns: id, city, properties, geometry, created_at
    try {
      const { data: rvSewer, error: rvSewerErr } = await supabase
        .from('riverside_sewer_mains')
        .select('id, city, properties, geometry')
        .limit(500);

      queryStats.rv_sewer_raw = rvSewer?.length || 0;
      
      if (rvSewerErr) {
        errors.push(`riverside_sewer_mains: ${rvSewerErr.message}`);
      } else if (rvSewer && rvSewer.length > 0) {
        const filtered = rvSewer.filter((row: any) => 
          geometryIntersectsBbox(row.geometry, minLng, maxLng, minLat, maxLat)
        );
        
        queryStats.rv_sewer_filtered = filtered.length;
        
        if (filtered.length > 0) {
          sources.push('riverside_sewer_mains');
          filtered.slice(0, 200).forEach((row: any) => {
            features.push({
              type: 'Feature',
              properties: {
                id: row.id,
                utility_type: 'sewer',
                source_table: 'riverside_sewer_mains',
                city: row.city || 'Riverside County',
                ...(row.properties || {}),
              },
              geometry: row.geometry,
            });
          });
        }
      }
    } catch (e: any) {
      errors.push(`riverside_sewer_mains exception: ${e.message}`);
    }
  }

  // Query San Diego water mains - columns: id, properties, geometry, created_at
  if (types.includes('water')) {
    try {
      const { data: sdWater, error: sdWaterErr } = await supabase
        .from('sd_water_mains')
        .select('id, properties, geometry')
        .limit(500);

      queryStats.sd_water_raw = sdWater?.length || 0;
      
      if (sdWaterErr) {
        errors.push(`sd_water_mains: ${sdWaterErr.message}`);
      } else if (sdWater && sdWater.length > 0) {
        const filtered = sdWater.filter((row: any) => 
          geometryIntersectsBbox(row.geometry, minLng, maxLng, minLat, maxLat)
        );
        
        queryStats.sd_water_filtered = filtered.length;
        
        if (filtered.length > 0) {
          sources.push('sd_water_mains');
          filtered.slice(0, 200).forEach((row: any) => {
            features.push({
              type: 'Feature',
              properties: {
                id: row.id,
                utility_type: 'water',
                source_table: 'sd_water_mains',
                city: 'San Diego',
                ...(row.properties || {}),
              },
              geometry: row.geometry,
            });
          });
        }
      }
    } catch (e: any) {
      errors.push(`sd_water_mains exception: ${e.message}`);
    }
  }

  // Query San Diego storm drains - columns: id, properties, geometry, created_at
  if (types.includes('storm')) {
    try {
      const { data: sdStorm, error: sdStormErr } = await supabase
        .from('sd_storm_drains')
        .select('id, properties, geometry')
        .limit(500);

      queryStats.sd_storm_raw = sdStorm?.length || 0;
      
      if (sdStormErr) {
        errors.push(`sd_storm_drains: ${sdStormErr.message}`);
      } else if (sdStorm && sdStorm.length > 0) {
        const filtered = sdStorm.filter((row: any) => 
          geometryIntersectsBbox(row.geometry, minLng, maxLng, minLat, maxLat)
        );
        
        queryStats.sd_storm_filtered = filtered.length;
        
        if (filtered.length > 0) {
          sources.push('sd_storm_drains');
          filtered.slice(0, 200).forEach((row: any) => {
            features.push({
              type: 'Feature',
              properties: {
                id: row.id,
                utility_type: 'storm',
                source_table: 'sd_storm_drains',
                city: 'San Diego',
                ...(row.properties || {}),
              },
              geometry: row.geometry,
            });
          });
        }
      }
    } catch (e: any) {
      errors.push(`sd_storm_drains exception: ${e.message}`);
    }
  }

  return NextResponse.json({
    type: 'FeatureCollection',
    features,
    count: features.length,
    sources,
    debug: {
      bbox: { minLat, maxLat, minLng, maxLng },
      requestedTypes: types,
      queryStats,
      errors: errors.length > 0 ? errors : undefined,
    }
  });
}
