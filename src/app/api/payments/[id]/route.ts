import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { Payment } from '@/types/database';

const STAX_API_BASE = process.env.STAX_API_URL || 'https://apiprod.fattlabs.com';

interface PaymentWithInvoice extends Payment {
  invoice: {
    id: string;
    invoice_number: number;
    customer_id: string;
    total: number;
    amount_paid: number;
    status: string;
    customer: {
      id: string;
      name: string;
      email: string | null;
    } | null;
  } | null;
}

/**
 * GET /api/payments/[id] - Get payment status
 * 
 * Retrieves payment details from database and optionally syncs with Stax
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Fetch payment from database
    const { data, error: paymentError } = await supabase
      .from('payments')
      .select(`
        *,
        invoice:invoices (
          id,
          invoice_number,
          customer_id,
          total,
          amount_paid,
          status,
          customer:customers (
            id,
            name,
            email
          )
        )
      `)
      .eq('id', id)
      .single();
    
    const payment = data as PaymentWithInvoice | null;

    if (paymentError || !payment) {
      return NextResponse.json(
        { error: 'Payment not found' },
        { status: 404 }
      );
    }

    // Optionally fetch status from Stax if we have a reference number
    let staxStatus = null;
    const staxApiKey = process.env.STAX_API_KEY;
    
    if (staxApiKey && payment.reference_number && !payment.reference_number.startsWith('demo_')) {
      try {
        const staxResponse = await fetch(
          `${STAX_API_BASE}/transaction/${payment.reference_number}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${staxApiKey}`,
              'Accept': 'application/json',
            },
          }
        );

        if (staxResponse.ok) {
          const staxData = await staxResponse.json();
          staxStatus = {
            id: staxData.id,
            status: staxData.success ? 'completed' : 'failed',
            type: staxData.type,
            total: staxData.total,
            created_at: staxData.created_at,
            message: staxData.message,
            is_refunded: staxData.is_refunded,
            is_voided: staxData.is_voided,
          };
        }
      } catch (err) {
        console.error('Error fetching Stax transaction:', err);
        // Don't fail the request, just return local data
      }
    }

    return NextResponse.json({
      success: true,
      payment: {
        id: payment.id,
        invoice_id: payment.invoice_id,
        amount: payment.amount,
        payment_method: payment.payment_method,
        payment_date: payment.payment_date,
        reference_number: payment.reference_number,
        notes: payment.notes,
        created_at: payment.created_at,
        invoice: payment.invoice,
      },
      staxStatus,
    });

  } catch (error) {
    console.error('Get payment error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/payments/[id] - Void/refund a payment
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the payment
    const { data: paymentData, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', id)
      .single();

    const payment = paymentData as Payment | null;

    if (paymentError || !payment) {
      return NextResponse.json(
        { error: 'Payment not found' },
        { status: 404 }
      );
    }

    const staxApiKey = process.env.STAX_API_KEY;
    let refundSuccessful = false;
    const referenceNumber = payment.reference_number;

    // Attempt refund via Stax if we have a valid reference
    if (staxApiKey && referenceNumber && !referenceNumber.startsWith('demo_')) {
      try {
        // First try to void (if same day), then refund
        const voidResponse = await fetch(
          `${STAX_API_BASE}/transaction/${referenceNumber}/void`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${staxApiKey}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
          }
        );

        if (voidResponse.ok) {
          refundSuccessful = true;
        } else {
          // Try refund instead
          const refundResponse = await fetch(
            `${STAX_API_BASE}/transaction/${referenceNumber}/refund`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${staxApiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify({
                total: payment.amount,
              }),
            }
          );

          if (refundResponse.ok) {
            refundSuccessful = true;
          } else {
            const refundError = await refundResponse.json();
            return NextResponse.json(
              { error: 'Failed to refund payment', details: refundError.message },
              { status: 400 }
            );
          }
        }
      } catch (err) {
        console.error('Stax refund error:', err);
        return NextResponse.json(
          { error: 'Failed to process refund' },
          { status: 500 }
        );
      }
    } else {
      // Demo mode - just delete from database
      refundSuccessful = true;
    }

    if (refundSuccessful) {
      // Delete payment from database (trigger will update invoice)
      const { error: deleteError } = await supabase
        .from('payments')
        .delete()
        .eq('id', id);

      if (deleteError) {
        console.error('Error deleting payment record:', deleteError);
        return NextResponse.json(
          { error: 'Payment refunded but failed to update records' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'Payment voided/refunded successfully',
      });
    }

    return NextResponse.json(
      { error: 'Failed to process refund' },
      { status: 500 }
    );

  } catch (error) {
    console.error('Refund payment error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
