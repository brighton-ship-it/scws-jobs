/** <Dial action> callback: records how the dial ended. Missed calls that never reach Mike email the office. */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { EMPTY_RESPONSE, buildVoicemailTwiml, buildAiHandoffTwiml } from '@/lib/phone-calls/twiml';
import { publicUrl, PORTED_LINES, aiFallbackNumber } from '@/lib/phone-calls/config';
import { notifyMissedInboundCall, statusCallbackPlan } from '@/lib/phone-calls/missed-alert';
import { optionalServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });
  const db: any = optionalServiceClient();
  if (db && params.CallSid) {
    const dur = parseInt(params.DialCallDuration || '', 10);
    const dialStatus = (params.DialCallStatus || '').toLowerCase();
    try {
      await db.from('inbound_call_recordings').upsert({
        call_sid: params.CallSid, dial_status: params.DialCallStatus || null,
        duration_seconds: Number.isFinite(dur) ? dur : null, answered: dialStatus === 'completed' || dialStatus === 'answered',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'call_sid' });
    } catch (e) { console.error('[phone-calls] status failed', e instanceof Error ? e.message : e); }
  }
  const line = new URL(req.url).searchParams.get('line');
  const q = new URL(req.url).searchParams;
  const ai = aiFallbackNumber(q);
  // rolled=1: Mike was already the next number in this dial (or this request is his leg).
  // afterhours=1: the only leg was Mike. A canceled dial means the caller is gone.
  const canHandoff = Boolean(ai) && q.get('rolled') !== '1' && q.get('afterhours') !== '1' && params.To !== ai;
  const plan = statusCallbackPlan({ dialStatus: params.DialCallStatus, canHandoff });
  if (plan.alert && params.CallSid) {
    try {
      await notifyMissedInboundCall({
        callSid: params.CallSid,
        caller: params.From,
        called: params.To || params.Called,
        phase: 'dial',
        noticePlayed: q.get('notice') === '1',
      }, db);
    } catch (e) { console.error('[phone-calls] missed alert failed', e instanceof Error ? e.message : e); }
  }
  // Shop leg not answered, caller still here, Mike not dialed yet.
  if (plan.handoff && ai) {
    return new NextResponse(buildAiHandoffTwiml(ai, new URL(publicUrl(req)).origin, '?rolled=1&leg=mike'), { headers: { 'Content-Type': 'text/xml' } });
  }
  const dial = (params.DialCallStatus || '').toLowerCase();
  if (line && PORTED_LINES[line] && dial !== 'completed' && dial !== 'answered') {
    return new NextResponse(buildVoicemailTwiml(new URL(publicUrl(req)).origin), { headers: { 'Content-Type': 'text/xml' } });
  }
  return new NextResponse(EMPTY_RESPONSE, { headers: { 'Content-Type': 'text/xml' } });
}
