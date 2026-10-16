/**
 * Twilio voice webhook for the recorded inbound line. INACTIVE until a Twilio number's Voice URL points here.
 * Plays the recording notice, rings the shop, records the answered leg. Set the number's Voice *fallback* URL to
 * http://twimlets.com/forward?PhoneNumber=+17604408520 so a failure here still rings the shop (unrecorded).
 */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { buildInboundTwiml, buildSimulatorTwiml, buildVoicemailTwiml } from '@/lib/phone-calls/twiml';
import { shopNumbers, publicUrl, TRACKING_SOURCES, lineFor, forwardTargets, isTestCall } from '@/lib/phone-calls/config';
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
  // Per-number ring override via the (signed) voice URL, e.g. ?ring=+17604408520
  const ring = q.get('ring')?.split(',').map((x) => x.trim()).filter((x) => /^\+\d{10,15}$/.test(x));
  const targets = ring?.length ? ring : line ? forwardTargets(line) : shopNumbers();
  // Ported line with no forward target configured: never loop back into itself; take a voicemail instead.
  if (line && (!targets.length || targets.includes(line.number))) return xml(buildVoicemailTwiml(base));
  // Ringing the same Twilio number (test loop) needs our own caller ID; otherwise pass the caller's number through.
  const callerId = targets.includes(to) ? to : undefined;
  // Ring timeout (s): default 60 so a Google Voice ring group can roll to Mike (~35s) before Twilio gives up.
  const t = parseInt(q.get('timeout') || process.env.PHONE_CALL_RING_TIMEOUT || '60', 10);
  const timeout = Number.isFinite(t) ? Math.min(Math.max(t, 10), 120) : 60;
  return xml(buildInboundTwiml({ shopNumbers: targets, baseUrl: base, callerId, timeout, actionQuery: (() => { const a = new URLSearchParams(); if (line) a.set('line', line.key); if (q.get('ai') === '1') a.set('ai', '1'); const t = a.toString(); return t ? `?${t}` : undefined; })() }));
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'SCWS recorded inbound line' });
}
