import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

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
    // Convert miles to degrees (approximate)
    const latDelta = radiusMiles / 69;
    const lngDelta = radiusMiles / (69 * Math.cos(lat * Math.PI / 180));

    // Query wells within bounding box
    let query = supabase
      .from('dwr_wells')
      .select('*')
      .gte('latitude', lat - latDelta)
      .lte('latitude', lat + latDelta)
      .gte('longitude', lng - lngDelta)
      .lte('longitude', lng + lngDelta)
      .not('latitude', 'is', null)
      .limit(200);

    if (county !== 'all') {
      query = query.eq('county', county);
    }

    const { data: wells, error } = await query;

    if (error) {
      console.error('Wells query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Calculate distances and sort
    const wellsWithDistance = (wells || []).map(well => {
      const dLat = (well.latitude - lat) * 69;
      const dLng = (well.longitude - lng) * 69 * Math.cos(lat * Math.PI / 180);
      const distanceMiles = Math.sqrt(dLat * dLat + dLng * dLng);
      return {
        ...well,
        distance_miles: Math.round(distanceMiles * 100) / 100,
        distance_feet: Math.round(distanceMiles * 5280)
      };
    }).sort((a, b) => a.distance_miles - b.distance_miles);

    // Calculate stats
    const depths = wellsWithDistance
      .filter(w => w.total_drill_depth && w.total_drill_depth > 0)
      .map(w => w.total_drill_depth);
    
    const yields = wellsWithDistance
      .filter(w => w.well_yield && w.well_yield > 0)
      .map(w => w.well_yield);

    const stats = {
      totalWells: wellsWithDistance.length,
      avgDepth: depths.length ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : null,
      minDepth: depths.length ? Math.min(...depths) : null,
      maxDepth: depths.length ? Math.max(...depths) : null,
      avgYield: yields.length ? Math.round(yields.reduce((a, b) => a + b, 0) / yields.length * 10) / 10 : null,
      setbackFeet: SETBACKS[county] || 50,
      radiusMiles
    };

    return NextResponse.json({
      wells: wellsWithDistance.slice(0, 50), // Return top 50 nearest
      stats,
      setbacks: SETBACKS
    });

  } catch (err: any) {
    console.error('Wells API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
