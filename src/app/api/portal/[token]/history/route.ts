import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET /api/portal/[token]/history - Get service history (jobs)
 * 
 * Returns all jobs for the customer's properties
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    
    if (!token || token.length < 20) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Validate token and get customer ID
    const { data: portalToken, error: tokenError } = await supabase
      .from('portal_tokens')
      .select('customer_id, expires_at')
      .eq('token', token)
      .single();

    if (tokenError || !portalToken) {
      return NextResponse.json(
        { error: 'Invalid or expired portal link' },
        { status: 404 }
      );
    }

    if (portalToken.expires_at && new Date(portalToken.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'This portal link has expired' },
        { status: 410 }
      );
    }

    // Get customer's properties
    const { data: properties } = await supabase
      .from('properties')
      .select('id, address, city')
      .eq('customer_id', portalToken.customer_id);

    if (!properties || properties.length === 0) {
      return NextResponse.json({
        jobs: [],
        properties: [],
        summary: { completed: 0, scheduled: 0, total: 0 },
      });
    }

    const propertyIds = properties.map(p => p.id);

    // Get all jobs for these properties
    const { data: jobs, error: jobsError } = await supabase
      .from('jobs')
      .select(`
        id,
        job_type,
        status,
        description,
        scheduled_date,
        scheduled_time,
        completed_at,
        created_at,
        property_id,
        property:properties (
          id,
          address,
          city
        )
      `)
      .in('property_id', propertyIds)
      .order('scheduled_date', { ascending: false, nullsFirst: false });

    if (jobsError) {
      console.error('Error fetching jobs:', jobsError);
      return NextResponse.json(
        { error: 'Failed to fetch service history' },
        { status: 500 }
      );
    }

    // Get related invoices for the jobs
    const jobIds = jobs?.map(j => j.id) || [];
    let invoicesByJob: Record<string, { id: string; invoice_number: number; status: string; total: number }> = {};
    
    if (jobIds.length > 0) {
      const { data: invoices } = await supabase
        .from('invoices')
        .select('id, invoice_number, status, total, job_id')
        .in('job_id', jobIds);
      
      if (invoices) {
        invoices.forEach(inv => {
          if (inv.job_id) {
            invoicesByJob[inv.job_id] = {
              id: inv.id,
              invoice_number: inv.invoice_number,
              status: inv.status,
              total: inv.total,
            };
          }
        });
      }
    }

    // Attach invoices to jobs
    const jobsWithInvoices = jobs?.map(job => ({
      ...job,
      invoice: invoicesByJob[job.id] || null,
    })) || [];

    // Calculate summary
    const summary = {
      completed: jobsWithInvoices.filter(j => 
        j.status === 'completed' || j.status === 'invoiced'
      ).length,
      scheduled: jobsWithInvoices.filter(j => j.status === 'scheduled').length,
      inProgress: jobsWithInvoices.filter(j => j.status === 'in_progress').length,
      total: jobsWithInvoices.length,
    };

    return NextResponse.json({
      jobs: jobsWithInvoices,
      properties,
      summary,
    });

  } catch (error) {
    console.error('Portal history API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
