/**
 * POST /api/quickbooks/sync/invoice
 * Syncs an invoice to QuickBooks
 */

import { createClient } from '@/lib/supabase/server';
import { QuickBooksClient } from '@/lib/quickbooks/client';
import { refreshAccessToken } from '@/lib/quickbooks/oauth';

async function getQBClient(supabase, userId) {
  const { data: connection, error } = await supabase
    .from('quickbooks_connections')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !connection) {
    throw new Error('QuickBooks not connected');
  }

  // Check if token needs refresh
  const expiresAt = new Date(connection.token_expires_at);
  if (expiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
    const tokens = await refreshAccessToken({
      refreshToken: connection.refresh_token,
      clientId: process.env.QUICKBOOKS_CLIENT_ID,
      clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
    });

    await supabase
      .from('quickbooks_connections')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      })
      .eq('user_id', userId);

    connection.access_token = tokens.access_token;
  }

  return new QuickBooksClient({
    accessToken: connection.access_token,
    realmId: connection.realm_id,
    environment: connection.environment,
  });
}

export async function POST(request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { invoiceId } = await request.json();
    
    // Get invoice with line items and customer
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        *,
        customer:customers(*),
        line_items:invoice_line_items(*)
      `)
      .eq('id', invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Make sure customer is synced to QuickBooks first
    if (!invoice.customer?.qb_customer_id) {
      return Response.json({ 
        error: 'Customer must be synced to QuickBooks first',
        customerId: invoice.customer_id 
      }, { status: 400 });
    }

    const qb = await getQBClient(supabase, user.id);

    // Create invoice in QuickBooks
    const qbInvoice = await qb.createInvoice({
      customerId: invoice.customer.qb_customer_id,
      invoiceNumber: invoice.invoice_number,
      dueDate: invoice.due_date,
      email: invoice.customer.email,
      notes: invoice.notes,
      lineItems: (invoice.line_items || []).map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        amount: item.amount || (item.quantity * item.unit_price),
      })),
    });

    // Save QuickBooks invoice ID
    await supabase
      .from('invoices')
      .update({ qb_invoice_id: qbInvoice.Id })
      .eq('id', invoiceId);

    return Response.json({ 
      success: true, 
      qbInvoiceId: qbInvoice.Id,
      message: 'Invoice synced to QuickBooks'
    });

  } catch (error) {
    console.error('Invoice sync error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
