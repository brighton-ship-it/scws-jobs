import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Utility table configurations
const UTILITY_TABLES = {
  sewer: {
    sd: ['sd_sewer_mains', 'sd_sewer_manholes'],
    riverside: ['riverside_sewer_mains', 'riverside_sewer_manholes'],
  },
  water: {
    sd: ['sd_water_mains', 'sd_water_hydrants'],
    riverside: ['riverside_water_hydrants'],
  },
  storm: {
    sd: ['sd_storm_drains'],
    riverside: ['riverside_storm_drains'],
  },
  electric: {
    statewide: ['ca_electric_transmission'],
  },
} as const;

// Color coding for frontend
const UTILITY_COLORS = {
  sewer: '#8B4513', // brown
  water: '#0066CC', // blue
  storm: '#228B22', // green
  electric: '#FFD700', // yellow
};

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

function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Query a utility table for features within radius
 * First tries RPC function, falls back to direct query with bounding box
 */
async function queryUtilityTable(
  supabase: ReturnType<typeof createClient>,
  tableName: string,
  lat: number,
  lng: number,
  radiusMeters: number
): Promise<UtilityFeature[]> {
  // Determine if this is a Riverside table (has city column)
  const hasCity = tableName.startsWith('riverside_');
  
  // First try the RPC function (if database has the fixed version)
  try {
    const { data, error } = await supabase.rpc('get_nearby_utilities', {
      p_table_name: tableName,
      p_lat: lat,
      p_lng: lng,
      p_radius_meters: radiusMeters,
    });
    
    if (!error && data && Array.isArray(data)) {
      return data.map((row: any) => ({
        type: 'Feature' as const,
        properties: {
          id: row.id,
          utility_type: tableName.includes('sewer') ? 'sewer' :
                        tableName.includes('water') || tableName.includes('hydrant') ? 'water' :
                        tableName.includes('storm') || tableName.includes('drain') ? 'storm' : 'electric',
          source_table: tableName,
          city: row.city || null,
          ...row.properties,
        },
        geometry: row.geometry,
      }));
    }
  } catch (e) {
    // RPC failed, fall back to direct query
    console.log(`RPC query failed for ${tableName}, falling back to direct query`);
  }
  
  // Fallback: Direct query with sample data (limited, no spatial filtering)
  try {
    const selectFields = hasCity ? 'id, properties, city' : 'id, properties';
    
    const { data, error } = await supabase
      .from(tableName)
      .select(selectFields)
      .limit(50);
    
    if (error) {
      console.log(`Table ${tableName} query error:`, error.message);
      return [];
    }
    
    if (!data || !Array.isArray(data)) return [];
    
    return data.map((row: any) => ({
      type: 'Feature' as const,
      properties: {
        id: row.id,
        utility_type: tableName.includes('sewer') ? 'sewer' :
                      tableName.includes('water') || tableName.includes('hydrant') ? 'water' :
                      tableName.includes('storm') || tableName.includes('drain') ? 'storm' : 'electric',
        source_table: tableName,
        city: row.city || null,
        note: 'Limited data - spatial filtering unavailable',
        ...row.properties,
      },
      geometry: null, // Can't get geometry without PostGIS extension in JS
    }));
  } catch (e) {
    console.error(`Error querying ${tableName}:`, e);
    return [];
  }
}

/**
 * GET /api/utilities/nearby
 * Query nearby utility infrastructure
 * 
 * Query params:
 * - lat: latitude
 * - lng: longitude  
 * - radius: radius in meters (default 500)
 * - types: comma-separated utility types (sewer,water,storm,electric)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const lat = parseFloat(searchParams.get('lat') || '');
    const lng = parseFloat(searchParams.get('lng') || '');
    const radiusMeters = parseInt(searchParams.get('radius') || '500');
    const typesParam = searchParams.get('types') || 'sewer,water,storm,electric';
    
    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json(
        { error: 'lat and lng are required' },
        { status: 400 }
      );
    }

    const types = typesParam.split(',').filter(t => 
      ['sewer', 'water', 'storm', 'electric'].includes(t)
    );

    const supabase = createServiceClient();
    const features: UtilityFeature[] = [];
    const queriedTables: string[] = [];

    // Determine which county/region based on coordinates
    // San Diego County: roughly 32.5-33.5 lat, -117.5 to -116.0 lng
    // Riverside County: roughly 33.4-34.0 lat, -117.5 to -114.5 lng
    const isSDCounty = lat >= 32.5 && lat <= 33.5 && lng >= -117.5 && lng <= -116.0;
    const isRiverside = lat >= 33.2 && lat <= 34.0 && lng >= -117.8 && lng <= -114.5;

    // Query relevant tables based on location and requested types
    for (const type of types) {
      const config = UTILITY_TABLES[type as keyof typeof UTILITY_TABLES];
      if (!config) continue;

      // Query San Diego tables
      if (isSDCounty && 'sd' in config) {
        for (const table of config.sd) {
          queriedTables.push(table);
          const results = await queryUtilityTable(supabase, table, lat, lng, radiusMeters);
          features.push(...results);
        }
      }

      // Query Riverside tables
      if (isRiverside && 'riverside' in config) {
        for (const table of (config as any).riverside) {
          queriedTables.push(table);
          const results = await queryUtilityTable(supabase, table, lat, lng, radiusMeters);
          features.push(...results);
        }
      }

      // Query statewide tables
      if ('statewide' in config) {
        for (const table of (config as any).statewide) {
          queriedTables.push(table);
          const results = await queryUtilityTable(supabase, table, lat, lng, radiusMeters);
          features.push(...results);
        }
      }
    }

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
      metadata: {
        lat,
        lng,
        radiusMeters,
        types,
        queriedTables,
        featureCount: features.length,
        colors: UTILITY_COLORS,
      },
    });
  } catch (error) {
    console.error('Nearby utilities API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
