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

    // WORKAROUND: Use simple query without customer_id filter due to Supabase bug
    // The complex query with customer_id filter was returning stale data
    
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
      .single();
    
    // Verify customer ownership after fetching
    if (invoice && invoice.customer_id !== portalToken.customer_id) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

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

    // Get customer billing info for payment form
    const { data: customer } = await supabase
      .from('customers')
      .select('id, name, email, phone, billing_address, billing_city, billing_state, billing_zip')
      .eq('id', portalToken.customer_id)
      .single();

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

    // Force fresh query for items with explicit select
    const { data: freshItems } = await supabase
      .from('invoice_items')
      .select('id, description, quantity, unit_price, total, item_type, sort_order')
      .eq('invoice_id', id)
      .order('sort_order');
    
    return NextResponse.json({
      invoice: {
        ...invoice,
        items: freshItems || [],
        payments: payments || [],
      },
      customer: customer || null,
      _debug: {
        timestamp: new Date().toISOString(),
        deployVersion: '2026-02-10-v4',
        invoiceId: id,
        customerId: portalToken.customer_id,
        rawInvoiceByIdOnly: rawInvoice,
        invoiceTotal: invoice.total,
        invoiceSubtotal: invoice.subtotal,
        invoiceDueDate: invoice.due_date,
        rawItemsCount: lineItems?.length || 0,
        freshItemsCount: freshItems?.length || 0,
        rawFirstItem: lineItems?.[0],
        freshFirstItem: freshItems?.[0],
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30),
      },
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Debug-Time': new Date().toISOString(),
        'X-Deploy-Version': '2026-02-10-v3',
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
