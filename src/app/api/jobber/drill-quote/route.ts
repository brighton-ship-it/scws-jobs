import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import { createDrillQuote } from '@/lib/jobber/drill-quote';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * POST /api/jobber/drill-quote
 * Auth: Authorization: Bearer <CRON_SECRET>
 * Creates ONE unsent air-rotary new-well Jobber quote from nearby DWR WCRs.
 * Fails closed if DWR has no domestic depths — does not invent footage.
 */
export async function POST(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (!cronAuth.ok) {
    cronUnauthorizedLog(cronAuth.reason);
    return unauthorized();
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      apn?: string;
      address?: string;
      notes?: string;
      clientId?: string;
      clientName?: string;
      phone?: string;
      email?: string;
      lat?: number;
      lng?: number;
      city?: string;
      method?: 'air' | 'mud';
    };

    const result = await createDrillQuote({
      apn: body.apn,
      address: body.address,
      notes: body.notes,
      clientId: body.clientId,
      clientName: body.clientName,
      phone: body.phone,
      email: body.email,
      lat: body.lat,
      lng: body.lng,
      city: body.city,
      method: body.method,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          ...result,
          sentAt: null,
          draft: true,
          note: 'Drafts stay unsent. Footage was not invented.',
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ...result,
      sentAt: null,
      draft: true,
      note: 'Drafts stay unsent. sentAt is null. transitionQuoteTo was not set.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create drill quote';
    const status = /required|refusing|Could not resolve|not found/i.test(message) ? 400 : 500;
    console.error('[drill-quote]', message);
    return NextResponse.json({ error: message, sentAt: null, draft: true }, { status });
  }
}
