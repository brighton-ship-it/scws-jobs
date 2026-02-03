import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/permits/reports - List saved permit research reports
 * Query params:
 *   - customer_id: Filter by customer
 *   - job_id: Filter by job
 *   - limit: Max results (default 50)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const searchParams = request.nextUrl.searchParams;
    const customerId = searchParams.get('customer_id');
    const jobId = searchParams.get('job_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    let query = supabase
      .from('permit_research_reports')
      .select(`
        *,
        customer:customers(id, name),
        job:jobs(id, title)
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (customerId) {
      query = query.eq('customer_id', customerId);
    }
    if (jobId) {
      query = query.eq('job_id', jobId);
    }

    const { data: reports, error } = await query;

    if (error) {
      console.error('Error fetching permit reports:', error);
      return NextResponse.json(
        { error: 'Failed to fetch reports', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ reports });
  } catch (error) {
    console.error('Permit reports API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/permits/reports - Save a permit research report
 * Body: {
 *   customer_id?: string,
 *   job_id?: string,
 *   apn?: string,
 *   address: string,
 *   county: string,
 *   parcel_info: object,
 *   wells_info: array,
 *   septic_info: object,
 *   zoning_info: object,
 *   notes?: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();

    const {
      customer_id,
      job_id,
      apn,
      address,
      county,
      parcel_info,
      wells_info,
      septic_info,
      zoning_info,
      notes,
    } = body;

    if (!address || !county) {
      return NextResponse.json(
        { error: 'Address and county are required' },
        { status: 400 }
      );
    }

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    
    // Get team member ID for the user
    let createdBy = null;
    if (user?.email) {
      const { data: teamMember } = await supabase
        .from('team_members')
        .select('id')
        .eq('email', user.email)
        .single();
      createdBy = teamMember?.id;
    }

    const { data: report, error } = await supabase
      .from('permit_research_reports')
      .insert({
        customer_id: customer_id || null,
        job_id: job_id || null,
        apn: apn || null,
        address,
        county,
        parcel_info,
        wells_info,
        septic_info,
        zoning_info,
        notes: notes || null,
        created_by: createdBy,
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving permit report:', error);
      return NextResponse.json(
        { error: 'Failed to save report', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ report });
  } catch (error) {
    console.error('Save permit report API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
