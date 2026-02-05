import { NextRequest, NextResponse } from 'next/server';
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

interface ACHPaymentRequest {
  invoiceId: string;
  amount: number;
  processingFee?: number;
  totalCharged?: number;
  firstName: string;
  lastName: string;
  email?: string;
  bankType: 'checking' | 'savings';
  bankHolderType: 'personal' | 'business';
  bankAccount: string;
  bankRouting: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
}

/**
 * POST /api/payments/ach - Process an ACH payment
 * 
 * Creates a bank payment method in Stax and charges it
 */
export async function POST(request: NextRequest) {
  try {
    const body: ACHPaymentRequest = await request.json();
    const {
      invoiceId,
      amount,
      processingFee = 0,
      totalCharged = amount,
      firstName,
      lastName,
      email,
      bankType,
      bankHolderType,
      bankAccount,
      bankRouting,
      address1,
      city,
      state,
      zip,
    } = body;

    // Validate required fields
    if (!invoiceId || !amount || !firstName || !lastName || !bankAccount || !bankRouting) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate routing number (9 digits)
    if (!/^\d{9}$/.test(bankRouting)) {
      return NextResponse.json(
        { error: 'Invalid routing number. Must be 9 digits.' },
        { status: 400 }
      );
    }

    // Validate account number (typically 4-17 digits)
    if (!/^\d{4,17}$/.test(bankAccount)) {
      return NextResponse.json(
        { error: 'Invalid account number' },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();

    // Verify invoice exists and is payable
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

    if (amount > balanceDue + 0.01) {
      return NextResponse.json(
        { error: 'Payment amount exceeds balance due' },
        { status: 400 }
      );
    }

    const staxApiKey = process.env.STAX_API_KEY;
    const staxWebKey = process.env.NEXT_PUBLIC_STAX_WEB_PAYMENTS_KEY;
    let staxTransactionId: string | null = null;
    let paymentSuccessful = false;

    if (staxApiKey) {
      try {
        // Step 1: Create a payment method (tokenize the bank account)
        // For ACH, we need to create a customer + payment method + charge
        
        // Using the charge endpoint with bank details
        const chargeResponse = await fetch(`${STAX_API_BASE}/charge`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${staxApiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            total: totalCharged,
            meta: {
              invoice_id: invoiceId,
              invoice_number: invoice.invoice_number,
              processing_fee: processingFee,
              payment_type: 'ach',
            },
            // Customer details
            firstname: firstName,
            lastname: lastName,
            email: email || undefined,
            // Bank details
            method: 'bank',
            bank_type: bankType,
            bank_holder_type: bankHolderType,
            bank_account: bankAccount,
            bank_routing: bankRouting,
            // Address (optional but recommended)
            address_1: address1 || undefined,
            address_city: city || undefined,
            address_state: state || undefined,
            address_zip: zip || undefined,
          }),
        });

        const chargeResult = await chargeResponse.json();

        if (chargeResponse.ok && (chargeResult.success || chargeResult.id)) {
          staxTransactionId = chargeResult.id || chargeResult.transaction_id;
          paymentSuccessful = true;
        } else {
          console.error('Stax ACH error:', chargeResult);
          return NextResponse.json(
            { 
              error: chargeResult.message || 'ACH payment failed',
              details: chargeResult.errors || chargeResult.error,
              success: false 
            },
            { status: 400 }
          );
        }
      } catch (err) {
        console.error('Stax ACH charge error:', err);
        return NextResponse.json(
          { error: 'ACH payment processing failed', success: false },
          { status: 500 }
        );
      }
    } else {
      // Demo mode
      staxTransactionId = `demo_ach_${Date.now()}`;
      paymentSuccessful = true;
    }

    if (!paymentSuccessful) {
      return NextResponse.json(
        { error: 'Payment failed', success: false },
        { status: 400 }
      );
    }

    // Record payment in database
    // Note: ACH payments may be pending until they clear
    const paymentInsert = {
      invoice_id: invoiceId,
      amount: amount,
      payment_method: 'ach' as const,
      reference_number: staxTransactionId,
      payment_date: new Date().toISOString().split('T')[0],
      notes: `ACH payment - ${bankType} ${bankHolderType} account ending in ${bankAccount.slice(-4)}`,
    };
    const { data: paymentData, error: paymentError } = await serviceClient
      .from('payments')
      .insert(paymentInsert as any)
      .select()
      .single();

    const payment = paymentData as Payment | null;

    if (paymentError || !payment) {
      console.error('Error recording ACH payment:', paymentError);
      return NextResponse.json({
        success: true,
        warning: 'Payment initiated but recording failed. Please contact support.',
        transactionId: staxTransactionId,
      });
    }

    return NextResponse.json({
      success: true,
      payment: {
        id: payment.id,
        amount: payment.amount,
        reference: staxTransactionId,
        method: 'ach',
      },
      transactionId: staxTransactionId,
      message: 'ACH payment initiated. Funds typically transfer within 2-3 business days.',
    });

  } catch (error) {
    console.error('ACH payment error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
