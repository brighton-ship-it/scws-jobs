/** Child-leg status callback. Records whether the shop or Mike answered the parent call.
 * An in-progress shop leg is Google Voice (or voicemail) accepting the dial, not a person.
 * AMD decides that case. Mike's in-progress leg is still recorded. */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { recordAnsweredParty } from '@/lib/phone-calls/missed-alert';
import { shopLegRecordsAnswer } from '@/lib/phone-calls/shop-amd';
import { optionalServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });
  const party = new URL(req.url).searchParams.get('party');
  const parent = params.ParentCallSid;
  if ((party === 'shop' || party === 'mike') && parent) {
    const db = optionalServiceClient();
    if (db) {
      let processing: string | null = null;
      if (party === 'shop') {
        try {
          const loaded = await db.from('inbound_call_recordings').select('processing_error').eq('call_sid', parent).maybeSingle();
          processing = loaded?.data?.processing_error ?? null;
        } catch (e) { console.error('[phone-calls] leg lookup failed', e instanceof Error ? e.message : e); }
      }
      if (shopLegRecordsAnswer({ party, params, processingError: processing })) {
        try {
          await recordAnsweredParty(db, parent, party);
        } catch (e) { console.error('[phone-calls] leg failed', e instanceof Error ? e.message : e); }
      }
    }
  }
  return new NextResponse('', { status: 200 });
}
