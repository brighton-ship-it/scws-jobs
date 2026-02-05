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

interface GeoJSONResponse {
  type: 'FeatureCollection';
  features: UtilityFeature[];
  count: number;
  sources: string[];
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

  try {
    const supabase = createApiClient();
    const features: UtilityFeature[] = [];
    const sources: string[] = [];

    // Convert radius to degrees (rough approximation: 1 degree ≈ 111km)
    const radiusDegrees = radius / 111000;
    const minLat = lat - radiusDegrees;
    const maxLat = lat + radiusDegrees;
    const minLng = lng - radiusDegrees;
    const maxLng = lng + radiusDegrees;

    // Query San Diego sewer mains
    if (types.includes('sewer')) {
      try {
        const { data: sdSewer, error: sdSewerErr } = await supabase
          .from('sd_sewer_mains')
          .select('id, geometry, facilityid, diameter, material')
          .not('geometry', 'is', null)
          .limit(1000);

        if (!sdSewerErr && sdSewer) {
          const filtered = sdSewer.filter((row: any) => 
            geometryIntersectsBbox(row.geometry, minLng, maxLng, minLat, maxLat)
          );
          
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
                  facilityid: row.facilityid,
                  diameter: row.diameter,
                  material: row.material,
                },
                geometry: row.geometry,
              });
            });
          }
        }
      } catch (e) {
        console.error('Error querying sd_sewer_mains:', e);
      }

      // Query Riverside sewer mains
      try {
        const { data: rvSewer, error: rvSewerErr } = await supabase
          .from('riverside_sewer_mains')
          .select('id, geometry, source_city, pipe_size, material')
          .not('geometry', 'is', null)
          .limit(1000);

        if (!rvSewerErr && rvSewer) {
          const filtered = rvSewer.filter((row: any) => 
            geometryIntersectsBbox(row.geometry, minLng, maxLng, minLat, maxLat)
          );
          
          if (filtered.length > 0) {
            sources.push('riverside_sewer_mains');
            filtered.slice(0, 200).forEach((row: any) => {
              features.push({
                type: 'Feature',
                properties: {
                  id: row.id,
                  utility_type: 'sewer',
                  source_table: 'riverside_sewer_mains',
                  city: row.source_city || 'Riverside County',
                  pipe_size: row.pipe_size,
                  material: row.material,
                },
                geometry: row.geometry,
              });
            });
          }
        }
      } catch (e) {
        console.error('Error querying riverside_sewer_mains:', e);
      }
    }

    // Query San Diego water mains
    if (types.includes('water')) {
      try {
        const { data: sdWater, error: sdWaterErr } = await supabase
          .from('sd_water_mains')
          .select('id, geometry, facilityid, diameter, material')
          .not('geometry', 'is', null)
          .limit(1000);

        if (!sdWaterErr && sdWater) {
          const filtered = sdWater.filter((row: any) => 
            geometryIntersectsBbox(row.geometry, minLng, maxLng, minLat, maxLat)
          );
          
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
                  facilityid: row.facilityid,
                  diameter: row.diameter,
                  material: row.material,
                },
                geometry: row.geometry,
              });
            });
          }
        }
      } catch (e) {
        console.error('Error querying sd_water_mains:', e);
      }
    }

    // Query San Diego storm drains
    if (types.includes('storm')) {
      try {
        const { data: sdStorm, error: sdStormErr } = await supabase
          .from('sd_storm_drains')
          .select('id, geometry, facilityid, diameter')
          .not('geometry', 'is', null)
          .limit(1000);

        if (!sdStormErr && sdStorm) {
          const filtered = sdStorm.filter((row: any) => 
            geometryIntersectsBbox(row.geometry, minLng, maxLng, minLat, maxLat)
          );
          
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
                  facilityid: row.facilityid,
                  diameter: row.diameter,
                },
                geometry: row.geometry,
              });
            });
          }
        }
      } catch (e) {
        console.error('Error querying sd_storm_drains:', e);
      }
    }

    const response: GeoJSONResponse = {
      type: 'FeatureCollection',
      features,
      count: features.length,
      sources,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching nearby utilities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch nearby utilities', features: [], count: 0 },
      { status: 500 }
    );
  }
}
