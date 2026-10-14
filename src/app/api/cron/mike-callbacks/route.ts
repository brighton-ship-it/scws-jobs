/**
 * Missed-call callbacks for Mike. Off unless MIKE_CALLBACKS_ENABLED=true,
 * or MIKE_CALLBACK_TEST_NUMBERS lists the only numbers that may be dialed.
 * Never dials when the flag is off. Does not email or text the customer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import { callbackConfig } from '@/lib/receptionist/mike-callback';
import { runMikeCallbackPass } from '@/lib/receptionist/mike-callback-run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (!cronAuth.ok) {
    cronUnauthorizedLog(cronAuth.reason);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (callbackConfig().mode === 'off') {
    return NextResponse.json({ ok: true, mode: 'off', dialed: 0 });
  }
  try {
    const db = createServiceClient() as any;
    const summary = await runMikeCallbackPass(db, process.env, new Date());
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    console.error('[mike-callback] Cron failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
