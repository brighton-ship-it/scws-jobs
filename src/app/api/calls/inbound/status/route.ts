/** <Dial action> callback: records how the dial ended and emails the office once per call. */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { EMPTY_RESPONSE, buildVoicemailTwiml, buildAiHandoffTwiml } from '@/lib/phone-calls/twiml';
import { publicUrl, PORTED_LINES, aiFallbackNumber } from '@/lib/phone-calls/config';
import { inboundCallEmailPlan, notifyMissedInboundCall, partyFromProcessing } from '@/lib/phone-calls/missed-alert';
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
  const mikeOnly = q.get('afterhours') === '1' || q.get('leg') === 'mike';
  let party: 'shop' | 'mike' | null = null;
  if (db && params.CallSid) {
    try {
      const loaded = await db.from('inbound_call_recordings').select('processing_error').eq('call_sid', params.CallSid).maybeSingle();
      party = partyFromProcessing(loaded?.data?.processing_error);
    } catch (e) { console.error('[phone-calls] answered-by lookup failed', e instanceof Error ? e.message : e); }
  }
  const plan = inboundCallEmailPlan({
    dialStatus: params.DialCallStatus,
    canHandoff,
    party,
    mikeOnly,
    mikeInDial: mikeOnly || q.get('rolled') === '1',
  });
  // Mike's one email is his end-of-call report. Shop and missed emails go out now.
  if (plan.send === 'now' && plan.who && params.CallSid) {
    const dur = parseInt(params.DialCallDuration || '', 10);
    try {
      await notifyMissedInboundCall({
        callSid: params.CallSid,
        caller: params.From,
        called: params.To || params.Called,
        phase: 'dial',
        noticePlayed: q.get('notice') === '1',
        who: plan.who,
        durationSeconds: plan.who === 'missed' ? null : (Number.isFinite(dur) ? dur : null),
      }, db);
    } catch (e) { console.error('[phone-calls] call alert failed', e instanceof Error ? e.message : e); }
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
