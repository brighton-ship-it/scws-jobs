import { unstable_cache } from 'next/cache';
/**
 * GET /api/ops/call-dashboard?range=7|30|90|since
 * Internal, read-only. Auth: CRM session or office key (see src/lib/ops-auth.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeOps } from '@/lib/ops-auth';
import { buildDashboard, buildCallLogView, mergeLiveCalls, attributeAiHandledCalls, type DashCall, type DialedSourceHint, parseRange, ptStartOfDay, rangeStart, ptDateKey, adCategory, ptWeekStart, DASH_FLOOR_ISO } from '@/lib/ads/call-dashboard';
import { buildWeeklySales, salesWindowStart } from '@/lib/ads/weekly-sales';
import { loadWeeklyInvoices, loadWindowQuotes, loadWeeklyJobsCreated, loadWeeklyJobsCompleted, loadWeeklyPayments } from '@/lib/ads/weekly-sales-data';
import { loadDailySpend, loadJobMoney, loadFirstJobByPhone, loadJobsCreatedSince } from '@/lib/ads/call-dashboard-data';
import { classifyRealLeads, LEAD_REASON_LABEL, isOwnNumber, type LeadCall } from '@/lib/ads/real-leads';
import { digits10 } from '@/lib/ads/call-dashboard';
import { buildRoasView, buildSharedAdSplit, type RoasDetailRow } from '@/lib/ads/roas-view';
import { mirrorState } from '@/lib/jobber-mirror/read';
import { buildCallFeed, mergeCallFeed, feedToday, markMikeHandoffs } from '@/lib/ads/call-feed';
import { LEAD_DISMISSALS_KEY, parseDismissals, type LeadDismissal } from '@/lib/ads/lead-dismissals';
import { annotateFeed, balanceColumnMissing, callbackCandidates, callbackSources, groupPastDueClients, indexWorkTimes, listOpenInvoices, needsCallback, requestResolvesCallback, voiceAttempts, type CollectionEvent, type OpenInvoice, type PastDueClient } from '@/lib/ads/callbacks';
import { loadJobberFollowUp } from '@/lib/ads/jobber-followup';
import { scrubForTv } from '@/lib/ads/tv-scrub';
import { loadGmailCollection, invoiceNumbersIn, vercelOidcToken, SHOP_GMAIL_MAILBOXES, gmailSearchTargets, gmailTargetKey } from '@/lib/ads/gmail-collections';
import { fetchTwilioCollectionMessages, type TwilioText } from '@/lib/ads/twilio-outbound';
import { callbackVapiIds, dropBookedByMike, mikeOutreachAttempts, mikeStatusLabel, sourcesWithoutMikeLegs } from '@/lib/receptionist/mike-callback';
import { loadRecentAttempts } from '@/lib/receptionist/mike-callback-run';
import { loadLiveOutbound } from '@/lib/ads/outbound-live';
import { buildSourceCards, type SourceKey } from '@/lib/ads/source-cards';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  const auth = await authorizeOps(request);
  if (!auth.ok) return auth.response;

  const range = parseRange(request.nextUrl.searchParams.get('range'));
  // ?debug=sets: read-only verification payload (raw call rows + derived lead/booking/ROAS sets). Same ops auth; no names or call summaries.
  const debugSets = request.nextUrl.searchParams.get('debug') === 'sets';
  let debug: Record<string, unknown> | null = null;
  const finish = (res: NextResponse) => {
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    if (auth.setCookie) res.headers.append('Set-Cookie', auth.setCookie);
    return res;
  };

  try {
    const db = createServiceClient() as any;
    const since = new Date(Date.now() - 95 * 86400_000).toISOString();
    const nowDash = new Date();
    const fromMs = Math.max(rangeStart(range, nowDash).getTime(), Date.parse(DASH_FLOOR_ISO));
    const liveOutP = unstable_cache(
      () => loadLiveOutbound(new Date(fromMs).toISOString()),
      ['live-outbound-v1', new Date(fromMs).toISOString().slice(0, 10)],
      { revalidate: 600 },
    )().catch((error: unknown) => ({ rows: [] as any[], notes: [`outbound: ${error instanceof Error ? error.message : 'error'}`] }));
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
    const mikeCallbacks = await loadRecentAttempts(db, new Date(Date.now() - 14 * 86400_000).toISOString());
    if (mikeCallbacks.note) notes.push(mikeCallbacks.note);
    const callbackVapi = callbackVapiIds(mikeCallbacks.attempts);
    // SCWS's own numbers (GV/Twilio lines, staff, Twilio test line 760-823-7963) never count as calls, leads or bookings.
    // Mike's outbound callbacks are not new inbound leads and do not credit Mike as a source.
    const adsCalls: DashCall[] = (calls.data ?? []).filter((c: DashCall) => !isOwnNumber(c.caller_phone));
    // 'processing' is only the webhook's claim placeholder; ~220 Sep 18–Oct 7 calls finished (duration + summary)
    // but never left that status. Count every real call: drop only fresh in-flight claims and rows with no phone.
    const liveRows = (live.data ?? []).filter((r: any) => !callbackVapi.has(r.vapi_call_id) && !isOwnNumber(r.phone) && /\d{10}/.test(String(r.phone || '').replace(/\D/g, ''))
      && !(r.status === 'processing' && r.duration_sec == null && !r.summary && Date.now() - Date.parse(r.called_at) < 15 * 60_000));
    const log = await loadPhoneCallLog(db, since);
    let inboundLog: any[] = [];
    let outboundLog: any[] = [];
    if (log.error) notes.push(`call log: ${log.error.message}`);
    else {
      inboundLog = (log.data ?? []).filter((r: any) => r.direction !== 'outbound' && !isOwnNumber(r.caller_phone));
      outboundLog = (log.data ?? []).filter((r: any) => r.direction === 'outbound' && !isOwnNumber(r.caller_phone));
    }
    const recordingHints = await loadRecordingHints(db, since);
    if (recordingHints.note) notes.push(recordingHints.note);
    const dialedHints: DialedSourceHint[] = [
      ...inboundLog.map((r: any) => ({
        at: r.started_at, callerPhone: r.caller_phone, dialedNumber: r.called_number,
        campaignName: r.campaign_name, keyword: r.keyword, vapiCallId: r.receptionist_call_id,
      })),
      ...recordingHints.hints,
      // ads_calls carry keyword and ad group. Nearby Mike rows were already dropped as duplicates;
      // this still fills a call the log linked by phone and time but did not copy the ad group onto.
      ...adsCalls.map((c) => ({
        at: c.started_at || '', callerPhone: c.caller_phone, campaignName: c.campaign_name,
        keyword: c.keyword, adGroupName: c.ad_group_name,
      })),
    ];
    const liveCalls = attributeAiHandledCalls(mergeLiveCalls(adsCalls, liveRows), dialedHints);
    let bookingIds = new Set<string>();
    const ids = liveRows.map((r: { vapi_call_id: string }) => r.vapi_call_id).slice(0, 600);
    for (let i = 0; i < ids.length; i += 150) {
      const br = await db.from('booking_requests').select('vapi_call_id, source').in('vapi_call_id', ids.slice(i, i + 150));
      if (!br.error) for (const r of br.data ?? []) if (r.vapi_call_id && requestResolvesCallback(r.source)) bookingIds.add(r.vapi_call_id);
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
    if (!log.error) dash.callLog = buildCallLogView(inboundLog, nowDash);
    try {
      const recs = await db.from('inbound_call_recordings').select('started_at, caller_number, tracking_number, source, dial_status, answered, duration_seconds, summary, outcome, caller_name')
        .gte('started_at', new Date(Date.now() - 14 * 86400_000).toISOString()).neq('source', 'test').not('caller_number', 'in', '(+17608237963,+18773863995)').order('started_at', { ascending: false }).limit(100);
      const mk = await db.from('receptionist_calls').select('vapi_call_id, phone, customer_name, summary, duration_sec, called_at')
        .gte('called_at', new Date(Date.now() - 14 * 86400_000).toISOString()).order('called_at', { ascending: false }).limit(200);
      const merged = mergeCallFeed({ log: inboundLog, recordings: (recs.data ?? []).filter((r: any) => !isOwnNumber(r.caller_number)), mike: (mk.data ?? []).filter((r: any) => !isOwnNumber(r.phone) && !callbackVapi.has(r.vapi_call_id)), bookedMike: bookingIds });
      // Voice log card: a missed office leg that Mike then answered shows as Mike, not Missed.
      if (!log.error && !mk.error) dash.callLog = buildCallLogView(markMikeHandoffs(inboundLog, (mk.data ?? []).filter((r: any) => !callbackVapi.has(r.vapi_call_id))), nowDash);
      const liveOut = await liveOutP;
      notes.push(...liveOut.notes);
      const outboundByKey = new Map<string, any>();
      for (const r of outboundLog) if (r.voice_call_key) outboundByKey.set(r.voice_call_key, r);
      for (const r of liveOut.rows) if (r.voice_call_key && !outboundByKey.has(r.voice_call_key)) outboundByKey.set(r.voice_call_key, r);
      const outboundAll = Array.from(outboundByKey.values());
      const sources = sourcesWithoutMikeLegs(callbackSources({ log: [...inboundLog, ...outboundAll], recordings: recs.data ?? [] }), mikeCallbacks.attempts);
      const attempts = [...voiceAttempts(outboundAll), ...mikeOutreachAttempts(mikeCallbacks.attempts)];
      const past = await loadPastDueClients(db);
      if (past.note) notes.push(past.note);
      const pastDuePhones = new Set(past.clients.flatMap((c) => c.phones));
      try {
        const sinceIso = new Date(fromMs).toISOString();
        const loaded = await loadWorkRows(db, sinceIso);
        if (loaded.note) notes.push(loaded.note);
        const texts = await loadCollectionTexts(db);
        if (texts.note) notes.push(texts.note);
        const twilioTexts = await fetchTwilioCollectionMessages().catch((error: unknown) => ({
          texts: [] as TwilioText[],
          ok: false,
          note: `Twilio message list unavailable${error instanceof Error ? `: ${error.message}` : ''}.`,
        }));
        if (!twilioTexts.ok && twilioTexts.note) notes.push(twilioTexts.note);
        const jobber = await unstable_cache(
          () => loadJobberFollowUp(sinceIso),
          ['jobber-followup-v2', sinceIso.slice(0, 10)],
          { revalidate: 600 },
        )().catch((error: unknown) => ({
          work: [] as Array<{ phone: string | null; at: string }>,
          invoices: [] as Array<{ id: string; number: string | null; dueAt: string | null; emails?: string[]; phones?: string[]; comms: CollectionEvent[] }>,
          channels: { jobberTexts: false, emails: false },
          notes: [`jobber follow-up: ${error instanceof Error ? error.message : 'error'}`],
        }));
        notes.push(...jobber.notes);
        let open = listOpenInvoices(past.invoices, past.clientRows, { hasBalanceColumn: past.hasBalanceColumn });
        open = applyInvoiceExtras(open, jobber.invoices);
        // Search each customer address from that invoice's date. The cache key is
        // the address set, not the OIDC token, and unstable_cache does not see request headers.
        const oidcToken = vercelOidcToken(process.env, request.headers.get('x-vercel-oidc-token'));
        const gmailTargets = gmailSearchTargets(open);
        const gmail = await unstable_cache(
          () => loadGmailCollection(process.env, fetch, oidcToken, Math.floor(Date.now() / 1000), gmailTargets),
          ['gmail-collections-v5', gmailTargetKey(gmailTargets)],
          { revalidate: 600 },
        )().catch((error: unknown) => ({
          events: [] as CollectionEvent[],
          ok: false,
          mailbox: null as string | null,
          unavailable: SHOP_GMAIL_MAILBOXES.map((box) => box.name),
          note: `Gmail unavailable${error instanceof Error ? `: ${error.message}` : ''}.`,
        }));
        if (gmail.ok) notes.push(`Collection email: Gmail counts mail sent from ${gmail.mailbox}.`);
        if (gmail.note) notes.push(gmail.note);
        const work = indexWorkTimes([...loaded.rows, ...jobber.work]);
        const candidates = dropBookedByMike(callbackCandidates({
          log: inboundLog,
          recordings: (recs.data ?? []).filter((r: any) => !isOwnNumber(r.caller_number)),
          mike: liveRows,
          bookedMike: bookingIds,
        }), mikeCallbacks.attempts);
        const withMike = <T extends { phone: string; at: string }>(rows: T[]) => rows.map((row) => ({ ...row, mike: mikeStatusLabel(row.phone, row.at, mikeCallbacks.attempts, nowDash) }));
        dash.callFeed = withMike(annotateFeed(merged.slice(0, 60), sources, nowDash, { attempts, fromMs, pastDuePhones, work }));
        let dismissed: LeadDismissal[] = [];
        try {
          const ds = await db.from('settings').select('value').eq('key', LEAD_DISMISSALS_KEY).maybeSingle();
          if (ds.error) notes.push(`lead dismissals: ${ds.error.message}`); else dismissed = parseDismissals(ds.data?.value);
        } catch (e) { notes.push(`lead dismissals: ${e instanceof Error ? e.message : 'error'}`); }
        const queues = needsCallback({
          candidates, sources, work, fromMs, now: nowDash, attempts, dismissed,
          openInvoices: open,
          inbound: [
            ...inboundLog.map((r: any) => ({ at: r.started_at, phone: r.caller_phone ?? null })),
            ...(recs.data ?? []).filter((r: any) => !isOwnNumber(r.caller_number)).map((r: any) => ({ at: r.started_at, phone: r.caller_number ?? null })),
            ...(mk.data ?? []).filter((r: any) => !isOwnNumber(r.phone) && !callbackVapi.has(r.vapi_call_id)).map((r: any) => ({ at: r.called_at, phone: r.phone ?? null })),
          ],
          collections: [
            ...texts.events,
            ...twilioTextEvents(twilioTexts.texts, texts.sids),
            ...jobber.invoices.flatMap((inv) => inv.comms),
            ...gmail.events,
          ],
          channels: {
            calls: !log.error,
            appTexts: texts.ok || twilioTexts.ok,
            jobberTexts: jobber.channels.jobberTexts,
            emails: jobber.channels.emails,
            gmail: gmail.ok,
            gmailMissing: gmail.unavailable,
          },
        });
        dash.needsCallback = { ...queues.leads, rows: withMike(queues.leads.rows) };
        dash.invoiceFollowUp = queues.invoices;
      } catch (error) {
        dash.callFeed = annotateFeed(merged.slice(0, 60), sources, nowDash, { attempts, fromMs, pastDuePhones }).map((row) => ({ ...row, mike: mikeStatusLabel(row.phone, row.at, mikeCallbacks.attempts, nowDash) }));
        notes.push(`needs callback: ${error instanceof Error ? error.message : 'error'}`);
      }
      // Main page header and TV "today" tiles share this one count across every line.
      if (dash.callLog) dash.callLog.today = feedToday(merged, ptStartOfDay(new Date()).getTime());
    } catch (e) { notes.push(`call feed: ${e instanceof Error ? e.message : 'error'}`); }
    try {
      dash.sourceCards = await loadSourceCards(db, Math.max(rangeStart(range, new Date()).getTime(), Date.parse(DASH_FLOOR_ISO)));
    } catch (e) { notes.push(`source cards: ${e instanceof Error ? e.message : 'error'}`); }
    try {
      const nowD = new Date();
      const rStart = rangeStart(range, nowD);
      const winStart = salesWindowStart(nowD, rStart);
      const from = winStart.toISOString();
      const to = new Date(Date.now() + 86400_000).toISOString();
      const slack = new Date(winStart.getTime() - 60 * 86400_000).toISOString();
      let [invoices, quotes, jobsCreated, jobsCompleted, payments] = await Promise.all([
        loadWeeklyInvoices(from, to), loadWindowQuotes(slack, to), loadWeeklyJobsCreated(from, to), loadWeeklyJobsCompleted(from, to), loadWeeklyPayments(from, to),
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
      const contacts = inboundLog.map((r: any) => ({ at: r.started_at, phone: r.caller_phone, connected: String(r.outcome || '').startsWith('answered') || (String(r.outcome || '') === 'forwarded_ai' && (r.duration_seconds ?? 0) >= 15) }));
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
      const roasDetail: RoasDetailRow[] = [];
      dash.roas = buildRoasView({ invoices, adCalls: adsCalls, spend, start: new Date(dash.revenueStart), now: nowD, detail: debugSets ? roasDetail : undefined });
      if (debugSets) {
        const reasonAt = new Map<string, string[]>();
        for (const r of rl.reasons) { const k = `${r.at}|${r.live ? 1 : 0}`; (reasonAt.get(k) ?? reasonAt.set(k, []).get(k)!).push(r.reason); }
        debug = {
          rangeStartMs: rStartMs, floorIso: DASH_FLOOR_ISO,
          calls: leadCalls.map((c) => ({ at: c.at, phone: digits10(c.phone), durationSec: c.durationSec, cat: c.cat, live: c.live, missed: !!c.missed, hasText: !!(c.text && c.text.trim()), reason: reasonAt.get(`${c.at}|${c.live ? 1 : 0}`)?.shift() ?? null, inRange: inWin(c.at, rStartMs) })),
          contacts: contacts.filter((x: { connected: boolean }) => x.connected).map((x: { at: string; phone: string | null }) => ({ at: x.at, phone: digits10(x.phone) })),
          firstJobAt: Object.fromEntries(Array.from(firstJobAt.entries()).map(([k, v]) => [k, v == null ? null : new Date(v).toISOString()])),
          leads: rl.leads.map((l) => ({ ...l, inRange: inWin(l.at, rStartMs) })),
          bookedCredited: (dash.bookedCredited ?? []).map((b) => ({ at: b.at, cat: b.cat, phone: b.phone ?? null })),
          conversions: conversions.map((c: any) => ({ jobId: c.jobber_job_id, at: c.conversion_at, valueUsd: c.value_usd })),
          adCalls: adsCalls.map((c) => ({ at: c.started_at, phone: digits10(c.caller_phone), campaign: c.campaign_name, status: c.call_status, durationSec: c.duration_seconds })),
          roasInvoices: roasDetail,
        };
      }
      // Campaign cards use the same calculation, window and spend as the ROAS card / funnel.
      const RN: Record<string, string> = { '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days', since: 'Since Sep 18', month: 'This month' };
      const wk = ptWeekStart(nowD);
      const shared = buildSharedAdSplit({
        invoices, adCalls: adsCalls, booked: dash.bookedCredited ?? [], spend, now: nowD,
        windows: { main: { label: RN[range] ?? 'Selected range', start: new Date(dash.revenueStart) }, week: { label: 'This week so far (Mon–today)', start: wk < new Date(DASH_FLOOR_ISO) ? new Date(DASH_FLOOR_ISO) : wk } },
      });
      if (dash.roas && dash.weekly?.totals) {
        dash.weekly.sources.push(
          'Blended ROAS = all pre-tax Jobber invoices issued in the range (any customer, any source) ÷ all Google Ads spend, same Pacific days (from Sep 18, when spend tracking began).',
          'ROAS (all ad callers) = pre-tax Jobber invoices issued in the range to any client whose phone called a Google Ads number before the invoice (new + repeat), ÷ Google Ads spend, same Pacific days.',
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
    dash.gaps.push('Invoice follow-up calls are outbound Google Voice calls from Liz (619-320-8264), Shanicey (442-227-2898), and Brighton (619-259-0410), matched to the customer phone or Jobber client after the invoice was issued. The Voice audit log starts in early October 2026, so earlier calls are not in it.');
    dash.gaps.push(...notes);
    const ms = await mirrorState();
    const payload = { ...dash, generatedAt: new Date().toISOString(), jobberDataAsOf: ms.ready ? ms.asOf : null, ...(debug ? { debug } : {}) };
    // TV mode may be on a shop screen: no collections or payment info leaves the server.
    if (request.nextUrl.searchParams.get('view') === 'tv') return finish(NextResponse.json(scrubForTv(payload as unknown as Record<string, unknown>)));
    return finish(NextResponse.json(payload));
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

const LOG_COLUMNS = 'voice_call_key, started_at, direction, caller_phone, called_number, ring_group, outcome, answered_by, duration_seconds, ring_seconds, client_name, customer_id, jobber_client_id, campaign_name, keyword, receptionist_call_id, synced_at';

/** Original dialed number from recorded tracking lines, for Mike/Sarah source attribution. */
async function loadRecordingHints(db: any, since: string): Promise<{ hints: DialedSourceHint[]; note: string | null }> {
  const hints: DialedSourceHint[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const q = await db.from('inbound_call_recordings').select('started_at, caller_number, tracking_number, source')
      .gte('started_at', since).neq('source', 'test').order('started_at', { ascending: false }).range(from, from + 999);
    if (q.error) return { hints, note: `recording sources: ${q.error.message}` };
    for (const r of q.data ?? []) {
      hints.push({ at: r.started_at, callerPhone: r.caller_number, dialedNumber: r.tracking_number, recordingSource: r.source });
    }
    if ((q.data ?? []).length < 1000) break;
  }
  return { hints, note: null };
}

async function loadPhoneCallLog(db: any, since: string) {
  const rows: any[] = [];
  for (let from = 0; from < 6000; from += 1000) {
    const q = await db.from('phone_call_log').select(LOG_COLUMNS).gte('started_at', since).order('started_at', { ascending: false }).range(from, from + 999);
    if (q.error) return { data: rows, error: q.error };
    rows.push(...(q.data ?? []));
    if ((q.data ?? []).length < 1000) break;
  }
  return { data: rows, error: null as null };
}

async function pageSince(db: any, table: string, columns: string, sinceIso: string) {
  const rows: any[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const q = await db.from(table).select(columns).gte('created_at', sinceIso).order('created_at', { ascending: false }).range(from, from + 999);
    if (q.error) return { rows, error: q.error.message as string };
    rows.push(...(q.data ?? []));
    if ((q.data ?? []).length < 1000) break;
  }
  return { rows, error: null as string | null };
}

function clientPhones(client: any): string[] {
  if (!client) return [];
  const raw = client.phones_digits ?? client.phones ?? [];
  return raw.map((p: any) => digits10(typeof p === 'string' ? p : p?.number)).filter((d: string | null): d is string => !!d);
}

/**
 * Unpaid Jobber invoices, one row per client, matched later by phone.
 * Balance > 0 when jobber_invoices.balance exists; otherwise past_due or awaiting_payment.
 * Attempt counts still use the period.
 */
function emailsFromClientData(data: unknown): string[] {
  const emails = data && typeof data === 'object' ? (data as { emails?: unknown }).emails : null;
  if (!Array.isArray(emails)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of emails) {
    const email = String(typeof entry === 'string' ? entry : (entry as { address?: string })?.address ?? '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function twilioTextEvents(texts: TwilioText[], seenSids: Set<string>): CollectionEvent[] {
  const events: CollectionEvent[] = [];
  for (const text of texts) {
    if (seenSids.has(text.sid)) continue;
    seenSids.add(text.sid);
    events.push({
      at: text.at,
      channel: 'text',
      source: 'app_sms',
      phone: text.to,
      invoiceNumbers: invoiceNumbersIn(text.body),
      sid: text.sid,
    });
  }
  return events;
}

async function loadPastDueClients(db: any): Promise<{ clients: PastDueClient[]; invoices: Array<Record<string, unknown>>; clientRows: Array<{ id: string; name: string | null; phones_digits: string[] | null; emails?: string[] }>; hasBalanceColumn: boolean; note: string | null }> {
  const probe = await db.from('jobber_invoices').select('balance').limit(1);
  // A missing column is normal (Postgres 42703 or PostgREST PGRST204). Do not blank the card for that.
  const hasBalanceColumn = !probe.error;
  const notes: string[] = [];
  if (probe.error && !balanceColumnMissing(probe.error)) notes.push(`invoice balance: ${probe.error.message}`);
  const select = hasBalanceColumn
    ? 'id, client_id, issued_date, invoice_status, balance, data'
    : 'id, client_id, issued_date, invoice_status, data';
  const invoices: Array<Record<string, unknown>> = [];
  for (let from = 0; from < 4000; from += 1000) {
    let q = db.from('jobber_invoices').select(select).order('issued_date', { ascending: true });
    q = hasBalanceColumn ? q.gt('balance', 0) : q.in('invoice_status', ['past_due', 'awaiting_payment']);
    const res = await q.range(from, from + 999);
    if (res.error) return { clients: [], invoices: [], clientRows: [], hasBalanceColumn, note: [`invoices: ${res.error.message}`, ...notes].join('; ') };
    invoices.push(...(res.data ?? []));
    if ((res.data ?? []).length < 1000) break;
  }
  // Page clients instead of id=in.(...), because Jobber ids are base64 and end with "=".
  const want = new Set(invoices.map((i) => i.client_id).filter(Boolean));
  const clients: Array<{ id: string; name: string | null; phones_digits: string[] | null; emails?: string[] }> = [];
  for (let from = 0; from < 8000; from += 1000) {
    const c = await db.from('jobber_clients').select('id, name, phones_digits, data').order('id', { ascending: true }).range(from, from + 999);
    if (c.error) return { clients: groupPastDueClients(invoices, clients, { hasBalanceColumn }), invoices, clientRows: clients, hasBalanceColumn, note: [`invoice clients: ${c.error.message}`, ...notes].filter(Boolean).join('; ') };
    for (const row of c.data ?? []) if (want.has(row.id)) clients.push({ id: row.id, name: row.name, phones_digits: row.phones_digits, emails: emailsFromClientData(row.data) });
    if ((c.data ?? []).length < 1000) break;
  }
  return { clients: groupPastDueClients(invoices, clients, { hasBalanceColumn }), invoices, clientRows: clients, hasBalanceColumn, note: notes.length ? notes.join('; ') : null };
}

function applyInvoiceExtras(open: OpenInvoice[], extras: Array<{ id: string; number: string | null; dueAt: string | null; emails?: string[]; phones?: string[] }>): OpenInvoice[] {
  const byId = new Map(extras.map((row) => [row.id, row]));
  return open.map((inv) => {
    const extra = byId.get(inv.id);
    if (!extra) return inv;
    return {
      ...inv,
      number: inv.number ?? extra.number,
      dueAt: inv.dueAt ?? extra.dueAt,
      emails: mergeValues(inv.emails, extra.emails, (value) => value.trim().toLowerCase() || null),
      phones: mergeValues(inv.phones, extra.phones, (value) => digits10(value)),
    };
  });
}

function mergeValues(current: string[] | undefined, extra: string[] | undefined, norm: (value: string) => string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...(current ?? []), ...(extra ?? [])]) {
    const value = norm(String(raw));
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function invoiceNumberList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((n) => String(n).trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) return raw.split(/[,\s]+/).map((n) => n.trim()).filter(Boolean);
  return [];
}

async function loadCollectionTexts(db: any): Promise<{ events: CollectionEvent[]; sids: Set<string>; ok: boolean; note: string | null }> {
  const events: CollectionEvent[] = [];
  const sids = new Set<string>();
  let columns = 'created_at, client_id, invoice_numbers, status, twilio_sid';
  for (let from = 0; from < 5000; from += 1000) {
    const q = await db.from('collection_sms_log').select(columns).eq('status', 'sent').order('created_at', { ascending: false }).range(from, from + 999);
    if (q.error && columns.includes('twilio_sid') && /twilio_sid/i.test(q.error.message)) {
      columns = 'created_at, client_id, invoice_numbers, status';
      from -= 1000;
      continue;
    }
    if (q.error) return { events: [], sids, ok: false, note: `collection texts: ${q.error.message}` };
    for (const row of q.data ?? []) {
      if (!row.created_at) continue;
      if (row.twilio_sid) sids.add(String(row.twilio_sid));
      events.push({
        at: row.created_at,
        channel: 'text',
        source: 'app_sms',
        clientId: row.client_id ?? null,
        invoiceNumbers: invoiceNumberList(row.invoice_numbers),
        sid: row.twilio_sid ? String(row.twilio_sid) : null,
      });
    }
    if ((q.data ?? []).length < 1000) break;
  }
  return { events, sids, ok: true, note: null };
}

async function clientPhoneMap(db: any): Promise<{ phones: Map<string, string[]>; note: string | null }> {
  const phones = new Map<string, string[]>();
  for (let from = 0; from < 8000; from += 1000) {
    const c = await db.from('jobber_clients').select('id, phones_digits').order('id', { ascending: true }).range(from, from + 999);
    if (c.error) return { phones, note: `callback clients: ${c.error.message}` };
    for (const row of c.data ?? []) phones.set(row.id, row.phones_digits ?? []);
    if ((c.data ?? []).length < 1000) break;
  }
  return { phones, note: null };
}

/** Jobs (any status in the mirror), quotes, invoices, visits, and website requests on or after the call. */
async function loadWorkRows(db: any, sinceIso: string): Promise<{ rows: Array<{ phone: string | null; at: string }>; note: string | null }> {
  const out: Array<{ phone: string | null; at: string }> = [];
  const notes: string[] = [];
  const clients = await clientPhoneMap(db);
  if (clients.note) notes.push(clients.note);
  const jobs = await pageSince(db, 'jobber_jobs', 'client_id, created_at, data', sinceIso);
  if (jobs.error) notes.push(`callback jobs: ${jobs.error}`);
  else for (const j of jobs.rows) {
    const phones = clients.phones.get(j.client_id) ?? [];
    if (j.created_at) for (const p of phones) out.push({ phone: p, at: j.created_at });
    for (const visit of j.data?.visits?.nodes ?? []) {
      const at = visit?.createdAt || visit?.startAt;
      if (at) for (const p of phones) out.push({ phone: p, at });
    }
  }
  const quotes = await pageSince(db, 'jobber_quotes', 'created_at, data', sinceIso);
  if (quotes.error) notes.push(`callback quotes: ${quotes.error}`);
  else for (const q of quotes.rows) {
    const phones = new Set<string>([...clientPhones(q.data?.client), ...(clients.phones.get(q.data?.client?.id) ?? [])]);
    if (q.created_at) for (const p of phones) out.push({ phone: p, at: q.created_at });
  }
  const invoices = await pageIssued(db, sinceIso);
  if (invoices.error) notes.push(`callback invoices: ${invoices.error}`);
  else for (const inv of invoices.rows) {
    const at = inv.issued_date || inv.data?.createdAt;
    if (!at) continue;
    for (const p of clients.phones.get(inv.client_id) ?? []) out.push({ phone: p, at });
  }
  const reqs = await pageSince(db, 'booking_requests', 'phone, created_at, source', sinceIso);
  if (reqs.error) notes.push(`callback requests: ${reqs.error}`);
  else for (const r of reqs.rows) if (r.created_at && requestResolvesCallback(r.source) && !isOwnNumber(r.phone)) out.push({ phone: r.phone, at: r.created_at });
  return { rows: out, note: notes.length ? notes.join('; ') : null };
}

async function pageIssued(db: any, sinceIso: string) {
  const rows: any[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const q = await db.from('jobber_invoices').select('client_id, issued_date, data').gte('issued_date', sinceIso).order('issued_date', { ascending: false }).range(from, from + 999);
    if (q.error) return { rows, error: q.error.message as string };
    rows.push(...(q.data ?? []));
    if ((q.data ?? []).length < 1000) break;
  }
  return { rows, error: null as string | null };
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
  if (dash.roas) delete (dash.roas as any).mer; // legacy name; blended ROAS now lives in dash.roas.blended
}

/** Tracking numbers shown on each non-ad source card. Yelp / Apple Maps have no number yet (forms only). */
const SOURCE_NUMBERS: Partial<Record<SourceKey, string[]>> = {
  gbp: ['(760) 279-1262 Ramona', '(951) 651-0957 Anza'], seo: ['(760) 463-0493'], yelp: ['(760) 891-4264'], apple_maps: ['(760) 454-0365'],
};
const SOURCE_NOTES: Partial<Record<SourceKey, string>> = {
  gbp: 'Calls recorded from Oct 12. Form source saved from Oct 13.',
  seo: 'Website visitors from search see this number. Form source saved from Oct 13.',
  yelp: 'Calls tracked from Oct 13 once the number is on the Yelp listing. Forms from Yelp.',
  apple_maps: 'Calls tracked from Oct 13 once the number is on the Apple Maps listing. Forms from Apple Maps.',
};

async function loadSourceCards(db: any, startMs: number) {
  const startIso = new Date(startMs).toISOString();
  const [recs, forms, jobs] = await Promise.all([
    db.from('inbound_call_recordings').select('started_at, caller_number, source').gte('started_at', startIso).neq('source', 'test').limit(5000),
    db.from('booking_requests').select('created_at, phone, lead_source, service_type').eq('source', 'website').gte('created_at', startIso).limit(5000),
    db.from('jobber_jobs').select('client_id, title, created_at').gte('created_at', new Date(startMs - 3600_000).toISOString()).limit(5000),
  ]);
  for (const r of [recs, forms, jobs]) if (r.error) throw new Error(r.error.message);
  const ids = Array.from(new Set((jobs.data ?? []).map((j: any) => j.client_id).filter(Boolean))) as string[];
  const phones = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 150) {
    const c = await db.from('jobber_clients').select('id, phones_digits').in('id', ids.slice(i, i + 150));
    if (c.error) throw new Error(c.error.message);
    for (const r of c.data ?? []) phones.set(r.id, r.phones_digits ?? []);
  }
  return buildSourceCards({
    startMs, nowMs: Date.now(),
    calls: (recs.data ?? []).filter((r: any) => !isOwnNumber(r.caller_number)).map((r: any) => ({ at: r.started_at, phone: r.caller_number, source: r.source })),
    forms: (forms.data ?? []).filter((f: any) => f.lead_source !== 'test' && !isOwnNumber(f.phone)).map((f: any) => ({ at: f.created_at, phone: f.phone, channel: f.lead_source, serviceType: f.service_type })),
    jobs: (jobs.data ?? []).map((j: any) => ({ createdAt: j.created_at, title: j.title, phones: phones.get(j.client_id) ?? [] })),
    numbers: SOURCE_NUMBERS, notes: SOURCE_NOTES,
  });
}
