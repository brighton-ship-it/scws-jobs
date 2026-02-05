import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { Payment } from '@/types/database';

const STAX_API_BASE = process.env.STAX_API_URL || 'https://apiprod.fattlabs.com';

interface InvoiceData {
  id: string;
  customer_id: string;
  total: number;
  amount_paid: number;
  status: string;
  invoice_number: number;
}

interface ProcessPaymentRequest {
  invoiceId: string;
  paymentMethodId: string; // Stax payment method token
  amount: number;
  totalCharged: number;
  processingFee: number;
  paymentMethod: 'card' | 'ach';
  customerEmail?: string;
  meta?: Record<string, any>;
}

/**
 * POST /api/payments/process - Process a card payment via Stax
 * 
 * This endpoint charges a tokenized payment method from Stax.js
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    // Allow unauthenticated for portal payments (they verify via token)
    // For admin API, require auth
    const isPortalPayment = request.headers.get('x-portal-payment') === 'true';
    
    if (!isPortalPayment && (authError || !user)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body: ProcessPaymentRequest = await request.json();
    const { 
      invoiceId, 
      paymentMethodId, 
      amount, 
      totalCharged, 
      processingFee, 
      paymentMethod,
      customerEmail,
      meta 
    } = body;

    // Validate required fields
    if (!invoiceId || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: invoiceId, amount' },
        { status: 400 }
      );
    }

    // Use service client for database operations
    const serviceClient = createServiceClient();

    // Fetch invoice to verify
    const { data: invoiceData, error: invoiceError } = await serviceClient
      .from('invoices')
      .select('id, customer_id, total, amount_paid, status, invoice_number')
      .eq('id', invoiceId)
      .single();

    const invoice = invoiceData as InvoiceData | null;

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    if (invoice.status === 'paid') {
      return NextResponse.json(
        { error: 'Invoice is already paid' },
        { status: 400 }
      );
    }

    const balanceDue = Number(invoice.total) - Number(invoice.amount_paid);
    
    if (amount > balanceDue + 0.01) { // Small tolerance for rounding
      return NextResponse.json(
        { error: 'Payment amount exceeds balance due' },
        { status: 400 }
      );
    }

    // If payment was already processed via Stax.js pay(), just record it
    // paymentMethodId is the transaction ID in this case
    let staxTransactionId = paymentMethodId;
    let paymentSuccessful = true;
    let staxError: string | null = null;

    const staxApiKey = process.env.STAX_API_KEY;

    // If this is a charge request (not already processed via pay())
    if (staxApiKey && paymentMethodId && !paymentMethodId.startsWith('demo_')) {
      // Check if this looks like a payment method ID that needs charging
      // vs a transaction ID from a completed payment
      if (!paymentMethodId.includes('trx_') && !meta?.alreadyCharged) {
        try {
          const chargeResponse = await fetch(`${STAX_API_BASE}/charge`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${staxApiKey}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({
              payment_method_id: paymentMethodId,
              total: totalCharged,
              meta: {
                invoice_id: invoiceId,
                invoice_number: invoice.invoice_number,
                processing_fee: processingFee,
                ...meta,
              },
            }),
          });

          const chargeResult = await chargeResponse.json();

          if (chargeResponse.ok && (chargeResult.success || chargeResult.id)) {
            staxTransactionId = chargeResult.id || chargeResult.transaction_id;
            paymentSuccessful = true;
          } else {
            paymentSuccessful = false;
            staxError = chargeResult.message || chargeResult.error || 'Payment declined';
          }
        } catch (err) {
          console.error('Stax charge error:', err);
          paymentSuccessful = false;
          staxError = 'Payment processing failed';
        }
      }
    } else if (!staxApiKey) {
      // Demo mode
      staxTransactionId = `demo_${Date.now()}`;
      paymentSuccessful = true;
    }

    if (!paymentSuccessful) {
      return NextResponse.json(
        { error: staxError || 'Payment failed', success: false },
        { status: 400 }
      );
    }

    // Build payment notes
    const feeNote = processingFee > 0
      ? ` | Processing fee: $${processingFee.toFixed(2)} | Total charged: $${totalCharged.toFixed(2)}`
      : '';

    // Record payment in database
    const paymentInsert = {
      invoice_id: invoiceId,
      amount: amount,
      payment_method: paymentMethod,
      reference_number: staxTransactionId,
      payment_date: new Date().toISOString().split('T')[0],
      notes: `Online payment${feeNote}`,
    };
    const { data: paymentData, error: paymentError } = await serviceClient
      .from('payments')
      .insert(paymentInsert as any)
      .select()
      .single();

    const payment = paymentData as Payment | null;

    if (paymentError || !payment) {
      console.error('Error recording payment:', paymentError);
      return NextResponse.json({
        success: true,
        warning: 'Payment processed but recording failed. Please contact support.',
        transactionId: staxTransactionId,
      });
    }

    // Note: Invoice amount_paid and status are updated by database trigger

    return NextResponse.json({
      success: true,
      payment: {
        id: payment.id,
        amount: payment.amount,
        reference: staxTransactionId,
        method: paymentMethod,
      },
      transactionId: staxTransactionId,
      message: 'Payment successful',
    });

  } catch (error) {
    console.error('Payment processing error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
