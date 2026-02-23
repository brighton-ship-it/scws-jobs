import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import type { PaymentMethod } from '@/types/database';

/**
 * POST /api/invoices/[id]/payments - Record a manual payment
 * 
 * Used for cash, check, or other offline payments
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params;
    const supabase = createServiceClient();
    const body = await request.json();

    const { amount, payment_method, reference_number, payment_date, notes } = body;

    // Validate required fields
    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Payment amount is required and must be positive' },
        { status: 400 }
      );
    }

    // Get the invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, total, amount_paid, status, customer_id')
      .eq('id', invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // Record the payment
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        invoice_id: invoiceId,
        amount: parseFloat(amount),
        payment_method: (payment_method as PaymentMethod) || null,
        reference_number: reference_number || null,
        payment_date: payment_date || new Date().toISOString().split('T')[0],
        notes: notes || null,
      })
      .select()
      .single();

    if (paymentError) {
      console.error('Payment recording error:', paymentError);
      return NextResponse.json(
        { error: 'Failed to record payment' },
        { status: 500 }
      );
    }

    // Update invoice amount_paid and status
    const newAmountPaid = (invoice.amount_paid || 0) + parseFloat(amount);
    const newStatus = newAmountPaid >= invoice.total ? 'paid' : invoice.status;

    const { error: updateError } = await supabase
      .from('invoices')
      .update({
        amount_paid: newAmountPaid,
        status: newStatus,
        paid_at: newStatus === 'paid' ? new Date().toISOString() : null,
      })
      .eq('id', invoiceId);

    if (updateError) {
      console.error('Invoice update error:', updateError);
      // Payment was recorded, but invoice update failed - log but don't fail
    }

    // Update customer lead stage if fully paid
    if (newStatus === 'paid' && invoice.customer_id) {
      await supabase
        .from('customers')
        .update({
          lead_stage: 'paid',
          first_paid_at: new Date().toISOString(),
        })
        .eq('id', invoice.customer_id)
        .is('first_paid_at', null); // Only update if not already set
    }

    return NextResponse.json({
      success: true,
      payment,
      invoice: {
        amount_paid: newAmountPaid,
        status: newStatus,
      },
    });
  } catch (error) {
    console.error('Payment API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/invoices/[id]/payments - Get payments for an invoice
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params;
    const supabase = createServiceClient();

    const { data: payments, error } = await supabase
      .from('payments')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('payment_date', { ascending: false });

    if (error) {
      console.error('Payments fetch error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ payments: payments || [] });
  } catch (error) {
    console.error('Payments API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
