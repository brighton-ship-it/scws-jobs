/** <Dial action> callback: records how the shop leg ended. Returns empty TwiML (call ends). */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { EMPTY_RESPONSE, buildVoicemailTwiml, buildMikeTwiml } from '@/lib/phone-calls/twiml';
import { publicUrl, PORTED_LINES, mikeNumber } from '@/lib/phone-calls/config';
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
        call_sid: params.CallSid,
        ...(new URL(req.url).searchParams.get('stage') === 'mike'
          ? { dial_status: `mike-${params.DialCallStatus || 'unknown'}` }
          : { dial_status: params.DialCallStatus || null, duration_seconds: Number.isFinite(dur) ? dur : null, answered: params.DialCallStatus === 'completed' }),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'call_sid' });
    } catch (e) { console.error('[phone-calls] status failed', e instanceof Error ? e.message : e); }
  }
  const sp = new URL(req.url).searchParams; const line = sp.get('line');
  if (line && PORTED_LINES[line] && params.DialCallStatus !== 'completed') {
    const origin = new URL(publicUrl(req)).origin;
    // GV leg unanswered -> Mike; Mike leg failed -> voicemail (last resort).
    const body = sp.get('stage') === 'mike' ? buildVoicemailTwiml(origin) : buildMikeTwiml({ mike: mikeNumber(), baseUrl: origin, line });
    return new NextResponse(body, { headers: { 'Content-Type': 'text/xml' } });
  }
  return new NextResponse(EMPTY_RESPONSE, { headers: { 'Content-Type': 'text/xml' } });
}
