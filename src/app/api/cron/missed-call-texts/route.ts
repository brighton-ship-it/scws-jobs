/**
 * Missed-call / hang-up text follow-up. OFF unless MISSED_CALL_TEXT_ENABLED=true (or
 * MISSED_CALL_TEXT_TEST_NUMBERS lists the only numbers that may be texted). With the flag
 * off this returns immediately and reads nothing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import { textConfig } from '@/lib/receptionist/missed-call-text';
import { runMissedCallTextPass } from '@/lib/receptionist/missed-call-text-run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (!cronAuth.ok) {
    cronUnauthorizedLog(cronAuth.reason);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const config = textConfig();
  if (config.mode === 'off') return NextResponse.json({ ok: true, mode: 'off', sent: 0 });
  try {
    const summary = await runMissedCallTextPass(createServiceClient() as any, process.env, new Date());
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    console.error('[missed-call-text] cron failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
