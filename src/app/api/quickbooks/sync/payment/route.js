/**
 * POST /api/quickbooks/sync/payment
 * Syncs a payment to QuickBooks
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

    const { paymentId } = await request.json();
    
    // Get payment with invoice and customer
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select(`
        *,
        invoice:invoices(*, customer:customers(*))
      `)
      .eq('id', paymentId)
      .single();

    if (paymentError || !payment) {
      return Response.json({ error: 'Payment not found' }, { status: 404 });
    }

    // Make sure customer is synced
    if (!payment.invoice?.customer?.qb_customer_id) {
      return Response.json({ 
        error: 'Customer must be synced to QuickBooks first' 
      }, { status: 400 });
    }

    const qb = await getQBClient(supabase, user.id);

    // Create payment in QuickBooks
    const qbPayment = await qb.createPayment({
      customerId: payment.invoice.customer.qb_customer_id,
      amount: payment.amount,
      invoiceId: payment.invoice.qb_invoice_id, // Link to QBO invoice if exists
      notes: payment.notes || `Payment from SCWS CRM - ${payment.payment_method}`,
    });

    // Save QuickBooks payment ID
    await supabase
      .from('payments')
      .update({ qb_payment_id: qbPayment.Id })
      .eq('id', paymentId);

    return Response.json({ 
      success: true, 
      qbPaymentId: qbPayment.Id,
      message: 'Payment synced to QuickBooks'
    });

  } catch (error) {
    console.error('Payment sync error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
