import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/jobs/[id]/photos/reorder - Reorder photos
 * Body: { photos: [{ id: string, sort_order: number }] }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = createServiceClient();
    const { id: jobId } = await params;
    const body = await request.json();

    if (!Array.isArray(body.photos)) {
      return NextResponse.json(
        { error: 'photos array is required' },
        { status: 400 }
      );
    }

    // Update each photo's sort_order
    const updates = body.photos.map(({ id, sort_order }: { id: string; sort_order: number }) =>
      supabase
        .from('job_photos')
        .update({ sort_order })
        .eq('id', id)
        .eq('job_id', jobId)
    );

    await Promise.all(updates);

    // Fetch updated photos
    const { data: photos, error } = await supabase
      .from('job_photos')
      .select('*')
      .eq('job_id', jobId)
      .order('category')
      .order('sort_order');

    if (error) {
      console.error('Error fetching reordered photos:', error);
      return NextResponse.json(
        { error: 'Failed to fetch updated photos' },
        { status: 500 }
      );
    }

    return NextResponse.json({ photos });
  } catch (error) {
    console.error('Reorder photos API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
