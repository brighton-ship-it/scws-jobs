import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

interface PaymentRequest {
  paymentMethod: 'card' | 'ach';
  amount: number;
  // Processing fee (3% for card, 0 for ACH)
  processingFee?: number;
  // Total amount to charge (amount + processingFee)
  totalCharged?: number;
  // Card details (for Stax)
  cardToken?: string;
  // ACH details (for Stax)
  accountToken?: string;
  // If true, Stax.js pay() already processed this - just record it
  alreadyCharged?: boolean;
  // Transaction ID from Stax.js pay()
  transactionId?: string;
  // Customer info
  email?: string;
  name?: string;
  // ACH bank details (for server-side processing)
  firstName?: string;
  lastName?: string;
  bankType?: 'checking' | 'savings';
  bankHolderType?: 'personal' | 'business';
  bankAccount?: string;
  bankRouting?: string;
}

/**
 * POST /api/portal/[token]/invoices/[id]/pay - Process payment
 * 
 * Handles online payment through Stax payment gateway
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  try {
    const { token, id } = await params;
    const body: PaymentRequest = await request.json();
    
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

    // Get invoice and verify ownership
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, customer_id, total, amount_paid, status')
      .eq('id', id)
      .eq('customer_id', portalToken.customer_id)
      .single();

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

    const amountDue = Number(invoice.total) - Number(invoice.amount_paid);
    
    if (body.amount <= 0 || body.amount > amountDue) {
      return NextResponse.json(
        { error: 'Invalid payment amount' },
        { status: 400 }
      );
    }

    // Calculate processing fee if not provided (3% for card)
    const processingFee = body.processingFee ?? (body.paymentMethod === 'card' ? body.amount * 0.03 : 0);
    const totalToCharge = body.totalCharged ?? (body.amount + processingFee);
    
    // TODO: Integrate with Stax Payment Gateway
    // For now, we'll process a mock payment and record it
    // 
    // Real Stax integration would:
    // 1. Create payment method from card/ACH token
    // 2. Charge the payment method (totalToCharge includes fee)
    // 3. Handle success/failure
    // 4. Record the payment in our database
    
    const staxApiKey = process.env.STAX_API_KEY;
    const staxWebKey = process.env.NEXT_PUBLIC_STAX_WEB_PAYMENTS_KEY;
    let staxPaymentId: string | null = null;
    let paymentSuccessful = false;
    
    // Case 1: Already charged via Stax.js pay() - just record it
    if (body.alreadyCharged && body.transactionId) {
      paymentSuccessful = true;
      staxPaymentId = body.transactionId;
    }
    // Case 2: ACH payment - need to create payment method and charge
    else if (staxApiKey && body.paymentMethod === 'ach' && body.bankAccount && body.bankRouting) {
      try {
        // Step 1: Create payment method
        const createMethodResponse = await fetch('https://apiprod.fattlabs.com/payment-method', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${staxApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            method: 'bank',
            person_name: `${body.firstName || ''} ${body.lastName || ''}`.trim() || 'Customer',
            bank_account: body.bankAccount,
            bank_routing: body.bankRouting,
            bank_type: body.bankType || 'checking',
            bank_holder_type: body.bankHolderType || 'personal',
          }),
        });

        const methodResult = await createMethodResponse.json();
        
        if (!createMethodResponse.ok || !methodResult.id) {
          return NextResponse.json(
            { error: 'Failed to verify bank account', details: methodResult.message },
            { status: 400 }
          );
        }

        // Step 2: Charge the payment method
        const chargeResponse = await fetch('https://apiprod.fattlabs.com/charge', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${staxApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            payment_method_id: methodResult.id,
            total: totalToCharge,
            meta: {
              invoice_id: id,
              customer_id: portalToken.customer_id,
              processing_fee: processingFee,
            },
          }),
        });

        const chargeResult = await chargeResponse.json();
        
        if (chargeResponse.ok && (chargeResult.success !== false || chargeResult.id)) {
          paymentSuccessful = true;
          staxPaymentId = chargeResult.id;
        } else {
          return NextResponse.json(
            { error: 'ACH payment failed', details: chargeResult.message || 'Payment declined' },
            { status: 400 }
          );
        }
      } catch (staxError) {
        console.error('Stax ACH payment error:', staxError);
        return NextResponse.json(
          { error: 'Payment processing failed' },
          { status: 500 }
        );
      }
    }
    // Case 3: Card payment with existing token (shouldn't happen - card uses Stax.js pay())
    else if (staxApiKey && (body.cardToken || body.accountToken)) {
      try {
        const staxResponse = await fetch('https://apiprod.fattlabs.com/charge', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${staxApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            meta: {
              invoice_id: id,
              customer_id: portalToken.customer_id,
              processing_fee: processingFee,
            },
            total: totalToCharge,
            payment_method_id: body.cardToken || body.accountToken,
          }),
        });

        const staxResult = await staxResponse.json();
        
        if (staxResult.success || staxResult.id) {
          paymentSuccessful = true;
          staxPaymentId = staxResult.id;
        } else {
          return NextResponse.json(
            { error: 'Payment failed', details: staxResult.message || 'Payment declined' },
            { status: 400 }
          );
        }
      } catch (staxError) {
        console.error('Stax payment error:', staxError);
        return NextResponse.json(
          { error: 'Payment processing failed' },
          { status: 500 }
        );
      }
    } else {
      // Demo mode - simulate successful payment
      paymentSuccessful = true;
      staxPaymentId = `demo_${Date.now()}`;
    }

    if (paymentSuccessful) {
      // Build payment notes with fee info
      const feeNote = processingFee > 0 
        ? ` | Processing fee: $${processingFee.toFixed(2)} | Total charged: $${totalToCharge.toFixed(2)}`
        : '';
      
      // Record payment in database (amount is the invoice amount, fee is tracked in notes)
      const { data: payment, error: paymentError } = await supabase
        .from('payments')
        .insert({
          invoice_id: id,
          amount: body.amount, // Invoice amount (what gets credited to invoice)
          payment_method: body.paymentMethod,
          reference_number: staxPaymentId,
          payment_date: new Date().toISOString().split('T')[0],
          notes: `Online payment via customer portal${feeNote}`,
        })
        .select()
        .single();

      if (paymentError) {
        console.error('Error recording payment:', paymentError);
        // Payment went through but recording failed
        return NextResponse.json({
          success: true,
          warning: 'Payment processed but recording failed. Please contact support.',
          paymentId: staxPaymentId,
        });
      }

      // The trigger will automatically update invoice amount_paid and status

      return NextResponse.json({
        success: true,
        payment: {
          id: payment.id,
          amount: payment.amount,
          reference: staxPaymentId,
        },
        message: 'Payment successful! Thank you.',
      });
    }

    return NextResponse.json(
      { error: 'Payment could not be processed' },
      { status: 500 }
    );

  } catch (error) {
    console.error('Portal payment API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/portal/[token]/invoices/[id]/pay - Get payment info
 * 
 * Returns Stax client key for frontend payment form
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

    // Validate token
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

    // Get invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, total, amount_paid, status')
      .eq('id', id)
      .eq('customer_id', portalToken.customer_id)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    const amountDue = Number(invoice.total) - Number(invoice.amount_paid);

    return NextResponse.json({
      invoiceId: id,
      amountDue,
      isPaid: invoice.status === 'paid',
      // Stax web payment key for client-side tokenization
      staxWebPaymentsKey: process.env.NEXT_PUBLIC_STAX_WEB_PAYMENTS_KEY || null,
      // Card processing fee (e.g., 3%)
      cardFeePercent: 3.0,
      // ACH fee (flat or percentage)
      achFeeFlat: 0,
    });

  } catch (error) {
    console.error('Portal payment info API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
