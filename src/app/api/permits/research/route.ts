import { NextRequest, NextResponse } from 'next/server';
import { runPermitResearch } from '@/lib/permits/research';
import { lookupNearbySeptic, lookupSiteSeptic } from '@/lib/permits/septic';
import { isCounty, type County } from '@/lib/permits/county';
import { createServiceClient } from '@/lib/supabase/server';

function supabaseOrNull() {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      return null;
    }
    return createServiceClient();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apn, address, county, lat, lng, septicRadiusFeet } = body || {};

    if (!apn && !address && lat == null && lng == null) {
      return NextResponse.json(
        { error: 'Either APN, address, or GPS coordinates are required' },
        { status: 400 }
      );
    }

    const supabase = supabaseOrNull();
    const result = await runPermitResearch(
      {
        apn,
        address,
        county: county && isCounty(county) ? (county as County) : undefined,
        lat: lat != null ? Number(lat) : undefined,
        lng: lng != null ? Number(lng) : undefined,
        septicRadiusFeet,
      },
      {
        lookupSiteSeptic: supabase
          ? (siteApn, siteLat, siteLng, siteCounty) =>
              lookupSiteSeptic(supabase, siteApn, siteLat, siteLng, siteCounty)
          : undefined,
        lookupNearbySeptic: supabase
          ? (siteLat, siteLng, radiusMeters, siteCounty) =>
              lookupNearbySeptic(supabase, siteLat, siteLng, radiusMeters, siteCounty)
          : undefined,
      }
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Permit research API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
