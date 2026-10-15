/** Twilio Dial action after Mike's assistant leg ends. Does not place a new call. */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { optionalServiceClient } from '@/lib/supabase/service';
import { hangupTwiml } from '@/lib/receptionist/mike-callback';
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
  if (!attempt?.id) return xml(hangupTwiml());
  const status = (params.DialCallStatus || '').toLowerCase();
  if (['no-answer', 'busy', 'failed', 'canceled'].includes(status)) {
    await updateAttemptOutcome(db, attempt.id, 'failed', 'bridge_failed', ['dialing', 'reached']);
  }
  return xml(hangupTwiml());
}
