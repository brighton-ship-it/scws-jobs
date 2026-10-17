/** Vercel cron (daily): keep the QuickBooks refresh token alive (Intuit expires it after 100 idle days). Production is the only writer. */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import { keepAliveRefresh } from '@/lib/quickbooks/durable-read';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (!cronAuth.ok) { cronUnauthorizedLog(cronAuth.reason); return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  try {
    return NextResponse.json({ success: true, ...(await keepAliveRefresh()) });
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 400) : 'error';
    console.error('[qbo-refresh]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
export const GET = handle;
export const POST = handle;
