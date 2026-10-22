/** Child-leg status callback. Records whether the shop or Mike answered the parent call. */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { legCallbackCounts, recordAnsweredParty } from '@/lib/phone-calls/missed-alert';
import { optionalServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });
  const party = new URL(req.url).searchParams.get('party');
  const parent = params.ParentCallSid;
  if ((party === 'shop' || party === 'mike') && parent && legCallbackCounts(params)) {
    const db = optionalServiceClient();
    if (db) {
      try {
        await recordAnsweredParty(db, parent, party);
      } catch (e) { console.error('[phone-calls] leg failed', e instanceof Error ? e.message : e); }
    }
  }
  return new NextResponse('', { status: 200 });
}
