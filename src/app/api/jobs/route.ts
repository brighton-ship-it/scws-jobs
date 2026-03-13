import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sendPushToUser } from '@/lib/push';

export const dynamic = 'force-dynamic';

// GET - List jobs with filters
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);
    
    const status = searchParams.get('status');
    const assignedTo = searchParams.get('assigned_to');
    const propertyId = searchParams.get('property_id');
    const customerId = searchParams.get('customer_id');
    const limit = parseInt(searchParams.get('limit') || '100');
    const search = searchParams.get('search');

    let query = supabase
      .from('jobs')
      .select(`
        *,
        property:properties (
          id,
          address,
          city,
          county,
          zip,
          customer:customers (id, name, email, phone)
        ),
        assigned_user:team_members (id, name, email, role)
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status && status !== 'all') {
      // Handle derived statuses
      if (status === 'late') {
        const today = new Date().toISOString().split('T')[0];
        query = query
          .lt('scheduled_date', today)
          .not('status', 'in', '("completed","invoiced")');
      } else if (status === 'requires_invoicing') {
        query = query.eq('status', 'completed');
      } else if (status === 'action_required') {
        query = query.in('priority', ['urgent', 'high']);
      } else if (status === 'unscheduled') {
        query = query.or('scheduled_date.is.null,assigned_to.is.null');
      } else {
        query = query.eq('status', status);
      }
    }

    if (assignedTo && assignedTo !== 'all') {
      if (assignedTo === 'unassigned') {
        query = query.is('assigned_to', null);
      } else {
        // assignedTo might be a users.id — look up the team_member by email
        let teamMemberId = assignedTo;
        const { data: userProfile } = await supabase
          .from('users')
          .select('email')
          .eq('id', assignedTo)
          .single();
        if (userProfile?.email) {
          const { data: teamMember } = await supabase
            .from('team_members')
            .select('id')
            .eq('email', userProfile.email)
            .single();
          if (teamMember) {
            teamMemberId = teamMember.id;
          }
        }
        query = query.eq('assigned_to', teamMemberId);
      }
    }

    if (propertyId) {
      query = query.eq('property_id', propertyId);
    }

    // Filter by customer through property
    // Note: This requires a subquery or client-side filtering

    const { data: jobs, error } = await query;

    if (error) {
      console.error('Jobs fetch error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Apply search filter client-side if provided
    let filteredJobs = jobs || [];
    if (search && search.trim()) {
      const searchLower = search.toLowerCase();
      filteredJobs = filteredJobs.filter((job: any) => 
        job.job_type?.toLowerCase().includes(searchLower) ||
        job.description?.toLowerCase().includes(searchLower) ||
        job.property?.address?.toLowerCase().includes(searchLower) ||
        job.property?.customer?.name?.toLowerCase().includes(searchLower) ||
        job.id.includes(search)
      );
    }

    // Filter by customer if specified
    if (customerId) {
      filteredJobs = filteredJobs.filter((job: any) => 
        job.property?.customer?.id === customerId
      );
    }

    return NextResponse.json({ jobs: filteredJobs });
  } catch (error) {
    console.error('Jobs API error:', error);
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
  }
}

// POST - Create a new job
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();

    const {
      property_id,
      assigned_to,
      job_type,
      scheduled_date,
      scheduled_time,
      estimated_duration,
      description,
      internal_notes,
      priority = 'normal',
    } = body;

    if (!property_id) {
      return NextResponse.json({ error: 'Property ID is required' }, { status: 400 });
    }

    if (!job_type) {
      return NextResponse.json({ error: 'Job type is required' }, { status: 400 });
    }

    const { data: job, error } = await supabase
      .from('jobs')
      .insert({
        property_id,
        assigned_to: assigned_to || null,
        job_type,
        status: 'scheduled',
        scheduled_date: scheduled_date || null,
        scheduled_time: scheduled_time || null,
        estimated_duration: estimated_duration || null,
        description: description || null,
        internal_notes: internal_notes || null,
        priority,
      })
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
      console.error('Job creation error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Send push notification to assigned tech
    if (assigned_to && job) {
      const customerName = job.property?.customer?.name || 'Customer';
      const address = job.property?.address || job.property?.city || '';
      const dateStr = scheduled_date 
        ? new Date(scheduled_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : 'TBD';
      
      sendPushToUser(assigned_to, {
        title: '📋 New Job Assigned',
        body: `${job_type} - ${customerName}${address ? ` at ${address}` : ''} (${dateStr})`,
        tag: `job-${job.id}`,
        url: `/tech/jobs/${job.id}`,
        data: { jobId: job.id, type: 'job_assigned' }
      }).catch(err => console.error('[Push] Failed to send job notification:', err));
    }

    return NextResponse.json({ job });
  } catch (error) {
    console.error('Job creation error:', error);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}
