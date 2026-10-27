/**
 * Twilio voice webhook for the recorded inbound line. INACTIVE until a Twilio number's Voice URL points here.
 * Plays the recording notice, rings the shop, records the answered leg. Set the number's Voice *fallback* URL to
 * http://twimlets.com/forward?PhoneNumber=+17604408520 so a failure here still rings the shop (unrecorded).
 */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { buildInboundTwiml, buildSimulatorTwiml, buildVoicemailTwiml, buildAfterHoursAiTwiml } from '@/lib/phone-calls/twiml';
import { publicUrl, TRACKING_SOURCES, lineFor, isTestCall, RECORDING_NOTICE, aiFallbackNumber, directToAi } from '@/lib/phone-calls/config';
import { selectInHoursDial } from '@/lib/phone-calls/dial-plan';
import { desiredRingSeconds, dialTimeoutAttribute } from '@/lib/phone-calls/ring-timeout';
import { optionalServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
const xml = (b: string, status = 200) => new NextResponse(b, { status, headers: { 'Content-Type': 'text/xml' } });

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });

  const to = params.To || params.Called || '';
  const q = new URL(req.url).searchParams;
  // Test harness (signed requests only): ?sim=1 and a number calling itself = simulated shop answering.
  if (q.get('sim') === '1' && params.From && params.From === to) return xml(buildSimulatorTwiml());
  const line = lineFor(to, q.get('line'));
  const db: any = optionalServiceClient();
  if (db && params.CallSid) {
    // Best effort: never block ringing the shop on logging (table may not exist yet).
    try {
      await db.from('inbound_call_recordings').upsert({
        call_sid: params.CallSid, caller_number: params.From, tracking_number: to,
        source: isTestCall(params.From, q.get('test')) ? 'test' : line?.source ?? TRACKING_SOURCES[to] ?? 'main_line', caller_city: params.CallerCity || null, caller_state: params.CallerState || null,
        started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: 'call_sid' });
    } catch (e) { console.error('[phone-calls] log start failed', e instanceof Error ? e.message : e); }
  }
  const base = new URL(publicUrl(req)).origin;
  // After hours (default outside Mon-Fri 7:00-17:00 PT): skip the ring group, straight to Mike. No Twilio <Say>:
  // Mike speaks the recording notice himself in his first message, so callers hear Mike first.
  // ?at=<ISO> overrides the clock for signed test requests only (test=1).
  const ai = aiFallbackNumber(q);
  const atParam = q.get('test') === '1' ? q.get('at') : null;
  const at = atParam && Number.isFinite(Date.parse(atParam)) ? new Date(atParam) : new Date();
  if (ai && directToAi(at, ai)) {
    const a = new URLSearchParams(); if (line) a.set('line', line.key); a.set('afterhours', '1');
    return xml(buildAfterHoursAiTwiml({ aiNumber: ai, baseUrl: base, actionQuery: `?${a.toString()}` }));
  }
  // Per-number ring override via the (signed) voice URL, e.g. ?ring=+17604408520.
  // One shop number, then Mike. A longer shop list would delay him by another ~15s per number.
  const dial = selectInHoursDial({ to, ring: q.get('ring'), lineKey: line?.key ?? null, ai });
  if (dial.voicemail) return xml(buildVoicemailTwiml(base));
  if (dial.directToMike && ai) {
    const a = new URLSearchParams(); if (line) a.set('line', line.key); a.set('afterhours', '1');
    return xml(buildAfterHoursAiTwiml({ aiNumber: ai, baseUrl: base, actionQuery: `?${a.toString()}` }));
  }
  // Ringing the same Twilio number (test loop) needs our own caller ID; otherwise pass the caller's number through.
  const callerId = dial.shop.includes(to) ? to : undefined;
  // Caller-facing ring (default 15s). Twilio adds ~5s, so the TwiML attribute is 10.
  // Mike is the next number in this same dial, not a Google Voice forward and not a later webhook.
  const timeout = dialTimeoutAttribute(desiredRingSeconds(q.get('timeout')));
  const rollToMike = Boolean(dial.mike);
  // rolled=1: this dial already lists Mike, so a no-answer of the whole dial must not dial him again.
  // If Google Voice answers the shop number, sequential never reaches that second Number. AMD hangs
  // the shop leg up and the status callback still dials Mike. rolled=1 stays on this action so a
  // real no-answer (shop, then Mike) does not dial him a third time.
  return xml(buildInboundTwiml({
    notice: RECORDING_NOTICE, shopNumbers: dial.shop, baseUrl: base, callerId, timeout, nextNumber: dial.mike,
    actionQuery: (() => { const a = new URLSearchParams(); if (line) a.set('line', line.key); a.set('notice', '1'); if (rollToMike) { a.set('ai', '1'); a.set('rolled', '1'); } const t = a.toString(); return t ? `?${t}` : undefined; })(),
  }));
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'SCWS recorded inbound line' });
}
