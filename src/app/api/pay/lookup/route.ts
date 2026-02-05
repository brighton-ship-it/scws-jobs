import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

interface InvoiceLookupResult {
  id: string;
  invoice_number: number;
  status: string;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  customer: {
    id: string;
    name: string;
    email: string | null;
  } | null;
}

/**
 * GET /api/pay/lookup?invoice=1001 - Look up an invoice by number
 * 
 * Public endpoint for the payment portal to find invoices
 * Returns limited invoice info for security
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    let invoiceQuery = searchParams.get('invoice');

    if (!invoiceQuery) {
      return NextResponse.json(
        { error: 'Invoice number is required' },
        { status: 400 }
      );
    }

    // Clean up the invoice number
    // Remove common prefixes like "INV-", "#", etc.
    invoiceQuery = invoiceQuery
      .trim()
      .replace(/^(INV-?|#)/i, '')
      .trim();

    // Parse as number
    const invoiceNumber = parseInt(invoiceQuery, 10);

    if (isNaN(invoiceNumber)) {
      return NextResponse.json(
        { error: 'Invalid invoice number format' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Look up invoice with limited customer info
    const { data, error: invoiceError } = await supabase
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
        customer:customers (
          id,
          name,
          email
        )
      `)
      .eq('invoice_number', invoiceNumber)
      .single();
    
    const invoice = data as InvoiceLookupResult | null;

    if (invoiceError || !invoice) {
      // Don't reveal whether invoice exists or not for security
      return NextResponse.json(
        { error: 'Invoice not found. Please check the number and try again.' },
        { status: 404 }
      );
    }

    // Check if invoice is voided
    if (invoice.status === 'void') {
      return NextResponse.json(
        { error: 'This invoice has been voided and cannot be paid.' },
        { status: 400 }
      );
    }

    const customer = invoice.customer as { id: string; name: string; email: string | null } | null;
    const balanceDue = Number(invoice.total) - Number(invoice.amount_paid);

    // Get item count for display
    const { count: itemsCount } = await supabase
      .from('invoice_items')
      .select('id', { count: 'exact', head: true })
      .eq('invoice_id', invoice.id);

    return NextResponse.json({
      success: true,
      invoice: {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        customer_name: customer?.name || 'Customer',
        customer_email: customer?.email || null,
        total: Number(invoice.total),
        amount_paid: Number(invoice.amount_paid),
        balance_due: balanceDue,
        issue_date: invoice.issue_date,
        due_date: invoice.due_date,
        status: invoice.status,
        items_count: itemsCount || 0,
      },
    });

  } catch (error) {
    console.error('Invoice lookup error:', error);
    return NextResponse.json(
      { error: 'Failed to look up invoice. Please try again.' },
      { status: 500 }
    );
  }
}
