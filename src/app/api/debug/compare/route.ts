import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient as createPortalClient } from '@/lib/supabase/service';
import { createServiceClient as createServerClient } from '@/lib/supabase/server';

/**
 * GET /api/debug/compare?id=xxx
 * Compare both clients querying the SAME invoice
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id') || '1ab1db76-48b2-47e8-a0c2-01439c736028';

  // Portal client (service.ts)
  const portalClient = createPortalClient();
  const { data: portalInvoice } = await portalClient
    .from('invoices')
    .select('id, total, subtotal, due_date')
    .eq('id', id)
    .single();

  // Server client (server.ts)
  const serverClient = createServerClient();
  const { data: serverInvoice } = await serverClient
    .from('invoices')
    .select('id, total, subtotal, due_date')
    .eq('id', id)
    .single();

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    env: {
      portalUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 40),
      serverUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 40),
      hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY,
    },
    portalClient: portalInvoice,
    serverClient: serverInvoice,
    match: JSON.stringify(portalInvoice) === JSON.stringify(serverInvoice),
  });
}
