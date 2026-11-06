/** <Dial action> callback: records how the dial ended and emails the office once per call. */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { EMPTY_RESPONSE, buildVoicemailTwiml, buildAiHandoffTwiml } from '@/lib/phone-calls/twiml';
import { publicUrl, PORTED_LINES, aiFallbackNumber } from '@/lib/phone-calls/config';
import { amdFromProcessing, inboundCallEmailPlan, noteAwaitLegEvidence, noteMikeAwaitingReport, notifyMissedInboundCall, partyFromProcessing } from '@/lib/phone-calls/missed-alert';
import { optionalServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });
  const db: any = optionalServiceClient();
  const dur = parseInt(params.DialCallDuration || '', 10);
  const shopSeconds = Number.isFinite(dur) ? dur : null;
  const dialStatus = (params.DialCallStatus || '').toLowerCase();
  if (db && params.CallSid) {
    try {
      await db.from('inbound_call_recordings').upsert({
        call_sid: params.CallSid, dial_status: params.DialCallStatus || null,
        duration_seconds: shopSeconds, answered: dialStatus === 'completed' || dialStatus === 'answered',
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
  const mikeInDial = mikeOnly || q.get('rolled') === '1';
  let party: 'shop' | 'mike' | null = null;
  let processingError: string | null = null;
  if (db && params.CallSid) {
    try {
      const loaded = await db.from('inbound_call_recordings').select('processing_error').eq('call_sid', params.CallSid).maybeSingle();
      processingError = loaded?.data?.processing_error ?? null;
      party = partyFromProcessing(processingError);
    } catch (e) { console.error('[phone-calls] answered-by lookup failed', e instanceof Error ? e.message : e); }
  }
  // AMD hangs up a Google Voice/voicemail shop leg while the caller is still here.
  // rolled=1 stays set (Mike was listed on the sequential dial) but that leg never started.
  // Mike's own follow-up action (leg=mike / after hours) must not dial him again.
  // answered_by=human is a shop answer even when DialCallDuration is under 20s.
  // DialBridged is true for Google Voice too, so it does not by itself skip the email.
  const amd = amdFromProcessing(processingError);
  const answeredBy = (params.AnsweredBy || '').trim().toLowerCase();
  const shopMachine = amd === 'machine' && !mikeOnly;
  const shopHuman = !mikeOnly && !shopMachine && (amd === 'human' || answeredBy === 'human');
  const plan = inboundCallEmailPlan({
    dialStatus: params.DialCallStatus,
    canHandoff,
    party,
    mikeOnly,
    mikeInDial,
    shopSeconds,
    shopMachine,
    shopHuman,
  });
  // Mike's email is his end-of-call report. Nobody answered: email now.
  // A recorded shop leg, including a couple of seconds, does not.
  if (plan.send === 'now' && plan.who && params.CallSid) {
    try {
      await notifyMissedInboundCall({
        callSid: params.CallSid,
        caller: params.From,
        called: params.To || params.Called,
        phase: 'dial',
        noticePlayed: q.get('notice') === '1',
        who: plan.who,
        durationSeconds: plan.who === 'missed' ? null : shopSeconds,
      }, db);
    } catch (e) { console.error('[phone-calls] call alert failed', e instanceof Error ? e.message : e); }
  }
  // Answered, but the child callback has not said who.
  // Mike in the dial: his report is the email, or one missed email if it never comes.
  // Shop-only: wait for the shop child. A 1–3s answer often finishes the parent first.
  if (plan.send === 'defer' && !party && db && params.CallSid) {
    try {
      if (mikeInDial && plan.who === 'mike') await noteMikeAwaitingReport(db, params.CallSid);
      else if (!mikeInDial) await noteAwaitLegEvidence(db, params.CallSid);
    } catch (e) { console.error('[phone-calls] answer-wait note failed', e instanceof Error ? e.message : e); }
  }
  // Caller still here and Mike has not been dialed: shop no-answer, or AMD hung up a machine.
  if (plan.handoff && ai) {
    return new NextResponse(buildAiHandoffTwiml(ai, new URL(publicUrl(req)).origin, '?rolled=1&leg=mike'), { headers: { 'Content-Type': 'text/xml' } });
  }
  const dial = (params.DialCallStatus || '').toLowerCase();
  if (line && PORTED_LINES[line] && dial !== 'completed' && dial !== 'answered') {
    return new NextResponse(buildVoicemailTwiml(new URL(publicUrl(req)).origin), { headers: { 'Content-Type': 'text/xml' } });
  }
  return new NextResponse(EMPTY_RESPONSE, { headers: { 'Content-Type': 'text/xml' } });
}
