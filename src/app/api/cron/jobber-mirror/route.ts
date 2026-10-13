/** Vercel cron (every 10 min): incremental Jobber -> Supabase mirror for the /ops dashboards. See src/lib/jobber-mirror/sync.ts. */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import { runMirrorSync } from '@/lib/jobber-mirror/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (!cronAuth.ok) { cronUnauthorizedLog(cronAuth.reason); return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const t0 = Date.now();
  try {
    const report = await runMirrorSync(createServiceClient() as any, { budgetMs: 240_000, forceWide: request.nextUrl.searchParams.get('wide') === '1' });
    return NextResponse.json({ success: true, ms: Date.now() - t0, report });
  } catch (e) {
    console.error('[jobber-mirror]', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 300) : 'error' }, { status: 500 });
  }
}
export const GET = handle;
export const POST = handle;
