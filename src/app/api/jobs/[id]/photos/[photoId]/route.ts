import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ id: string; photoId: string }>;
}

/**
 * PATCH /api/jobs/[id]/photos/[photoId] - Update a photo (caption, sort_order, category)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = createServiceClient();
    const { id: jobId, photoId } = await params;
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (body.caption !== undefined) updates.caption = body.caption;
    if (body.sort_order !== undefined) updates.sort_order = body.sort_order;
    if (body.category !== undefined) {
      if (!['before', 'after', 'documentation'].includes(body.category)) {
        return NextResponse.json(
          { error: 'Invalid category' },
          { status: 400 }
        );
      }
      updates.category = body.category;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data: photo, error } = await supabase
      .from('job_photos')
      .update(updates)
      .eq('id', photoId)
      .eq('job_id', jobId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Photo not found' },
          { status: 404 }
        );
      }
      console.error('Error updating photo:', error);
      return NextResponse.json(
        { error: 'Failed to update photo', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ photo });
  } catch (error) {
    console.error('Update photo API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/jobs/[id]/photos/[photoId] - Delete a photo
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = createServiceClient();
    const { id: jobId, photoId } = await params;

    // Get the photo to find storage path
    const { data: photo, error: fetchError } = await supabase
      .from('job_photos')
      .select('url')
      .eq('id', photoId)
      .eq('job_id', jobId)
      .single();

    if (fetchError || !photo) {
      return NextResponse.json(
        { error: 'Photo not found' },
        { status: 404 }
      );
    }

    // Delete from database
    const { error: deleteError } = await supabase
      .from('job_photos')
      .delete()
      .eq('id', photoId)
      .eq('job_id', jobId);

    if (deleteError) {
      console.error('Error deleting photo:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete photo', details: deleteError.message },
        { status: 500 }
      );
    }

    // Try to delete from storage (extract path from URL)
    try {
      const url = new URL(photo.url);
      const pathMatch = url.pathname.match(/\/storage\/v1\/object\/public\/job-photos\/(.+)/);
      if (pathMatch) {
        await supabase.storage.from('job-photos').remove([pathMatch[1]]);
      }
    } catch {
      // Storage deletion is best-effort
      console.warn('Could not delete photo from storage');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete photo API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
