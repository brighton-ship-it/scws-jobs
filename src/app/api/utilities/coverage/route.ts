import { NextRequest, NextResponse } from 'next/server';
import { createApiClient } from '@/lib/supabase/api-client';

interface UtilityCoverage {
  hasCoverage: boolean;
  county?: string;
  availableTypes: string[];
  missingTypes: string[];
  recommendation: string;
  call811: boolean;
  note?: string;
}

// Define which utilities we track and where we have data
const UTILITY_COVERAGE_MAP: Record<string, { cities: string[]; types: string[] }> = {
  'San Diego': {
    cities: ['San Diego', 'City of San Diego'],
    types: ['sewer', 'water', 'storm'],
  },
  'Riverside': {
    cities: ['Riverside', 'Corona', 'Wildomar', 'Temecula', 'Murrieta', 'Lake Elsinore', 'Hemet', 'San Jacinto', 'Perris', 'Moreno Valley'],
    types: ['sewer'],
  },
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = parseFloat(searchParams.get('lat') || '0');
  const lng = parseFloat(searchParams.get('lng') || '0');

  if (!lat || !lng) {
    return NextResponse.json({ error: 'Missing lat/lng parameters' }, { status: 400 });
  }

  try {
    const supabase = createApiClient();

    // Determine county based on coordinates (rough bounding boxes)
    let county = 'Unknown';
    if (lat >= 32.5 && lat <= 33.5 && lng >= -117.6 && lng <= -116.1) {
      county = 'San Diego';
    } else if (lat >= 33.4 && lat <= 34.1 && lng >= -117.7 && lng <= -114.4) {
      county = 'Riverside';
    } else if (lat >= 34.0 && lat <= 35.5 && lng >= -117.7 && lng <= -114.4) {
      county = 'San Bernardino';
    }

    // Check what coverage we have for this county
    const coverage = UTILITY_COVERAGE_MAP[county];
    const allTypes = ['sewer', 'water', 'storm', 'electric'];
    
    const result: UtilityCoverage = {
      hasCoverage: !!coverage,
      county,
      availableTypes: coverage?.types || [],
      missingTypes: allTypes.filter(t => !coverage?.types.includes(t)),
      recommendation: '',
      call811: true, // Always recommend 811
      note: undefined,
    };

    if (!coverage) {
      result.recommendation = '⚠️ No utility data available for this area. ALWAYS call 811 before digging.';
    } else if (result.missingTypes.length > 0) {
      result.recommendation = `✓ We have ${result.availableTypes.join(', ')} data. Call 811 for ${result.missingTypes.join(', ')} locations.`;
      result.note = `Coverage for: ${coverage.cities.join(', ')}`;
    } else {
      result.recommendation = '✓ Full utility coverage available. Still recommend 811 call for verification.';
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error checking utility coverage:', error);
    return NextResponse.json(
      { error: 'Failed to check utility coverage' },
      { status: 500 }
    );
  }
}
