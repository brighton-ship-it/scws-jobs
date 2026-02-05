import { NextRequest, NextResponse } from 'next/server';
import { createApiClient } from '@/lib/supabase/api-client';

interface UtilityFeature {
  type: 'Feature';
  properties: {
    id: number;
    utility_type: string;
    source_table: string;
    city?: string;
    distance_meters?: number;
    water_system_name?: string;
    [key: string]: any;
  };
  geometry: any;
}

// Map of utility types to their respective tables
const UTILITY_TABLES: Record<string, string[]> = {
  sewer: ['sd_sewer_mains', 'sd_sewer_manholes', 'riverside_sewer_mains'],
  water: ['sd_water_mains', 'sd_water_hydrants'],
  storm: ['sd_storm_drains'],
  electric: ['ca_electric_transmission'],
  imperial: ['imperial_utilities'],
};

// Water service area tables (use point-in-polygon instead of distance)
const WATER_SERVICE_AREA_TABLES = [
  'sb_water_service_areas',
  'imperial_water_service_areas'
];

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
  const queryStats: Record<string, number> = {};
  
  // Also query water service areas for any water-related request
  if (types.includes('water')) {
    try {
      const { data, error } = await supabase.rpc('get_water_service_area_at_point', {
        p_lat: lat,
        p_lng: lng,
      });
      
      if (!error && data && data.length > 0) {
        queryStats['water_service_areas'] = data.length;
        sources.push('water_service_areas');
        
        for (const row of data) {
          features.push({
            type: 'Feature',
            properties: {
              id: row.id,
              utility_type: 'water_service_area',
              source_table: row.county?.toLowerCase().includes('imperial') 
                ? 'imperial_water_service_areas' 
                : 'sb_water_service_areas',
              water_system_name: row.water_system_name,
              water_system_number: row.water_system_number,
              county: row.county,
              population: row.population,
              service_connections: row.service_connections,
              regulating_agency: row.regulating_agency,
              verified_status: row.verified_status,
              distance_meters: 0, // Point is inside the service area
              ...(row.properties || {}),
            },
            geometry: row.geometry,
          });
        }
      } else if (error) {
        errors.push(`water_service_areas: ${error.message}`);
      }
    } catch (e: any) {
      errors.push(`water_service_areas exception: ${e.message}`);
    }
  }

  // Query each requested utility type using the PostGIS RPC function
  for (const utilType of types) {
    const tables = UTILITY_TABLES[utilType];
    if (!tables) continue;

    for (const tableName of tables) {
      try {
        const { data, error } = await supabase.rpc('get_nearby_utilities', {
          p_table_name: tableName,
          p_lat: lat,
          p_lng: lng,
          p_radius_meters: radius,
        });

        if (error) {
          // If RPC doesn't exist, fall back to manual query
          if (error.message?.includes('function') || error.code === '42883') {
            errors.push(`${tableName}: RPC not available, fallback needed`);
            continue;
          }
          errors.push(`${tableName}: ${error.message}`);
          continue;
        }

        queryStats[tableName] = data?.length || 0;

        if (data && data.length > 0) {
          sources.push(tableName);
          
          // Convert results to GeoJSON features
          for (const row of data) {
            features.push({
              type: 'Feature',
              properties: {
                id: row.id,
                utility_type: utilType,
                source_table: tableName,
                city: row.city || undefined,
                distance_meters: row.distance_meters,
                ...(row.properties || {}),
              },
              geometry: row.geometry,
            });
          }
        }
      } catch (e: any) {
        errors.push(`${tableName} exception: ${e.message}`);
      }
    }
  }

  // Sort by distance
  features.sort((a, b) => 
    (a.properties.distance_meters || 0) - (b.properties.distance_meters || 0)
  );

  return NextResponse.json({
    type: 'FeatureCollection',
    features,
    count: features.length,
    sources,
    debug: {
      center: { lat, lng },
      radius_meters: radius,
      requestedTypes: types,
      queryStats,
      errors: errors.length > 0 ? errors : undefined,
    },
  });
}
