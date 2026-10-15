/**
 * Twilio asks for this when an outbound Mike callback is answered.
 * A machine gets one short voicemail. A person hears the recording notice,
 * then the call is handed to Mike's existing assistant.
 */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { publicUrl } from '@/lib/phone-calls/config';
import { optionalServiceClient } from '@/lib/supabase/service';
import {
  amdKind,
  callbackConfig,
  hangupTwiml,
  humanTwiml,
  machineTwiml,
  openingScript,
  voicemailScript,
} from '@/lib/receptionist/mike-callback';
import { findAttemptByKey, findAttemptBySid, updateAttemptOutcome } from '@/lib/receptionist/mike-callback-run';

export const dynamic = 'force-dynamic';

const xml = (body: string) => new NextResponse(body, { status: 200, headers: { 'Content-Type': 'text/xml' } });

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });
  const db = optionalServiceClient() as any;
  if (!db) return xml(hangupTwiml());
  const attemptKey = new URL(req.url).searchParams.get('attempt') || '';
  const attempt = (await findAttemptBySid(db, params.CallSid || '')) || (await findAttemptByKey(db, attemptKey));
  if (!attempt?.id || !attempt.fromNumber) return xml(hangupTwiml());

  const kind = amdKind(params.AnsweredBy);
  if (kind === 'fax') {
    await updateAttemptOutcome(db, attempt.id, 'failed', 'fax', ['dialing', 'reached']);
    return xml(hangupTwiml());
  }
  if (kind === 'machine') {
    await updateAttemptOutcome(db, attempt.id, 'voicemail', null, ['dialing', 'reached']);
    return xml(machineTwiml(voicemailScript(attempt.fromNumber)));
  }
  await updateAttemptOutcome(db, attempt.id, 'reached', null, ['dialing']);
  const action = `${new URL(publicUrl(req)).origin}/api/calls/mike-callback/bridge?attempt=${encodeURIComponent(attempt.missedCallKey)}`;
  return xml(humanTwiml({
    opening: openingScript(),
    from: attempt.fromNumber,
    mikeNumber: callbackConfig().mikeNumber,
    actionUrl: action,
  }));
}
