import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { createServiceClient as createServerServiceClient } from '@/lib/supabase/server';

/**
 * GET /api/debug/invoice-test?id=xxx
 * Debug endpoint to compare service client results
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // Test with service.ts client (used by portal)
  const serviceClient = createServiceClient();
  const { data: serviceInvoice, error: serviceError } = await serviceClient
    .from('invoices')
    .select('id, invoice_number, total, subtotal, issue_date, due_date')
    .eq('id', id)
    .single();

  const { data: serviceItems, error: serviceItemsError } = await serviceClient
    .from('invoice_items')
    .select('description, quantity, unit_price, total')
    .eq('invoice_id', id);

  // Test with server.ts client (used by internal API)
  const serverClient = createServerServiceClient();
  const { data: serverInvoice, error: serverError } = await serverClient
    .from('invoices')
    .select('id, invoice_number, total, subtotal, issue_date, due_date')
    .eq('id', id)
    .single();

  const { data: serverItems, error: serverItemsError } = await serverClient
    .from('invoice_items')
    .select('description, quantity, unit_price, total')
    .eq('invoice_id', id);

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    serviceClient: {
      invoice: serviceInvoice,
      items: serviceItems,
      errors: { invoice: serviceError?.message, items: serviceItemsError?.message },
    },
    serverClient: {
      invoice: serverInvoice,
      items: serverItems,
      errors: { invoice: serverError?.message, items: serverItemsError?.message },
    },
  });
}
