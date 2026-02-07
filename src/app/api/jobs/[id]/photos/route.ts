import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/photos - Get all photos for a job
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = createServiceClient();
    const { id } = await params;

    const { data: photos, error } = await supabase
      .from('job_photos')
      .select('*')
      .eq('job_id', id)
      .order('category')
      .order('sort_order');

    if (error) {
      console.error('Error fetching job photos:', error);
      return NextResponse.json(
        { error: 'Failed to fetch photos', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ photos });
  } catch (error) {
    console.error('Get job photos API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/jobs/[id]/photos - Upload a photo for a job
 * Body: FormData with file, category, caption
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = createServiceClient();
    const { id: jobId } = await params;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const category = (formData.get('category') as string) || 'documentation';
    const caption = formData.get('caption') as string | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate category
    if (!['before', 'after', 'documentation'].includes(category)) {
      return NextResponse.json(
        { error: 'Invalid category. Must be before, after, or documentation' },
        { status: 400 }
      );
    }

    // Generate unique filename
    const ext = file.name.split('.').pop() || 'jpg';
    const timestamp = Date.now();
    const filename = `${jobId}/${category}/${timestamp}.${ext}`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('job-photos')
      .upload(filename, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('Error uploading photo:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload photo', details: uploadError.message },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('job-photos')
      .getPublicUrl(uploadData.path);

    // Get current max sort order for this job+category
    const { data: maxSort } = await supabase
      .from('job_photos')
      .select('sort_order')
      .eq('job_id', jobId)
      .eq('category', category)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single();

    const nextSortOrder = (maxSort?.sort_order ?? -1) + 1;

    // Insert photo record
    const { data: photo, error: insertError } = await supabase
      .from('job_photos')
      .insert({
        job_id: jobId,
        url: urlData.publicUrl,
        filename: file.name,
        file_size: file.size,
        category,
        caption,
        sort_order: nextSortOrder,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting photo record:', insertError);
      // Try to clean up uploaded file
      await supabase.storage.from('job-photos').remove([filename]);
      return NextResponse.json(
        { error: 'Failed to save photo record', details: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ photo }, { status: 201 });
  } catch (error) {
    console.error('Upload photo API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
