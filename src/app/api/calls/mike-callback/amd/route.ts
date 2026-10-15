/**
 * Async answering-machine result. The call is already connected to Mike.
 * A machine or fax is pulled off that leg and given one voicemail. A person
 * is left on the call so the greeting is not delayed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { optionalServiceClient } from '@/lib/supabase/service';
import {
  amdKind,
  hangupTwiml,
  machineTwiml,
  voicemailScript,
} from '@/lib/receptionist/mike-callback';
import { replaceLiveCallTwiml } from '@/lib/receptionist/mike-callback-dial';
import { findAttemptByKey, findAttemptBySid, updateAttemptOutcome } from '@/lib/receptionist/mike-callback-run';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });
  const kind = amdKind(params.AnsweredBy);
  if (kind === 'human') return new NextResponse('ok', { status: 200 });

  const db = optionalServiceClient() as any;
  const attemptKey = new URL(req.url).searchParams.get('attempt') || '';
  const attempt = db
    ? (await findAttemptBySid(db, params.CallSid || '')) || (await findAttemptByKey(db, attemptKey))
    : null;
  const callSid = params.CallSid || '';
  if (kind === 'fax') {
    if (attempt?.id && db) await updateAttemptOutcome(db, attempt.id, 'failed', 'fax', ['dialing', 'reached']);
    await replaceLiveCallTwiml(callSid, hangupTwiml());
    return new NextResponse('ok', { status: 200 });
  }
  if (attempt?.id && db) await updateAttemptOutcome(db, attempt.id, 'voicemail', null, ['dialing', 'reached']);
  const from = attempt?.fromNumber || '';
  await replaceLiveCallTwiml(callSid, from ? machineTwiml(voicemailScript(from)) : hangupTwiml());
  return new NextResponse('ok', { status: 200 });
}
