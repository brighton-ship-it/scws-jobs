import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET /api/portal/[token] - Validate portal token and get customer info
 * 
 * Returns customer data, properties, and recent summary
 * No authentication required - uses secure token
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

    // Look up token and get customer
    const { data: portalToken, error: tokenError } = await supabase
      .from('portal_tokens')
      .select(`
        id,
        customer_id,
        expires_at,
        customer:customers (
          id,
          name,
          email,
          phone,
          billing_address
        )
      `)
      .eq('token', token)
      .single();

    if (tokenError || !portalToken) {
      return NextResponse.json(
        { error: 'Invalid or expired portal link' },
        { status: 404 }
      );
    }

    // Check expiration
    if (portalToken.expires_at && new Date(portalToken.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'This portal link has expired' },
        { status: 410 }
      );
    }

    // Update last used timestamp
    await supabase
      .from('portal_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', portalToken.id);

    const customerId = portalToken.customer_id;

    // Get customer properties
    const { data: properties } = await supabase
      .from('properties')
      .select('*')
      .eq('customer_id', customerId);

    // Get invoice summary
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, status, total, amount_paid')
      .eq('customer_id', customerId)
      .neq('status', 'void');

    const invoiceSummary = {
      total: invoices?.length || 0,
      outstanding: invoices
        ?.filter(i => !['paid', 'void', 'draft'].includes(i.status))
        .reduce((sum, i) => sum + (Number(i.total) - Number(i.amount_paid)), 0) || 0,
      paid: invoices
        ?.filter(i => i.status === 'paid')
        .reduce((sum, i) => sum + Number(i.total), 0) || 0,
    };

    // Get recent jobs
    const propertyIds = properties?.map(p => p.id) || [];
    let recentJobs: { id: string; job_type: string; status: string; completed_at: string | null }[] = [];
    
    if (propertyIds.length > 0) {
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, job_type, status, completed_at')
        .in('property_id', propertyIds)
        .order('created_at', { ascending: false })
        .limit(5);
      recentJobs = jobs || [];
    }

    return NextResponse.json({
      customer: portalToken.customer,
      properties: properties || [],
      invoiceSummary,
      recentJobs,
    });

  } catch (error) {
    console.error('Portal API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
