import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Known coverage areas based on imported data
const COVERAGE_AREAS = {
  san_diego: {
    bounds: { minLat: 32.5, maxLat: 33.5, minLng: -117.6, maxLng: -116.0 },
    available: ['sewer', 'water', 'storm'],
    cities: ['San Diego', 'Chula Vista', 'Oceanside', 'Escondido', 'Carlsbad', 'El Cajon', 'Vista', 'San Marcos', 'Encinitas', 'National City', 'La Mesa', 'Santee', 'Poway'],
  },
  riverside: {
    bounds: { minLat: 33.2, maxLat: 34.1, minLng: -117.8, maxLng: -114.5 },
    available: ['sewer', 'storm'],
    cities: ['Riverside', 'Corona', 'Wildomar', 'Lake Elsinore', 'Murrieta', 'Temecula', 'Perris', 'Hemet', 'Palm Springs'],
    partial_coverage: ['sewer', 'storm'], // Not all areas have full data
  },
  statewide: {
    available: ['electric'],
    note: 'Transmission lines only - distribution data not available',
  },
};

// Cities/areas with NO utility data - always need 811
const NO_COVERAGE_AREAS = [
  // Anza-Borrego / Mountain Empire
  { name: 'Anza', lat: 33.55, lng: -116.67, radius: 20000 },
  { name: 'Borrego Springs', lat: 33.26, lng: -116.38, radius: 15000 },
  { name: 'Julian', lat: 33.08, lng: -116.60, radius: 10000 },
  { name: 'Pine Valley', lat: 32.82, lng: -116.53, radius: 8000 },
  { name: 'Campo', lat: 32.61, lng: -116.47, radius: 8000 },
  // Unincorporated Riverside County
  { name: 'Idyllwild', lat: 33.74, lng: -116.72, radius: 8000 },
  { name: 'Desert Hot Springs (unincorp)', lat: 33.96, lng: -116.50, radius: 10000 },
  { name: 'Thermal', lat: 33.64, lng: -116.14, radius: 10000 },
  { name: 'Mecca', lat: 33.57, lng: -116.07, radius: 8000 },
];

interface CoverageResult {
  hasCoverage: boolean;
  county?: string;
  availableTypes: string[];
  missingTypes: string[];
  nearestCity?: string;
  recommendation: string;
  call811: boolean;
  note?: string;
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

function getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function checkCoverage(lat: number, lng: number): CoverageResult {
  // Check if in known no-coverage area
  for (const area of NO_COVERAGE_AREAS) {
    const distance = getDistance(lat, lng, area.lat, area.lng);
    if (distance <= area.radius) {
      return {
        hasCoverage: false,
        availableTypes: [],
        missingTypes: ['sewer', 'water', 'storm', 'electric'],
        nearestCity: area.name,
        recommendation: `No utility data available for ${area.name} area. Call 811 before digging.`,
        call811: true,
        note: 'Rural/unincorporated area - utility records not digitized',
      };
    }
  }

  // Check San Diego County
  const sd = COVERAGE_AREAS.san_diego;
  if (lat >= sd.bounds.minLat && lat <= sd.bounds.maxLat && 
      lng >= sd.bounds.minLng && lng <= sd.bounds.maxLng) {
    return {
      hasCoverage: true,
      county: 'San Diego',
      availableTypes: ['sewer', 'water', 'storm', 'electric'],
      missingTypes: [],
      recommendation: 'Full utility data available. Verify with 811 before digging for safety.',
      call811: false, // Recommended but not required
      note: 'City of San Diego data is most complete. Unincorporated areas may have partial coverage.',
    };
  }

  // Check Riverside County
  const rv = COVERAGE_AREAS.riverside;
  if (lat >= rv.bounds.minLat && lat <= rv.bounds.maxLat && 
      lng >= rv.bounds.minLng && lng <= rv.bounds.maxLng) {
    return {
      hasCoverage: true,
      county: 'Riverside',
      availableTypes: ['sewer', 'storm', 'electric'],
      missingTypes: ['water'],
      recommendation: 'Partial utility data available. Water main data incomplete - recommend 811 call.',
      call811: true,
      note: 'City of Riverside and Corona have best coverage. Rural areas may be incomplete.',
    };
  }

  // Outside known coverage areas
  return {
    hasCoverage: false,
    availableTypes: ['electric'], // Statewide transmission data
    missingTypes: ['sewer', 'water', 'storm'],
    recommendation: 'Limited utility data. Call 811 before any excavation work.',
    call811: true,
    note: 'Location outside primary coverage area (San Diego/Riverside counties)',
  };
}

/**
 * GET /api/utilities/coverage
 * Check what utility data is available for a location
 * 
 * Query params:
 * - lat: latitude
 * - lng: longitude
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const lat = parseFloat(searchParams.get('lat') || '');
    const lng = parseFloat(searchParams.get('lng') || '');

    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json(
        { error: 'lat and lng are required' },
        { status: 400 }
      );
    }

    const coverage = checkCoverage(lat, lng);
    
    // Also check database for actual coverage records
    const supabase = createServiceClient();
    const { data: dbCoverage } = await supabase
      .from('utility_coverage')
      .select('county, city, utility_type, feature_count, last_updated')
      .order('feature_count', { ascending: false });

    return NextResponse.json({
      ...coverage,
      lat,
      lng,
      databaseCoverage: dbCoverage || [],
      call811_number: '811',
      call811_url: 'https://call811.com',
    });
  } catch (error) {
    console.error('Coverage API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
