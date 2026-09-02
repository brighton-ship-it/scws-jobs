import { NextRequest, NextResponse } from 'next/server';
import { isDemoAuthMode } from '@/lib/demo-auth';
import { requireUser } from '@/lib/require-auth';
import { lookupNearbyWells } from '@/lib/wells/nearby';

export const dynamic = 'force-dynamic';

/**
 * GET /api/wells/nearby
 * Staff session required. Geocode + CNRA WCR lookup happen on the server
 * (browser Nominatim is blocked).
 */
export async function GET(request: NextRequest) {
  if (!isDemoAuthMode()) {
    const auth = await requireUser();
    if (auth.response) return auth.response;
  }

  const { searchParams } = new URL(request.url);

  try {
    const result = await lookupNearbyWells({
      address: searchParams.get('address'),
      lat: searchParams.get('lat'),
      lng: searchParams.get('lng'),
      radiusMiles: searchParams.get('radius'),
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to look up wells';
    const status = /address|lat|lng/i.test(message) ? 400 : 502;
    console.error('Wells nearby error:', message);
    return NextResponse.json({ error: message }, { status });
  }
}
