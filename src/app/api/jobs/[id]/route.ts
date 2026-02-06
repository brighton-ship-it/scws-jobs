import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET - Get single job by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();

    const { data: job, error } = await supabase
      .from('jobs')
      .select(`
        *,
        property:properties (
          id,
          address,
          city,
          county,
          zip,
          access_notes,
          customer:customers (id, name, email, phone, billing_address, notes)
        ),
        assigned_user:users (id, name, email, phone, role)
      `)
      .eq('id', id)
      .single();

    if (error || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    console.error('Job fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 });
  }
}

// PATCH - Update job
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();
    const body = await request.json();

    // Remove undefined values
    const updates = Object.fromEntries(
      Object.entries(body).filter(([_, v]) => v !== undefined)
    );

    const { data: job, error } = await supabase
      .from('jobs')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        property:properties (
          id,
          address,
          city,
          customer:customers (id, name, email, phone)
        )
      `)
      .single();

    if (error) {
      console.error('Job update error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    console.error('Job update error:', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}

// DELETE - Delete job
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();

    const { error } = await supabase
      .from('jobs')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Job delete error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Job delete error:', error);
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
  }
}
