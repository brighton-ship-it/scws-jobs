import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * GET /api/tech/location - Get all tech locations
 * Query params:
 *   - tech_id: Get specific tech location (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const searchParams = request.nextUrl.searchParams;
    const techId = searchParams.get('tech_id');

    let query = supabase
      .from('tech_locations')
      .select(`
        *,
        user:users!tech_id (
          id,
          name,
          email,
          phone,
          role
        )
      `)
      .order('updated_at', { ascending: false });

    if (techId) {
      query = query.eq('tech_id', techId);
    }

    const { data: locations, error } = await query;

    if (error) {
      console.error('Error fetching tech locations:', error);
      return NextResponse.json(
        { error: 'Failed to fetch tech locations', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ locations });
  } catch (error) {
    console.error('Tech location API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tech/location - Update tech location
 * Body: { tech_id, lat, lng, accuracy?, heading?, speed? }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();

    const { tech_id, lat, lng, accuracy, heading, speed } = body;

    // Validate required fields
    if (!tech_id) {
      return NextResponse.json(
        { error: 'tech_id is required' },
        { status: 400 }
      );
    }

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json(
        { error: 'lat and lng must be numbers' },
        { status: 400 }
      );
    }

    // Validate coordinates are in reasonable range
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json(
        { error: 'Invalid coordinates' },
        { status: 400 }
      );
    }

    // Upsert location
    const { data: location, error } = await supabase
      .from('tech_locations')
      .upsert({
        tech_id,
        lat,
        lng,
        accuracy: accuracy ?? null,
        heading: heading ?? null,
        speed: speed ?? null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'tech_id',
      })
      .select()
      .single();

    if (error) {
      console.error('Error updating tech location:', error);
      return NextResponse.json(
        { error: 'Failed to update location', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ location });
  } catch (error) {
    console.error('Tech location API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/tech/location - Remove tech location (stop sharing)
 * Query params:
 *   - tech_id: The tech whose location to remove
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const searchParams = request.nextUrl.searchParams;
    const techId = searchParams.get('tech_id');

    if (!techId) {
      return NextResponse.json(
        { error: 'tech_id is required' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('tech_locations')
      .delete()
      .eq('tech_id', techId);

    if (error) {
      console.error('Error deleting tech location:', error);
      return NextResponse.json(
        { error: 'Failed to delete location', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Tech location API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
