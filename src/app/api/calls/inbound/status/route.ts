/** <Dial action> callback: records how the shop leg ended. Returns empty TwiML (call ends). */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { EMPTY_RESPONSE, buildVoicemailTwiml } from '@/lib/phone-calls/twiml';
import { publicUrl, PORTED_LINES } from '@/lib/phone-calls/config';
import { optionalServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });
  const db: any = optionalServiceClient();
  if (db && params.CallSid) {
    const dur = parseInt(params.DialCallDuration || '', 10);
    try {
      await db.from('inbound_call_recordings').upsert({
        call_sid: params.CallSid, dial_status: params.DialCallStatus || null,
        duration_seconds: Number.isFinite(dur) ? dur : null, answered: params.DialCallStatus === 'completed',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'call_sid' });
    } catch (e) { console.error('[phone-calls] status failed', e instanceof Error ? e.message : e); }
  }
  const line = new URL(req.url).searchParams.get('line');
  if (line && PORTED_LINES[line] && params.DialCallStatus !== 'completed') {
    return new NextResponse(buildVoicemailTwiml(new URL(publicUrl(req)).origin), { headers: { 'Content-Type': 'text/xml' } });
  }
  return new NextResponse(EMPTY_RESPONSE, { headers: { 'Content-Type': 'text/xml' } });
}
