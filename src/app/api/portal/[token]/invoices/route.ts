import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET /api/portal/[token]/invoices - List customer invoices
 * 
 * Returns all invoices for the customer with job details
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

    // Get invoices with job and property info
    const { data: invoices, error: invoicesError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        status,
        issue_date,
        due_date,
        subtotal,
        tax_amount,
        total,
        amount_paid,
        notes,
        paid_at,
        job:jobs (
          id,
          job_type,
          status,
          completed_at,
          property:properties (
            id,
            address,
            city
          )
        )
      `)
      .eq('customer_id', portalToken.customer_id)
      .neq('status', 'draft')
      .neq('status', 'void')
      .order('issue_date', { ascending: false });

    if (invoicesError) {
      console.error('Error fetching invoices:', invoicesError);
      return NextResponse.json(
        { error: 'Failed to fetch invoices' },
        { status: 500 }
      );
    }

    // Calculate summary
    const summary = {
      total: invoices?.length || 0,
      outstanding: invoices
        ?.filter(i => !['paid', 'void', 'draft'].includes(i.status))
        .reduce((sum, i) => sum + (Number(i.total) - Number(i.amount_paid)), 0) || 0,
      paid: invoices
        ?.filter(i => i.status === 'paid')
        .reduce((sum, i) => sum + Number(i.total), 0) || 0,
      unpaidCount: invoices?.filter(i => !['paid', 'void', 'draft'].includes(i.status)).length || 0,
    };

    return NextResponse.json({
      invoices: invoices || [],
      summary,
    });

  } catch (error) {
    console.error('Portal invoices API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
