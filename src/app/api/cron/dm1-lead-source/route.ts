/** Cron: write "Lead source: Direct mail - DM1" client notes in Jobber for DM1-attributed bookings (going forward only). ?dry=1 reads only. */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import { runDm1LeadSource } from '@/lib/direct-mail/lead-source-note';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) { cronUnauthorizedLog(auth.reason); return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    const out = await runDm1LeadSource(createServiceClient() as any, process.env, request.nextUrl.searchParams.get('dry') === '1');
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500 });
  }
}
export const POST = GET;
