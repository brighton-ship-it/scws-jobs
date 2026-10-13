import { unstable_cache } from 'next/cache';
/**
 * GET /api/ops/call-dashboard?range=7|30|90|since
 * Internal, read-only. Auth: CRM session or office key (see src/lib/ops-auth.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeOps } from '@/lib/ops-auth';
import { buildDashboard, buildCallLogView, mergeLiveCalls, type DashCall, parseRange, ptStartOfDay, rangeStart, ptDateKey, adCategory, ptWeekStart, DASH_FLOOR_ISO } from '@/lib/ads/call-dashboard';
import { buildWeeklySales, salesWindowStart } from '@/lib/ads/weekly-sales';
import { loadWeeklyInvoices, loadWeeklyQuotes, loadWeeklyJobsCreated, loadWeeklyJobsCompleted, loadWeeklyPayments } from '@/lib/ads/weekly-sales-data';
import { loadDailySpend, loadJobMoney, loadFirstJobByPhone, loadJobsCreatedSince } from '@/lib/ads/call-dashboard-data';
import { classifyRealLeads, LEAD_REASON_LABEL, isOwnNumber, type LeadCall } from '@/lib/ads/real-leads';
import { digits10 } from '@/lib/ads/call-dashboard';
import { buildRoasView, buildSharedAdSplit } from '@/lib/ads/roas-view';
import { mirrorState } from '@/lib/jobber-mirror/read';
import { buildCallFeed, mergeCallFeed, feedToday } from '@/lib/ads/call-feed';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

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
        .select('vapi_call_id, phone, duration_sec, called_at, status, summary')
        .gte('called_at', since).neq('status', 'spam')
        .order('called_at', { ascending: false }).limit(2000),
    ]);
    const notes: string[] = [];
    if (calls.error) notes.push(`calls: ${calls.error.message}`);
    if (convs.error) notes.push(`conversions: ${convs.error.message}`);
    const conversions = convs.data ?? [];
    const jobMoney = await loadJobMoney(conversions.map((c: { jobber_job_id: string }) => c.jobber_job_id)).catch(() => null);
    if (live.error) notes.push(`live calls: ${live.error.message}`);
    // SCWS's own numbers (GV/Twilio lines, staff, Twilio test line 760-823-7963) never count as calls, leads or bookings.
    const adsCalls: DashCall[] = (calls.data ?? []).filter((c: DashCall) => !isOwnNumber(c.caller_phone));
    // 'processing' is only the webhook's claim placeholder; ~220 Sep 18–Oct 7 calls finished (duration + summary)
    // but never left that status. Count every real call: drop only fresh in-flight claims and rows with no phone.
    const liveRows = (live.data ?? []).filter((r: any) => !isOwnNumber(r.phone) && /\d{10}/.test(String(r.phone || '').replace(/\D/g, ''))
      && !(r.status === 'processing' && r.duration_sec == null && !r.summary && Date.now() - Date.parse(r.called_at) < 15 * 60_000));
    const liveCalls = mergeLiveCalls(adsCalls, liveRows);
    let bookingIds = new Set<string>();
    const ids = liveRows.map((r: { vapi_call_id: string }) => r.vapi_call_id).slice(0, 600);
    for (let i = 0; i < ids.length; i += 150) {
      const br = await db.from('booking_requests').select('vapi_call_id').in('vapi_call_id', ids.slice(i, i + 150));
      if (!br.error) for (const r of br.data ?? []) bookingIds.add(r.vapi_call_id);
    }
    for (const c of liveCalls) c.live_booking_request = bookingIds.has((c as any)._vapi);
    const dash = buildDashboard({ calls: [...adsCalls, ...liveCalls], conversions, spend, paidByJob: null, jobMoney, range });
    // Real leads (Call to booking denominator): every ad + Mike call since the tracking floor, one lead per caller.
    const floorMs = Date.parse(DASH_FLOOR_ISO);
    const allSince = [...adsCalls, ...liveCalls].filter((c) => c.started_at && Date.parse(c.started_at) >= floorMs);
    const summaryByVapi = new Map<string, string>();
    const mikeByPhone = new Map<string, Array<{ t: number; s: string }>>();
    for (const r of liveRows) {
      const s = String(r.summary || ''); summaryByVapi.set(r.vapi_call_id, s);
      const d = digits10(r.phone); if (d) (mikeByPhone.get(d) ?? mikeByPhone.set(d, []).get(d)!).push({ t: Date.parse(r.called_at), s });
    }
    const leadPhones = Array.from(new Set(allSince.map((c) => digits10(c.caller_phone)).filter((x): x is string => !!x)));
    // Booked today / this week (TV + header): the offline-conversion table refreshes only nightly (2:15 AM PT cron),
    // so today's bookings were always 0. Add Jobber jobs created this week, credited with the same rules:
    // a call (ad or Mike) from the client's phone before the job, and no Jobber job before their first call.
    if (dash.tv) {
      const nowB = new Date(); const wkB = ptWeekStart(nowB); const todayB = ptStartOfDay(nowB).getTime();
      const live = await loadJobsCreatedSince(wkB.toISOString());
      if (!live) notes.push('Booked today/this week: live Jobber job pull failed, showing nightly-uploaded bookings only.');
      if (live) {
        const callsByPhone = new Map<string, number[]>();
        for (const c of [...adsCalls, ...liveCalls]) { const d = digits10(c.caller_phone); const t = Date.parse(c.started_at || ''); if (d && Number.isFinite(t)) (callsByPhone.get(d) ?? callsByPhone.set(d, []).get(d)!).push(t); }
        const credited = new Set<string>(); const seenPhone = new Set<string>();
        for (const j of [...live].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
          const at = Date.parse(j.createdAt);
          const ts = j.phones.flatMap((p) => callsByPhone.get(p) ?? []);
          if (!ts.some((t) => t <= at)) continue;
          const first = Math.min(...ts);
          if (j.clientJobTimes.some((t) => t < first)) continue; // existing customer
          const key = j.phones.slice().sort().join(',');
          if (seenPhone.has(key)) continue; // one booking per caller (matches funnel crediting)
          seenPhone.add(key); credited.add(j.id);
        }
        const ids = new Set<string>(); const todayIds = new Set<string>(); const nums: Array<{ n: number | null; today: boolean }> = [];
        for (const j of live) if (credited.has(j.id)) { ids.add(j.id); const td = Date.parse(j.createdAt) >= todayB; if (td) todayIds.add(j.id); nums.push({ n: j.jobNumber, today: td }); }
        const convWeek = conversions.filter((c: any) => !ids.has(c.jobber_job_id) && Date.parse(c.conversion_at || '') >= wkB.getTime() && (dash.bookedCredited ?? []).some((b) => b.at === c.conversion_at));
        dash.tv.bookedWeek = ids.size + convWeek.length;
        dash.tv.bookedToday = todayIds.size + convWeek.filter((c: any) => Date.parse(c.conversion_at) >= todayB).length;
        (dash.tv as any).bookedJobNumbers = nums;
      }
    }
    const log = await db.from('phone_call_log')
      .select('started_at, caller_phone, called_number, outcome, answered_by, duration_seconds, client_name, customer_id, jobber_client_id, campaign_name, receptionist_call_id, synced_at')
      .gte('started_at', since).order('started_at', { ascending: false }).limit(1000);
    if (log.error) notes.push(`call log: ${log.error.message}`);
    else { log.data = (log.data ?? []).filter((r: any) => !isOwnNumber(r.caller_phone)); dash.callLog = buildCallLogView(log.data, new Date()); }
    try {
      const recs = await db.from('inbound_call_recordings').select('started_at, caller_number, tracking_number, source, dial_status, answered, duration_seconds, summary, outcome, caller_name')
        .gte('started_at', new Date(Date.now() - 14 * 86400_000).toISOString()).neq('source', 'test').not('caller_number', 'in', '(+17608237963,+18773863995)').order('started_at', { ascending: false }).limit(100);
      const mk = await db.from('receptionist_calls').select('vapi_call_id, phone, customer_name, summary, duration_sec, called_at')
        .gte('called_at', new Date(Date.now() - 14 * 86400_000).toISOString()).order('called_at', { ascending: false }).limit(200);
      const merged = mergeCallFeed({ log: log.data ?? [], recordings: (recs.data ?? []).filter((r: any) => !isOwnNumber(r.caller_number)), mike: (mk.data ?? []).filter((r: any) => !isOwnNumber(r.phone)), bookedMike: bookingIds });
      dash.callFeed = merged.slice(0, 40);
      // Main page header and TV "today" tiles share this one count across every line.
      if (dash.callLog) dash.callLog.today = feedToday(merged, ptStartOfDay(new Date()).getTime());
    } catch (e) { notes.push(`call feed: ${e instanceof Error ? e.message : 'error'}`); }
    try {
      const nowD = new Date();
      const rStart = rangeStart(range, nowD);
      const winStart = salesWindowStart(nowD, rStart);
      const from = winStart.toISOString();
      const to = new Date(Date.now() + 86400_000).toISOString();
      const slack = new Date(winStart.getTime() - 60 * 86400_000).toISOString();
      let [invoices, quotes, jobsCreated, jobsCompleted, payments] = await Promise.all([
        loadWeeklyInvoices(from, to), loadWeeklyQuotes(slack, to), loadWeeklyJobsCreated(from, to), loadWeeklyJobsCompleted(from, to), loadWeeklyPayments(from, to),
      ]);
      if (!invoices) invoices = await sharedInvoices(from, to); // Vercel data cache shared across instances (last good pull)
      else void rememberInvoices(from, invoices);
      // After the Jobber revenue pulls (never in parallel, so it cannot throttle them). Cached per phone; small budget per load.
      const firstJobAt = await loadFirstJobByPhone(leadPhones, invoices && quotes && jobsCreated ? 8_000 : 0).catch(() => new Map<string, number | null>());
      const booked = new Map<string, any>();
      for (const b of dash.bookedCredited ?? []) if (b.phone && !booked.has(b.phone)) booked.set(b.phone, b.cat);
      const leadCalls: LeadCall[] = allSince.map((c) => {
        const d = digits10(c.caller_phone); const t = Date.parse(c.started_at as string);
        const text = c.live ? summaryByVapi.get((c as any)._vapi) ?? '' : (mikeByPhone.get(d ?? '') ?? []).filter((m) => Math.abs(m.t - t) < 15 * 60_000).map((m) => m.s).join(' ');
        return { at: c.started_at as string, phone: c.caller_phone, durationSec: c.duration_seconds, cat: c.live ? null : adCategory(c.campaign_name), live: !!c.live, text, missed: (c.call_status || '').toUpperCase() === 'MISSED' };
      });
      const contacts = (log.data ?? []).map((r: any) => ({ at: r.started_at, phone: r.caller_phone, connected: String(r.outcome || '').startsWith('answered') || (String(r.outcome || '') === 'forwarded_ai' && (r.duration_seconds ?? 0) >= 15) }));
      const rl = classifyRealLeads({ calls: leadCalls, contacts, firstJobAt, booked });
      const rStartMs = Math.max(rangeStart(range, nowD).getTime(), floorMs);
      const inWin = (iso: string, from: number) => Date.parse(iso) >= from;
      const excluded: Record<string, number> = {};
      for (const r of rl.reasons) if (r.reason !== 'lead' && inWin(r.at, rStartMs)) excluded[r.reason] = (excluded[r.reason] ?? 0) + 1;
      const leadsWin = rl.leads.filter((l) => inWin(l.at, rStartMs));
      dash.realLeads = {
        calls: rl.reasons.filter((r) => inWin(r.at, rStartMs)).length,
        leads: leadsWin.length,
        pump: leadsWin.filter((l) => l.cat === 'pump').length,
        drilling: leadsWin.filter((l) => l.cat === 'drilling').length,
        excluded: Object.entries(LEAD_REASON_LABEL).map(([k, label]) => ({ reason: k, label, count: excluded[k] ?? 0 })),
        unresolvedExisting: rl.unresolvedExisting,
      };
      if (rl.unresolvedExisting) dash.gaps.push(`Real leads: ${rl.unresolvedExisting} callers not yet checked against Jobber for earlier jobs (lookup fills in over the next few refreshes); they count as leads until checked.`);
      const allCalls = rl.leads.map((l) => ({ started_at: l.at, live: !l.cat, campaign_name: l.cat }));
      dash.weekly = buildWeeklySales({
        now: nowD, invoices, quotes, jobsCreated, jobsCompleted, payments,
        range: { range, startKey: ptDateKey(rStart), endKey: ptDateKey(nowD), name: range },
        callTimes: allCalls.map((c) => c.started_at),
        // Same bookings as the funnel: conversions credited to a call (not every uploaded conversion).
        bookedAt: (dash.bookedCredited ?? []).map((b) => b.at),
        // Real leads only (one per caller, junk/existing/repeat excluded); a lead's type follows its booking or first ad call.
        adCalls: rl.leads.map((l) => ({ at: l.at, cat: l.cat })),
        adBooked: dash.bookedCredited ?? [],
      });
      dash.roas = buildRoasView({ invoices, adCalls: adsCalls, spend, start: new Date(dash.revenueStart), now: nowD });
      // Campaign cards use the same calculation, window and spend as the ROAS card / funnel.
      const RN: Record<string, string> = { '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days', since: 'Since Sep 18', month: 'This month' };
      const wk = ptWeekStart(nowD);
      const shared = buildSharedAdSplit({
        invoices, adCalls: adsCalls, booked: dash.bookedCredited ?? [], spend, now: nowD,
        windows: { main: { label: RN[range] ?? 'Selected range', start: new Date(dash.revenueStart) }, week: { label: 'This week so far (Mon–today)', start: wk < new Date(DASH_FLOOR_ISO) ? new Date(DASH_FLOOR_ISO) : wk } },
      });
      if (dash.roas && dash.weekly?.totals) {
        const inv = dash.weekly.totals.invoiced, sp = dash.roas.spend;
        dash.roas.mer = { invoiced: inv, spend: sp, multiple: inv != null && sp && sp > 0 ? Math.round((inv / sp) * 100) / 100 : null };
        dash.weekly.sources.push(
          'Blended (all callers) = pre-tax Jobber invoices issued in the range to any client whose phone called a Google Ads number before the invoice (new + repeat), ÷ Google Ads spend, same Pacific days.',
          'ROAS (new customers) = the same, limited to clients with no Jobber job created before their first Google Ads call.',
        );
      }
      if (shared) {
        dash.adSplit = shared;
        const wStart = { since: Math.max(new Date(dash.revenueStart).getTime(), floorMs), week: Math.max(wk.getTime(), floorMs) } as const;
        for (const k of ['since', 'week'] as const) for (const r of (shared as any)[k]?.rows ?? []) r.leads = rl.leads.filter((l) => l.cat === r.category && inWin(l.at, wStart[k])).length;
      }
      else if (dash.adSplit) blankSplitMoney(dash);
    } catch (e) {
      notes.push(`weekly sales: ${e instanceof Error ? e.message : 'error'}`);
    }
    if (!dash.roas && dash.adSplit) blankSplitMoney(dash);
    strictMoneyOnly(dash);
    dropStaleFields(dash);
    dash.gaps.push(...notes);
    const ms = await mirrorState();
    return finish(NextResponse.json({ ...dash, generatedAt: new Date().toISOString(), jobberDataAsOf: ms.ready ? ms.asOf : null }));
  } catch (error) {
    console.error('[call-dashboard]', error instanceof Error ? error.message : 'error');
    return finish(NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 }));
  }
}

// Last good Jobber invoice pull, persisted in the Vercel data cache (shared by all instances) so a throttled
// or cold Jobber call never blanks the revenue cards. Key is per window start; refreshed whenever a live pull succeeds.
const invKey = (from: string) => ['dash-invoices-v1', from.slice(0, 10)];
async function sharedInvoices(from: string, to: string) {
  try {
    const get = unstable_cache(async () => {
      for (let i = 0; i < 3; i++) {
        const r = await loadWeeklyInvoices(from, to);
        if (r) return r;
        await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
      }
      throw new Error('jobber invoices unavailable'); // never cache a failure
    }, invKey(from), { revalidate: 3600, tags: ['dash-invoices'] });
    return await get();
  } catch { return null; }
}
async function rememberInvoices(from: string, rows: unknown[]) {
  try { await unstable_cache(async () => rows, invKey(from), { revalidate: 3600, tags: ['dash-invoices'] })(); } catch { /* best effort */ }
}

/** Never show the old per-booking matching: if the shared Jobber calculation is unavailable, hide money on the campaign cards. */
function blankSplitMoney(dash: { adSplit?: { since: { rows: any[] }; week: { rows: any[] } } }) {
  for (const w of [dash.adSplit!.since, dash.adSplit!.week]) for (const r of w.rows) { r.invoiced = null; r.multiple = null; }
}

/** Every dollar / multiple on the page comes from the one strict new-customer Jobber calculation (dash.roas).
 *  Old per-booking (offline-conversion) money is removed; null => UI shows '—'. */
function strictMoneyOnly(dash: any) {
  const ro = dash.roas;
  const t = dash.totals;
  if (t) {
    t.invoicedValue = ro ? ro.newOnly.invoiced : null;
    t.multipleInvoiced = ro ? ro.newOnly.multipleInvoiced : null;
    t.paidValue = null; t.multiplePaid = null;
    t.bookedValue = null; t.quoteValue = null;
    if (t.perCall) t.perCall = { booked: null, quote: null, invoiced: ro && t.calls ? Math.round((ro.newOnly.invoiced / t.calls) * 100) / 100 : null };
  }
  const byCat = new Map<string, number | null>();
  for (const r of dash.adSplit?.since?.rows ?? []) byCat.set(r.category, r.invoicedNew ?? null);
  const camp = (key: string) => { const k = String(key || '').toLowerCase(); return k.includes('drill') ? 'drilling' : k.includes('search') ? 'pump' : null; };
  for (const r of dash.byCampaign ?? []) { const c = camp(r.key); r.invoiced = ro && c ? byCat.get(c) ?? null : null; }
  for (const r of [...(dash.byKeyword ?? []), ...(dash.byTrackingNumber ?? [])]) r.invoiced = null;
  for (const d of dash.series ?? []) d.invoiced = null;
  for (const r of dash.recent ?? []) r.value = null;
  if (dash.tv) for (const k of Object.keys(dash.tv)) if (/revenue|multiple|invoiced|paid/i.test(k)) dash.tv[k] = null;
}

/** Remove leftover payload fields from the old basis so nothing can display them again. */
function dropStaleFields(dash: any) {
  const t = dash.totals;
  if (t) for (const k of ['invoicedValue', 'paidValue', 'multipleInvoiced', 'multiplePaid', 'bookedValue', 'quoteValue', 'perCall']) delete t[k];
  if (dash.tv) for (const k of ['callsToday', 'answeredToday', 'missedToday', 'revenueWeek', 'revenueMonth', 'multipleMonth']) delete dash.tv[k];
  if (dash.roas) delete dash.roas.mer;
}
