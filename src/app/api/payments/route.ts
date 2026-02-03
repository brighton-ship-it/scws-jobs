import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Type definitions for payment requests
interface PaymentIntentRequest {
  invoiceId: string;
  paymentMethod: 'ach' | 'card';
  amount: number;
  feeAmount?: number;
  customerEmail?: string;
}

interface PaymentConfirmRequest {
  invoiceId: string;
  paymentIntentId: string;
  paymentMethod: 'ach' | 'card';
  amount: number;
  feeAmount?: number;
}

/**
 * POST /api/payments - Create a payment intent
 * 
 * Creates a payment record and initiates payment processing with Stax
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body: PaymentIntentRequest = await request.json();
    const { invoiceId, paymentMethod, amount, feeAmount = 0, customerEmail } = body;

    // Validate required fields
    if (!invoiceId || !paymentMethod || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: invoiceId, paymentMethod, amount' },
        { status: 400 }
      );
    }

    // Validate payment amount
    if (amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid payment amount' },
        { status: 400 }
      );
    }

    // TODO: Fetch invoice from database to verify amount and status
    // const { data: invoice, error: invoiceError } = await supabase
    //   .from('invoices')
    //   .select('*')
    //   .eq('id', invoiceId)
    //   .single();

    // TODO: Validate invoice exists and is payable
    // if (invoiceError || !invoice) {
    //   return NextResponse.json(
    //     { error: 'Invoice not found' },
    //     { status: 404 }
    //   );
    // }

    // TODO: Check if invoice is already paid
    // if (invoice.status === 'paid') {
    //   return NextResponse.json(
    //     { error: 'Invoice is already paid' },
    //     { status: 400 }
    //   );
    // }

    // TODO: Integrate with Stax Payment Gateway
    // For ACH payments:
    // 1. Create Stax payment method (bank account verification)
    // 2. Create payment intent with ACH as method
    // 3. Return client secret for bank verification flow
    //
    // For Card payments:
    // 1. Create Stax payment intent with card method
    // 2. Return client secret for card form
    // 3. Include fee amount in the total
    
    // TODO: Call Stax API
    // const staxResponse = await fetch('https://api.staxpayments.com/v1/payment-intents', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${process.env.STAX_SECRET_KEY}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     amount: Math.round(amount * 100), // Convert to cents
    //     currency: 'usd',
    //     payment_method_types: [paymentMethod === 'ach' ? 'ach_debit' : 'card'],
    //     metadata: {
    //       invoice_id: invoiceId,
    //       fee_amount: feeAmount,
    //     },
    //   }),
    // });
    
    // const paymentIntent = await staxResponse.json();

    // TODO: Store payment intent in database
    // const { data: payment, error: paymentError } = await supabase
    //   .from('payments')
    //   .insert({
    //     invoice_id: invoiceId,
    //     amount: amount,
    //     fee_amount: feeAmount,
    //     payment_method: paymentMethod,
    //     status: 'pending',
    //     payment_intent_id: paymentIntent.id,
    //     created_by: user.id,
    //   })
    //   .select()
    //   .single();

    // Temporary mock response until Stax integration is complete
    const mockPaymentIntent = {
      id: `pi_mock_${Date.now()}`,
      clientSecret: `mock_secret_${Date.now()}`,
      amount: Math.round(amount * 100),
      status: 'requires_payment_method',
    };

    return NextResponse.json({
      success: true,
      paymentIntent: mockPaymentIntent,
      message: 'Payment intent created (mock - Stax integration pending)',
    });

  } catch (error) {
    console.error('Payment API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/payments - Confirm a payment
 * 
 * Updates payment status after successful payment processing
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body: PaymentConfirmRequest = await request.json();
    const { invoiceId, paymentIntentId, paymentMethod, amount, feeAmount = 0 } = body;

    // Validate required fields
    if (!invoiceId || !paymentIntentId) {
      return NextResponse.json(
        { error: 'Missing required fields: invoiceId, paymentIntentId' },
        { status: 400 }
      );
    }

    // TODO: Verify payment with Stax
    // const staxResponse = await fetch(`https://api.staxpayments.com/v1/payment-intents/${paymentIntentId}`, {
    //   method: 'GET',
    //   headers: {
    //     'Authorization': `Bearer ${process.env.STAX_SECRET_KEY}`,
    //   },
    // });
    
    // const paymentStatus = await staxResponse.json();
    
    // if (paymentStatus.status !== 'succeeded') {
    //   return NextResponse.json(
    //     { error: 'Payment not completed', status: paymentStatus.status },
    //     { status: 400 }
    //   );
    // }

    // TODO: Update payment record in database
    // const { error: updateError } = await supabase
    //   .from('payments')
    //   .update({
    //     status: 'completed',
    //     paid_at: new Date().toISOString(),
    //   })
    //   .eq('payment_intent_id', paymentIntentId);

    // TODO: Update invoice status and amount_paid
    // const { error: invoiceUpdateError } = await supabase
    //   .from('invoices')
    //   .update({
    //     amount_paid: amount,
    //     status: 'paid',
    //     paid_at: new Date().toISOString(),
    //   })
    //   .eq('id', invoiceId);

    // TODO: Send payment confirmation email to customer

    return NextResponse.json({
      success: true,
      message: 'Payment confirmed (mock - Stax integration pending)',
    });

  } catch (error) {
    console.error('Payment confirmation error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/payments?invoiceId=xxx - Get payments for an invoice
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const invoiceId = searchParams.get('invoiceId');

    if (!invoiceId) {
      return NextResponse.json(
        { error: 'Missing invoiceId parameter' },
        { status: 400 }
      );
    }

    // TODO: Fetch payments from database
    // const { data: payments, error } = await supabase
    //   .from('payments')
    //   .select('*')
    //   .eq('invoice_id', invoiceId)
    //   .order('created_at', { ascending: false });

    // if (error) {
    //   return NextResponse.json(
    //     { error: 'Failed to fetch payments' },
    //     { status: 500 }
    //   );
    // }

    // Temporary mock response
    return NextResponse.json({
      success: true,
      payments: [],
      message: 'Payments fetched (mock - database integration pending)',
    });

  } catch (error) {
    console.error('Get payments error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
