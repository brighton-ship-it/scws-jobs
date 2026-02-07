import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { syncInvoiceToQBO } from '@/lib/quickbooks/service';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { invoiceId } = body;

    if (!invoiceId) {
      return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 });
    }

    const qbInvoiceId = await syncInvoiceToQBO(invoiceId);

    return NextResponse.json({ 
      success: true, 
      qbInvoiceId,
      message: 'Invoice synced to QuickBooks' 
    });
  } catch (error) {
    console.error('QuickBooks invoice sync error:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync invoice';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
