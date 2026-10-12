/**
 * GET /api/ops/metrics — business metrics for /ops/metrics. Internal, read-only.
 * Auth: CRM session or office key (see src/lib/ops-auth.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeOps } from '@/lib/ops-auth';
import { DASH_FLOOR_ISO } from '@/lib/ads/call-dashboard';
import { loadDailySpend } from '@/lib/ads/call-dashboard-data';
import { loadWeeklyInvoices, loadWeeklyQuotes } from '@/lib/ads/weekly-sales-data';
import { buildRoasView } from '@/lib/ads/roas-view';
import { loadHistoryInvoices, loadCompletedJobCosts, loadTimesheets } from '@/lib/ads/metrics-data';
import { buildMetrics } from '@/lib/ads/metrics';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const DAY = 86400_000;

export async function GET(request: NextRequest) {
  const auth = await authorizeOps(request);
  if (!auth.ok) return auth.response;
  const finish = (res: NextResponse) => {
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    if (auth.setCookie) res.headers.append('Set-Cookie', auth.setCookie);
    return res;
  };
  try {
    const db = createServiceClient() as any;
    const now = new Date();
    const tomorrow = new Date(now.getTime() + DAY).toISOString();
    const histFrom = new Date(now.getTime() - 731 * DAY);
    const quotesFrom = new Date(now.getTime() - 180 * DAY);
    const costFrom = new Date(now.getTime() - 90 * DAY);
    const timeFrom = new Date(now.getTime() - 30 * DAY);
    let sinceInv = await loadWeeklyInvoices(DASH_FLOOR_ISO, tomorrow);
    for (let i = 0; !sinceInv && i < 3; i++) { await new Promise((r) => setTimeout(r, 6000)); sinceInv = await loadWeeklyInvoices(DASH_FLOOR_ISO, tomorrow); } // Jobber cost throttle
    const [calls, spend, quotes, costs, time, qbo] = await Promise.all([
      db.from('ads_calls').select('started_at, caller_phone, campaign_name').gte('started_at', DASH_FLOOR_ISO).order('started_at', { ascending: false }).limit(5000),
      loadDailySpend(now),
      loadWeeklyQuotes(quotesFrom.toISOString(), tomorrow),
      loadCompletedJobCosts(costFrom.toISOString(), tomorrow),
      loadTimesheets(timeFrom.toISOString(), tomorrow),
      db.from('quickbooks_connections').select('id').limit(1),
    ]);
    const history = await loadHistoryInvoices(histFrom.toISOString(), tomorrow);
    const roasSince = calls.error ? null : buildRoasView({ invoices: sinceInv, adCalls: calls.data ?? [], spend, start: new Date(DASH_FLOOR_ISO), now });
    const cards = buildMetrics({
      now, histFrom, history, roasSince, sinceLabel: 'Since Sep 18, 2026', quotes, quotesFrom, costs, costFrom, time, timeFrom,
      qboConnected: !qbo.error && (qbo.data ?? []).length > 0,
    });
    const diag = {
      historyInvoices: history.rows?.length ?? null, historyError: history.error ?? null, historyTruncated: !!history.truncated,
      sinceInvoices: sinceInv?.length ?? null, adCalls: calls.data?.length ?? null, spendRows: spend?.length ?? null,
      quotes: quotes?.length ?? null, costJobs: costs.rows?.length ?? null, costError: costs.error ?? null,
      timeEntries: time.rows?.length ?? null, timeError: time.error ?? null,
      oldestInvoice: history.rows?.reduce<string | null>((m, r) => (r.issuedDate && (!m || r.issuedDate < m) ? r.issuedDate : m), null) ?? null,
    };
    if (request.nextUrl.searchParams.get('debug') === '1') {
      (diag as any).costSample = (costs.rows ?? []).filter((j) => (j.jobCosting?.totalCost ?? 0) > 0).sort((a, b) => (a.jobCosting?.profitAmount ?? 0) - (b.jobCosting?.profitAmount ?? 0)).slice(0, 40);
      (diag as any).quoteSample = (quotes ?? []).filter((q) => /approved|converted/i.test(q.quoteStatus || '')).slice(0, 25);
    }
    return finish(NextResponse.json({ cards, diag, generatedAt: now.toISOString() }));
  } catch (error) {
    console.error('[ops-metrics]', error instanceof Error ? error.message : 'error');
    return finish(NextResponse.json({ error: 'Failed to load metrics' }, { status: 500 }));
  }
}
