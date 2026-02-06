import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/invoices - List invoices with optional filters
 * Query params:
 *   - status: Filter by status (draft, sent, paid, overdue, void)
 *   - customer_id: Filter by customer
 *   - limit: Max results (default 50)
 *   - offset: Pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const customerId = searchParams.get('customer_id');
    const jobId = searchParams.get('job_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let query = supabase
      .from('invoices')
      .select(`
        *,
        customer:customers (id, name, email, phone),
        job:jobs (id, job_type, status),
        items:invoice_items (*)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    if (customerId) {
      query = query.eq('customer_id', customerId);
    }

    if (jobId) {
      query = query.eq('job_id', jobId);
    }

    const { data: invoices, error } = await query;

    if (error) {
      console.error('Error fetching invoices:', error);
      return NextResponse.json(
        { error: 'Failed to fetch invoices', details: error.message },
        { status: 500 }
      );
    }

    // Get total count
    let countQuery = supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true });
    
    if (status) countQuery = countQuery.eq('status', status);
    if (customerId) countQuery = countQuery.eq('customer_id', customerId);
    
    const { count } = await countQuery;

    return NextResponse.json({ invoices, total: count || 0 });
  } catch (error) {
    console.error('Invoices API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/invoices - Create a new invoice
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();

    const {
      customer_id,
      job_id,
      quote_id,
      issue_date,
      due_date,
      tax_rate = 8.75,
      notes,
      internal_notes,
      items = [],
      status = 'draft'
    } = body;

    // Validate required fields
    if (!customer_id) {
      return NextResponse.json(
        { error: 'customer_id is required' },
        { status: 400 }
      );
    }

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'At least one line item is required' },
        { status: 400 }
      );
    }

    // Calculate totals
    const subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unit_price), 0);
    const taxableSubtotal = items
      .filter((item: any) => item.taxable !== false)
      .reduce((sum: number, item: any) => sum + (item.quantity * item.unit_price), 0);
    const tax_amount = taxableSubtotal * (tax_rate / 100);
    const total = subtotal + tax_amount;

    // Create the invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        customer_id,
        job_id: job_id || null,
        quote_id: quote_id || null,
        status,
        issue_date: issue_date || new Date().toISOString().split('T')[0],
        due_date,
        subtotal,
        tax_rate,
        tax_amount,
        total,
        notes,
        internal_notes,
      })
      .select()
      .single();

    if (invoiceError) {
      console.error('Error creating invoice:', invoiceError);
      return NextResponse.json(
        { error: 'Failed to create invoice', details: invoiceError.message },
        { status: 500 }
      );
    }

    // Create the line items
    const invoiceItems = items.map((item: any, index: number) => ({
      invoice_id: invoice.id,
      product_id: item.product_id || null,
      description: item.description,
      item_description: item.item_description || null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total: item.quantity * item.unit_price,
      item_type: item.item_type || null,
      taxable: item.taxable !== false,
      sort_order: index,
    }));

    const { error: itemsError } = await supabase
      .from('invoice_items')
      .insert(invoiceItems);

    if (itemsError) {
      console.error('Error creating invoice items:', itemsError);
      // Delete the invoice if items failed
      await supabase.from('invoices').delete().eq('id', invoice.id);
      return NextResponse.json(
        { error: 'Failed to create invoice items', details: itemsError.message },
        { status: 500 }
      );
    }

    // Fetch the complete invoice with items
    const { data: completeInvoice } = await supabase
      .from('invoices')
      .select(`
        *,
        customer:customers (id, name, email, phone),
        items:invoice_items (*)
      `)
      .eq('id', invoice.id)
      .single();

    return NextResponse.json({ invoice: completeInvoice }, { status: 201 });
  } catch (error) {
    console.error('Create invoice error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
