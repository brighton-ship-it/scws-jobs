import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET /api/portal/[token]/invoices/[id] - Get invoice details
 * 
 * Returns full invoice with line items and payments
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  try {
    const { token, id } = await params;
    
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

    // Get invoice with all details
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        customer_id,
        job_id,
        status,
        issue_date,
        due_date,
        subtotal,
        tax_rate,
        tax_amount,
        total,
        amount_paid,
        notes,
        sent_at,
        viewed_at,
        paid_at,
        created_at,
        job:jobs (
          id,
          job_type,
          status,
          description,
          completed_at,
          scheduled_date,
          property:properties (
            id,
            address,
            city,
            zip
          )
        )
      `)
      .eq('id', id)
      .eq('customer_id', portalToken.customer_id)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // Get line items
    const { data: lineItems } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', id)
      .order('sort_order', { ascending: true });

    // Get payments
    const { data: payments } = await supabase
      .from('payments')
      .select('*')
      .eq('invoice_id', id)
      .order('payment_date', { ascending: false });

    // Mark invoice as viewed if not already
    if (!invoice.viewed_at) {
      await supabase
        .from('invoices')
        .update({ 
          viewed_at: new Date().toISOString(),
          status: invoice.status === 'sent' ? 'viewed' : invoice.status
        })
        .eq('id', id);
    }

    return NextResponse.json({
      invoice: {
        ...invoice,
        items: lineItems || [],
        payments: payments || [],
      },
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });

  } catch (error) {
    console.error('Portal invoice detail API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
