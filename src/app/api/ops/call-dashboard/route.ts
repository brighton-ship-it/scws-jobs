/**
 * GET /api/ops/call-dashboard?range=7|30|90|since
 * Internal, read-only. Auth: CRM session or office key (see src/lib/ops-auth.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeOps } from '@/lib/ops-auth';
import { buildDashboard, mergeLiveCalls, type DashCall, parseRange, DASH_FLOOR_ISO } from '@/lib/ads/call-dashboard';
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
    const [calls, convs, spend, live] = await Promise.all([
      db.from('ads_calls')
        .select('started_at, duration_seconds, campaign_name, ad_group_name, keyword, caller_area_code, caller_phone, call_status, call_source, customer_id, jobber_client_id')
        .gte('started_at', since).order('started_at', { ascending: false }).limit(5000),
      db.from('ads_offline_conversions')
        .select('jobber_job_id, conversion_at, value_usd, payload')
        .gte('conversion_at', DASH_FLOOR_ISO).limit(2000),
      loadDailySpend(),
      db.from('receptionist_calls')
        .select('vapi_call_id, phone, duration_sec, called_at, status')
        .gte('called_at', since).neq('status', 'processing').neq('status', 'spam')
        .order('called_at', { ascending: false }).limit(2000),
    ]);
    const notes: string[] = [];
    if (calls.error) notes.push(`calls: ${calls.error.message}`);
    if (convs.error) notes.push(`conversions: ${convs.error.message}`);
    const conversions = convs.data ?? [];
    const paidByJob = await loadPaidByJob(conversions.map((c: { jobber_job_id: string }) => c.jobber_job_id)).catch(() => null);
    if (live.error) notes.push(`live calls: ${live.error.message}`);
    const adsCalls: DashCall[] = calls.data ?? [];
    const liveCalls = mergeLiveCalls(adsCalls, live.data ?? []);
    let bookingIds = new Set<string>();
    const ids = (live.data ?? []).map((r: { vapi_call_id: string }) => r.vapi_call_id).slice(0, 300);
    if (ids.length) {
      const br = await db.from('booking_requests').select('vapi_call_id').in('vapi_call_id', ids);
      if (!br.error) bookingIds = new Set((br.data ?? []).map((r: { vapi_call_id: string }) => r.vapi_call_id));
    }
    for (const c of liveCalls) c.live_booking_request = bookingIds.has((c as any)._vapi);
    const dash = buildDashboard({ calls: [...adsCalls, ...liveCalls], conversions, spend, paidByJob, range });
    dash.gaps.push(...notes);
    return finish(NextResponse.json({ ...dash, generatedAt: new Date().toISOString() }));
  } catch (error) {
    console.error('[call-dashboard]', error instanceof Error ? error.message : 'error');
    return finish(NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 }));
  }
}
