import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sendPushToUser } from '@/lib/push';

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
        assigned_user:team_members (id, name, email, phone, role)
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

    // Get current job to check if assigned_to is changing
    const { data: currentJob } = await supabase
      .from('jobs')
      .select('assigned_to')
      .eq('id', id)
      .single();

    // If assigned_to is a users table ID, map it to team_members ID
    if (body.assigned_to) {
      const { data: userProfile } = await supabase
        .from('users')
        .select('email')
        .eq('id', body.assigned_to)
        .single();
      if (userProfile?.email) {
        const { data: teamMember } = await supabase
          .from('team_members')
          .select('id')
          .eq('email', userProfile.email)
          .single();
        if (teamMember) {
          body.assigned_to = teamMember.id;
        }
      }
    }

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

    // Send push notification if assigned_to changed to a new user
    if (body.assigned_to && body.assigned_to !== currentJob?.assigned_to && job) {
      const customerName = job.property?.customer?.name || 'Customer';
      const address = job.property?.address || job.property?.city || '';
      const dateStr = job.scheduled_date 
        ? new Date(job.scheduled_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : 'TBD';
      
      sendPushToUser(body.assigned_to, {
        title: '📋 Job Assigned to You',
        body: `${job.job_type} - ${customerName}${address ? ` at ${address}` : ''} (${dateStr})`,
        tag: `job-${job.id}`,
        url: `/tech/jobs/${job.id}`,
        data: { jobId: job.id, type: 'job_assigned' }
      }).catch(err => console.error('[Push] Failed to send job notification:', err));
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
