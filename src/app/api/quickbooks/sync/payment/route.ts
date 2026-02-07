import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { syncPaymentToQBO } from '@/lib/quickbooks/service';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { paymentId } = body;

    if (!paymentId) {
      return NextResponse.json({ error: 'Payment ID is required' }, { status: 400 });
    }

    const qbPaymentId = await syncPaymentToQBO(paymentId);

    return NextResponse.json({ 
      success: true, 
      qbPaymentId,
      message: 'Payment synced to QuickBooks' 
    });
  } catch (error) {
    console.error('QuickBooks payment sync error:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync payment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
