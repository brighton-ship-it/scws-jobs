/** Twilio recordingStatusCallback (completed). Transcribes + summarizes, stores in phone_call_log. */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { handleRecording } from '@/lib/phone-calls/handle-recording';
import { optionalServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });
  if (params.RecordingStatus && params.RecordingStatus !== 'completed') return NextResponse.json({ ok: true });
  const db = optionalServiceClient();
  if (!db) return NextResponse.json({ error: 'db not configured' }, { status: 503 });
  const r = await handleRecording(params, db);
  if (!r.ok) console.error('[phone-calls] recording', r.reason);
  return NextResponse.json({ ok: r.ok });
}
