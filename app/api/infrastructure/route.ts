import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/infrastructure?apn=123-456-78
// GET /api/infrastructure?lat=32.8&lng=-117.1
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const apn = searchParams.get('apn');
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');

  try {
    // Search by APN
    if (apn) {
      const { data, error } = await supabase
        .from('parcel_infrastructure')
        .select('*')
        .eq('apn', apn.replace(/-/g, ''))
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      return NextResponse.json({
        found: !!data,
        infrastructure: data || null,
        waterType: data?.sewer_septic_designation?.includes('Septic') ? 'SEPTIC' 
          : data?.sewer_septic_designation?.includes('Sewer') ? 'SEWER' 
          : 'UNKNOWN'
      });
    }

    // Search by coordinates (find nearest parcel)
    if (lat && lng) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);

      // Find parcels within ~500ft radius
      const { data, error } = await supabase
        .from('parcel_infrastructure')
        .select('*')
        .gte('latitude', latitude - 0.001)
        .lte('latitude', latitude + 0.001)
        .gte('longitude', longitude - 0.001)
        .lte('longitude', longitude + 0.001)
        .limit(10);

      if (error) throw error;

      // Calculate distances and sort
      const withDistances = (data || []).map(p => ({
        ...p,
        distance_ft: haversineDistance(latitude, longitude, p.latitude, p.longitude) * 3280.84
      })).sort((a, b) => a.distance_ft - b.distance_ft);

      const nearest = withDistances[0] || null;

      return NextResponse.json({
        found: !!nearest,
        infrastructure: nearest,
        waterType: nearest?.sewer_septic_designation?.includes('Septic') ? 'SEPTIC'
          : nearest?.sewer_septic_designation?.includes('Sewer') ? 'SEWER'
          : 'UNKNOWN',
        nearbyCount: withDistances.length
      });
    }

    return NextResponse.json({ error: 'Provide apn or lat/lng' }, { status: 400 });

  } catch (error: any) {
    console.error('Infrastructure lookup error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Haversine distance in miles
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * Math.PI / 180;
}
