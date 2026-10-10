/**
 * GET /api/ops/call-dashboard?range=7|30|90|since
 * Internal, read-only. Auth: CRM session or office key (see src/lib/ops-auth.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeOps } from '@/lib/ops-auth';
import { buildDashboard, parseRange, DASH_FLOOR_ISO } from '@/lib/ads/call-dashboard';
import { loadDailySpend, loadPaidByJob } from '@/lib/ads/call-dashboard-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await authorizeOps(request);
  if (!auth.ok) return auth.response;

  const range = parseRange(request.nextUrl.searchParams.get('range'));
  const finish = (res: NextResponse) => {
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    if (auth.setCookie) res.headers.append('Set-Cookie', auth.setCookie);
    return res;
  };

  try {
    const db = createServiceClient() as any;
    const since = new Date(Date.now() - 95 * 86400_000).toISOString();
    const [calls, convs, spend] = await Promise.all([
      db.from('ads_calls')
        .select('started_at, duration_seconds, campaign_name, ad_group_name, keyword, caller_area_code, caller_phone, call_status, call_source, customer_id, jobber_client_id')
        .gte('started_at', since).order('started_at', { ascending: false }).limit(5000),
      db.from('ads_offline_conversions')
        .select('jobber_job_id, conversion_at, value_usd, payload')
        .gte('conversion_at', DASH_FLOOR_ISO).limit(2000),
      loadDailySpend(),
    ]);
    const notes: string[] = [];
    if (calls.error) notes.push(`calls: ${calls.error.message}`);
    if (convs.error) notes.push(`conversions: ${convs.error.message}`);
    const conversions = convs.data ?? [];
    const paidByJob = await loadPaidByJob(conversions.map((c: { jobber_job_id: string }) => c.jobber_job_id)).catch(() => null);
    const dash = buildDashboard({ calls: calls.data ?? [], conversions, spend, paidByJob, range });
    dash.gaps.push(...notes);
    return finish(NextResponse.json({ ...dash, generatedAt: new Date().toISOString() }));
  } catch (error) {
    console.error('[call-dashboard]', error instanceof Error ? error.message : 'error');
    return finish(NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 }));
  }
}
