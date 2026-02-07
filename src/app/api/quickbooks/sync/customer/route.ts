import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { syncCustomerToQBO } from '@/lib/quickbooks/service';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { customerId } = body;

    if (!customerId) {
      return NextResponse.json({ error: 'Customer ID is required' }, { status: 400 });
    }

    const qbCustomerId = await syncCustomerToQBO(customerId);

    return NextResponse.json({ 
      success: true, 
      qbCustomerId,
      message: 'Customer synced to QuickBooks' 
    });
  } catch (error) {
    console.error('QuickBooks customer sync error:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync customer';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
