/**
 * Twilio voice webhook for the recorded inbound line. INACTIVE until a Twilio number's Voice URL points here.
 * Plays the recording notice, rings the shop, records the answered leg. Set the number's Voice *fallback* URL to
 * http://twimlets.com/forward?PhoneNumber=+17604408520 so a failure here still rings the shop (unrecorded).
 */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { buildInboundTwiml } from '@/lib/phone-calls/twiml';
import { shopNumbers, publicUrl, TRACKING_SOURCES } from '@/lib/phone-calls/config';
import { optionalServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
const xml = (b: string, status = 200) => new NextResponse(b, { status, headers: { 'Content-Type': 'text/xml' } });

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });

  const to = params.To || params.Called || '';
  const db: any = optionalServiceClient();
  if (db && params.CallSid) {
    // Best effort: never block ringing the shop on logging (table may not exist yet).
    try {
      await db.from('phone_call_log').upsert({
        call_sid: params.CallSid, caller_number: params.From, tracking_number: to,
        source: TRACKING_SOURCES[to] ?? 'main_line', caller_city: params.CallerCity || null, caller_state: params.CallerState || null,
        started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: 'call_sid' });
    } catch (e) { console.error('[phone-calls] log start failed', e instanceof Error ? e.message : e); }
  }
  const base = new URL(publicUrl(req)).origin;
  return xml(buildInboundTwiml({ shopNumbers: shopNumbers(), baseUrl: base }));
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'SCWS recorded inbound line' });
}
