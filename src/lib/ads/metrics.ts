/** Pure builders for the /ops/metrics page. Never estimates: a metric without honest data returns value null + needs. */
import { invoicePretaxUsd } from './invoice-value.ts';
import { workCategory } from './work-category.ts';
import { ptDateKey, ptStartOfDay, type RoasView } from './call-dashboard.ts';
import type { HistInvoice, CostJob, TimeEntry } from './metrics-data.ts';
import type { WeeklyQuote } from './weekly-sales.ts';
import { mergeFullHistory, summarize, nrrWindow, type QboHistory } from './ltv-full.ts';
import { INTERNAL_EXCLUSION_NOTE, isInternalJob } from './internal-job.ts';
import { callbackMarked } from '../jobber/job-custom-fields.ts';

export interface MetricRow { label: string; value: string; note?: string; hover?: string }
export interface MetricCard { id: string; title: string; value: string; sub?: string; rows?: MetricRow[]; measures: string; source: string; range: string; needs?: string; hover?: string; badge?: string }

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const NA = '—';
/** Whole-line costs typed into the per-unit field land above this multiple of revenue. Equal to 2× stays in. */
export const MARGIN_IMPLAUSIBLE_COST_RATIO = 2;
/** Shown on the card (not "—") so /ops/metrics keeps the utilization card on the page. */
export const TIMESHEET_PERMISSION_STATE = 'Needs Jobber timesheet permission';
export const TIMESHEET_PERMISSION_NEEDS = 'needs the Timesheets read scope on the SCWS Jobber app, then a re-authorization. Jobber hid TimeSheetEntry ("An object of type TimeSheetEntry was hidden due to permissions"). In the Jobber Developer Center, enable Timesheets read and have a Jobber admin re-authorize the app. The stored token does not pick up a new scope until that re-authorization. Do not refresh tokens from a laptop. Crews also need to clock in and out in Jobber.';

export function timesheetPermissionDenied(error: string | null | undefined): boolean {
  return /permission|TimeSheetEntry was hidden/i.test(error ?? '');
}

/** OPS_MARGIN_SINCE: YYYY-MM-DD is Pacific midnight. A full timestamp is used as an instant. */
export function parseMarginSince(raw: string | null | undefined): { since: Date | null; invalid: string | null } {
  const text = raw?.trim() ?? '';
  if (!text) return { since: null, invalid: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { since: ptStartOfDay(new Date(`${text}T12:00:00Z`)), invalid: null };
  const t = Date.parse(text);
  if (!Number.isFinite(t)) return { since: null, invalid: text };
  return { since: new Date(t), invalid: null };
}

export interface MarginSelection { included: CostJob[]; implausible: CostJob[]; noCost: number; beforeStart: number }

/** Drop internal jobs, completions before `since`, and costs that cannot be real (over 2× revenue, or a cost with $0 revenue). */
export function selectMarginJobs(jobs: CostJob[], since: Date | null): MarginSelection {
  const included: CostJob[] = [];
  const implausible: CostJob[] = [];
  let noCost = 0;
  let beforeStart = 0;
  for (const job of jobs) {
    if (isInternalJob(job)) continue;
    if (since) {
      const at = Date.parse(job.completedAt || '');
      if (!Number.isFinite(at) || at < since.getTime()) { beforeStart++; continue; }
    }
    const rev = job.jobCosting?.totalRevenue ?? 0;
    const cost = job.jobCosting?.totalCost ?? 0;
    if (rev > 0 && cost > 0 && cost <= MARGIN_IMPLAUSIBLE_COST_RATIO * rev) included.push(job);
    else if (cost > 0 && (rev <= 0 || cost > MARGIN_IMPLAUSIBLE_COST_RATIO * rev)) implausible.push(job);
    else if (rev > 0) noCost++;
  }
  return { included, implausible, noCost, beforeStart };
}

export interface FirstTimeFix { rate: number | null; total: number; callbacks: number; fixed: number; unread: number; needs: string }

/** Service-call jobs, plus any other job explicitly marked Callback. Unread custom fields block a rate. */
export function summarizeFirstTimeFix(jobs: CostJob[]): FirstTimeFix {
  let total = 0;
  let callbacks = 0;
  let unread = 0;
  let sawFields = false;
  let sawCallback = false;
  for (const job of jobs) {
    if (isInternalJob(job)) continue;
    const flag = callbackMarked(job.customFields);
    if (flag !== null) sawFields = true;
    if (Array.isArray(job.customFields) && job.customFields.some((field) => String(field?.label ?? '').trim().toLowerCase() === 'callback')) sawCallback = true;
    const service = workCategory(job.title) === 'service_call';
    if (flag === null) {
      if (service) unread++;
      continue;
    }
    if (service || flag) {
      total++;
      if (flag) callbacks++;
    }
  }
  const fixed = total - callbacks;
  if (sawFields && !sawCallback) {
    return { rate: null, total, callbacks, fixed, unread, needs: 'needs the Jobber job custom field named Callback (true/false). Custom fields were read, and none of the completed jobs in this window has that label.' };
  }
  if (!sawFields) {
    return { rate: null, total, callbacks, fixed, unread, needs: 'needs the Jobber job custom field Callback (true/false). Job.customFields is readable with the Jobs scope this app already has (CustomFieldTrueFalse, label Callback, valueTrueFalse). This pull has no custom fields yet; the job mirror stores them the next time it syncs completed jobs. Nothing is written to Jobber.' };
  }
  if (unread > 0) {
    return { rate: null, total, callbacks, fixed, unread, needs: `needs custom fields on every service job in this window (${unread} still missing), so a first-time fix rate is not shown yet.` };
  }
  if (total === 0) {
    return { rate: null, total, callbacks, fixed, unread, needs: 'needs completed service-call jobs in this window (title starts with Service call), or a completed job marked Callback.' };
  }
  return { rate: fixed / total, total, callbacks, fixed, unread, needs: '' };
}
const DAY = 86400_000;
type Cat = 'drilling' | 'pump';
/** Service calls ($200 diagnostic) roll into pump & service for customer-level metrics. */
const cat2 = (title?: string | null): Cat => (workCategory(title) === 'drilling' ? 'drilling' : 'pump');
const md = (k: string) => { const [y, m, d] = k.split('-').map(Number); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${d}, ${y}`; };

export interface LtvResult { overall: number | null; pump: number | null; drilling: number | null; clients: number; pumpClients: number; drillClients: number; revenue: number }

export function lifetimeValue(invoices: HistInvoice[]): LtvResult {
  const by = { all: new Map<string, number>(), pump: new Map<string, number>(), drilling: new Map<string, number>() };
  for (const inv of invoices) {
    if (isInternalJob(inv)) continue;
    const pre = invoicePretaxUsd(inv); const cid = inv.client?.id;
    if (!pre || !cid) continue;
    const c = cat2(inv.jobs?.nodes?.[0]?.title);
    by.all.set(cid, (by.all.get(cid) ?? 0) + pre);
    by[c].set(cid, (by[c].get(cid) ?? 0) + pre);
  }
  const avg = (m: Map<string, number>) => { if (!m.size) return null; let s = 0; m.forEach((v) => { s += v; }); return s / m.size; };
  let revenue = 0; by.all.forEach((v) => { revenue += v; });
  return { overall: avg(by.all), pump: avg(by.pump), drilling: avg(by.drilling), clients: by.all.size, pumpClients: by.pump.size, drillClients: by.drilling.size, revenue };
}

export function buildMetrics(input: {
  now: Date;
  histFrom: Date;
  history: { rows: HistInvoice[] | null; error?: string; truncated?: boolean };
  roasSince: RoasView | null; // buildRoasView since Sep 18 (strict new-customer rule)
  sinceLabel: string;
  quotes: WeeklyQuote[] | null; quotesFrom: Date;
  costs: { rows: CostJob[] | null; error?: string; customFieldsError?: string }; costFrom: Date;
  /** OPS_MARGIN_SINCE. YYYY-MM-DD is Pacific midnight. Completions before this are left out of margin. */
  marginSince?: string | null;
  time: { rows: TimeEntry[] | null; error?: string }; timeFrom: Date;
  qboConnected: boolean;
  qbo?: QboHistory | null; // static pre-Jobber QuickBooks sales (Oct 2020 – Feb 2025)
}): MetricCard[] {
  const today = ptDateKey(input.now);
  const inv = input.history.rows;
  // Jobber history may start later than the requested window (SCWS's Jobber data starts Feb 2025): show the real span.
  const oldest = inv?.reduce<number>((m, r) => { const t = Date.parse(r.issuedDate || ''); return Number.isFinite(t) && t < m ? t : m; }, Infinity) ?? Infinity;
  const histStart = Number.isFinite(oldest) && oldest > input.histFrom.getTime() ? new Date(oldest) : input.histFrom;
  const histRange = `${md(ptDateKey(histStart))} – ${md(today)} (invoice issue date; all Jobber history in that span)`;
  const cards: MetricCard[] = [];
  const histNeeds = inv ? undefined : `needs Jobber invoice history (load failed: ${input.history.error ?? 'unknown'})`;
  const trunc = input.history.truncated ? ' Warning: Jobber page cap hit, some invoices may be missing.' : '';

  // 1) LTV — full history: QuickBooks (Oct 2020 – Feb 2025) + Jobber
  const FULL = 'QuickBooks Oct 2020–Feb 2025 + Jobber';
  const full = inv && input.qbo ? mergeFullHistory(input.qbo, inv as any) : null;
  const sA = full ? summarize(full.customers) : null;
  const sP = full ? summarize(full.customers.filter((c) => c.dept === 'pump')) : null;
  const sD = full ? summarize(full.customers.filter((c) => c.dept === 'drilling')) : null;
  const fullRange = `Oct 3, 2020 – ${md(today)} (QuickBooks sales Oct 2020–Feb 2025, then Jobber invoices)`;
  const ltv = sA ? { overall: sA.avg, pump: sP!.avg, drilling: sD!.avg } : null;
  const both = full ? summarize(full.customers.filter((c) => c.source === 'both')) : null;
  cards.push({
    id: 'ltv', title: 'Customer lifetime value', badge: FULL,
    value: sA?.avg != null ? usd(sA.avg) : NA,
    sub: sA ? `${sA.n.toLocaleString()} customers · ${usd(sA.total)} pre-tax since Oct 2020` : undefined,
    rows: sA ? [
      { label: 'Pump & service', value: sP!.avg != null ? usd(sP!.avg) : NA, note: `${sP!.n.toLocaleString()} customers · median ${usd(sP!.median ?? 0)}` },
      { label: 'Drilling', value: sD!.avg != null ? usd(sD!.avg) : NA, note: `${sD!.n} customers · median ${usd(sD!.median ?? 0)}` },
    ] : undefined,
    hover: both ? `Customers in both QuickBooks and Jobber: ${both.n}, avg ${usd(both.avg ?? 0)}` : undefined,
    measures: 'Average pre-tax revenue per customer across the whole business history (actual, not a projection). A customer is drilling if any of their work was drilling, otherwise pump & service. QuickBooks and Jobber customers are matched by exact name, so a few spelling variants are counted twice (slightly understates LTV). ' + INTERNAL_EXCLUSION_NOTE + trunc,
    source: `${FULL}: QuickBooks Sales by Customer Detail (pre-tax, static snapshot) + live Jobber invoices (not draft/void, subtotal − discount). QuickBooks invoices dated Feb 25–28, 2025 that also appear in Jobber (same amount within 3 days) are dropped.${full ? ` ${full.matched} QuickBooks customers matched to Jobber; ${full.droppedDupes} duplicate invoices dropped.` : ''}`,
    range: fullRange, needs: histNeeds ?? (input.qbo ? undefined : 'needs the QuickBooks history file'),
  });

  // 8) CAC by channel (strict new-customer rule)
  const r = input.roasSince;
  const cac = (spend: number | null | undefined, n: number | undefined) => (spend != null && n && n > 0 ? spend / n : null);
  const cacAll = r ? cac(r.spend, r.newOnly.clients) : null;
  const cacPump = r ? cac(r.byCategory.pump.spend, r.byCategory.pump.newOnly.clients) : null;
  const cacDrill = r ? cac(r.byCategory.drilling.spend, r.byCategory.drilling.newOnly.clients) : null;
  const cacRange = `${input.sinceLabel} (Google Ads spend days and invoice issue dates, Pacific)`;
  cards.push({
    id: 'cac', title: 'CAC by channel',
    value: cacAll != null ? usd(cacAll) : NA,
    sub: r ? `Google Ads total: ${usd(r.spend ?? 0)} spend ÷ ${r.newOnly.clients} new customers invoiced` : undefined,
    rows: r ? [
      { label: 'Google Ads · Pump', value: cacPump != null ? usd(cacPump) : NA, note: `${usd(r.byCategory.pump.spend ?? 0)} ÷ ${r.byCategory.pump.newOnly.clients}` },
      { label: 'Google Ads · Drilling', value: cacDrill != null ? usd(cacDrill) : NA, note: `${usd(r.byCategory.drilling.spend ?? 0)} spend, ${r.byCategory.drilling.newOnly.clients} new customers invoiced` },
      { label: 'Referral / repeat / GBP / Mike', value: NA, note: 'needs spend per channel (no cost tracked)' },
    ] : undefined,
    measures: 'Ad spend ÷ new customers acquired. New customer = no Jobber job before their first Google Ads call, and invoiced in the window (credited to the campaign of their last ad call). ' + INTERNAL_EXCLUSION_NOTE,
    source: 'Google Ads API daily spend; Google Ads call log (ads_calls); Jobber invoices + client job history.', range: cacRange,
    needs: r ? undefined : 'needs Google Ads spend + Jobber invoices (load failed)',
  });

  // 2) LTV:CAC
  const ratio = (l: number | null | undefined, c: number | null) => (l != null && c != null && c > 0 ? `${(Math.round((l / c) * 10) / 10).toFixed(1)}:1` : NA);
  cards.push({
    id: 'ltv-cac', title: 'LTV : CAC',
    value: ratio(ltv?.overall, cacAll),
    sub: ltv?.overall != null && cacAll != null ? `${usd(ltv.overall)} LTV ÷ ${usd(cacAll)} CAC` : undefined,
    rows: [
      { label: 'Pump & service', value: ratio(ltv?.pump, cacPump), note: ltv?.pump != null && cacPump != null ? `${usd(ltv.pump)} ÷ ${usd(cacPump)}` : undefined },
      { label: 'Drilling', value: ratio(ltv?.drilling, cacDrill), note: cacDrill == null ? 'no new drilling customers invoiced yet, so CAC is undefined' : undefined },
    ],
    measures: 'Customer lifetime value (card 1) ÷ Google Ads CAC (card 8). Above 3:1 is the usual rule of thumb. Mixes a full-history LTV with a short CAC window, so read it as directional. ' + INTERNAL_EXCLUSION_NOTE,
    source: `Cards 1 (${FULL}) and 8.`, range: `LTV: Oct 2020 – ${md(today)}. CAC: ${input.sinceLabel}.`, badge: FULL,
    needs: ltv?.overall == null || cacAll == null ? 'needs both LTV and CAC' : undefined,
  });

  // 3) Gross margin per job. Implausible Jobber unit costs are excluded and counted, not allowed to blank the card.
  const parsedSince = parseMarginSince(input.marginSince);
  const since = parsedSince.since;
  const windowStart = since && since > input.costFrom ? since : input.costFrom;
  const costRange = `${md(ptDateKey(windowStart))} – ${md(today)} (job completed date)`;
  const marginSource = `Jobber job costing. Set OPS_MARGIN_SINCE (YYYY-MM-DD, Pacific midnight) to ignore completions before cost tracking was reliable.${input.qboConnected ? '' : ' QuickBooks API is not connected to this app, so QuickBooks costs are not used.'}`;
  const marginMeasures = 'Average (revenue − cost) per completed job with a plausible Jobber cost, and that profit as a percent of revenue. Cost is Jobber job costing (line-item cost, labour, and expenses). Jobs whose cost is over 2× revenue, or that have a cost and $0 revenue, are left out of the average and counted as excluded. Those records stay in Jobber. ' + INTERNAL_EXCLUSION_NOTE + (since ? ` Completions before ${md(ptDateKey(since))} are not counted.` : '');
  let gm: MetricCard = { id: 'margin', title: 'Gross margin per job', value: NA, measures: marginMeasures, source: marginSource, range: costRange };
  if (!input.costs.rows) gm.needs = `needs Jobber job costing (query failed: ${input.costs.error ?? 'unknown'})`;
  else {
    const sel = selectMarginJobs(input.costs.rows, since);
    const pool = sel.included.length + sel.noCost;
    const share = pool ? sel.included.length / pool : 0;
    const bits = [`${sel.included.length} jobs in the average`];
    if (sel.implausible.length) bits.push(`${sel.implausible.length} excluded (cost over ${MARGIN_IMPLAUSIBLE_COST_RATIO}× revenue, or a cost with $0 revenue)`);
    if (sel.beforeStart) bits.push(`${sel.beforeStart} completed before ${md(ptDateKey(since!))} not counted`);
    if (parsedSince.invalid) bits.push(`OPS_MARGIN_SINCE ("${parsedSince.invalid}") is not a date, so no start-date cutoff was applied`);
    gm.sub = bits.join(' · ');
    const worst = sel.implausible.slice().sort((a, b) => ((b.jobCosting?.totalCost ?? 0) - (b.jobCosting?.totalRevenue ?? 0)) - ((a.jobCosting?.totalCost ?? 0) - (a.jobCosting?.totalRevenue ?? 0)))[0];
    if (worst) gm.hover = `Largest excluded job: #${worst.jobNumber ?? '?'} ${worst.title?.trim() ?? ''} — cost ${usd(worst.jobCosting?.totalCost ?? 0)} on ${usd(worst.jobCosting?.totalRevenue ?? 0)} revenue. Not changed in Jobber.`;
    const thin = sel.included.length < 10 || share < 0.5;
    if (thin) {
      if (sel.included.length === 0 && sel.implausible.length > 0 && sel.noCost === 0) gm.needs = `needs job costs: all ${sel.implausible.length} costed jobs in this window were excluded (cost over 2× revenue, or a cost with $0 revenue), so no margin is shown.`;
      else {
        gm.needs = `needs job costs: only ${sel.included.length} of ${pool} completed jobs have a plausible cost in Jobber (line-item costs, timesheets or expenses), so a margin would be overstated`;
        if (sel.implausible.length) gm.needs += `. ${sel.implausible.length} additional jobs were excluded because cost was over 2× revenue or the job had a cost and $0 revenue`;
        if (sel.beforeStart) gm.needs += `. ${sel.beforeStart} completions before ${md(ptDateKey(since!))} were not counted`;
      }
    } else {
      const agg = (js: CostJob[]) => { const rev = js.reduce((s, j) => s + (j.jobCosting?.totalRevenue ?? 0), 0); const cost = js.reduce((s, j) => s + (j.jobCosting?.totalCost ?? 0), 0); return { n: js.length, per: js.length ? (rev - cost) / js.length : 0, m: rev > 0 ? (rev - cost) / rev : 0 }; };
      const a = agg(sel.included); const p = agg(sel.included.filter((j) => cat2(j.title) === 'pump')); const d = agg(sel.included.filter((j) => cat2(j.title) === 'drilling'));
      gm.value = `${usd(a.per)} · ${pct(a.m)}`;
      gm.rows = [
        { label: 'Pump & service', value: p.n ? `${usd(p.per)} · ${pct(p.m)}` : NA, note: `${p.n} jobs` },
        { label: 'Drilling', value: d.n ? `${usd(d.per)} · ${pct(d.m)}` : NA, note: `${d.n} jobs` },
      ];
      if (sel.implausible.length) gm.rows.push({ label: 'Excluded', value: String(sel.implausible.length), note: 'cost over 2× revenue, or a cost with $0 revenue' });
      if (sel.beforeStart) gm.rows.push({ label: 'Before cost tracking', value: String(sel.beforeStart), note: `completed before ${md(ptDateKey(since!))}` });
    }
  }
  cards.push(gm);

  // 4) First-time fix rate — Jobber job custom field Callback (true/false), when the pull includes it.
  const ftf: MetricCard = {
    id: 'ftf', title: 'First-time fix rate', value: NA, range: costRange,
    measures: 'Share of completed service jobs that were not marked Callback. Service jobs are titles that start with Service call, plus any other completed job whose Jobber true/false custom field Callback is true. Callback means a return for the same problem, so it counts against the rate. ' + INTERNAL_EXCLUSION_NOTE,
    source: 'Jobber job custom field Callback (true/false) on completed jobs. Read only.',
  };
  if (!input.costs.rows) ftf.needs = `needs Jobber jobs (query failed: ${input.costs.error ?? 'unknown'})`;
  else if (input.costs.customFieldsError) ftf.needs = `needs Jobber job custom fields (${input.costs.customFieldsError}). Callback is a true/false job custom field (Job.customFields, label Callback, valueTrueFalse). The Jobs read scope is enough to read values. Margin does not use this field.`;
  else {
    const fix = summarizeFirstTimeFix(input.costs.rows);
    if (fix.rate == null) ftf.needs = fix.needs;
    else {
      ftf.value = pct(fix.rate);
      ftf.sub = `${fix.fixed} of ${fix.total} not marked Callback · ${fix.callbacks} callback${fix.callbacks === 1 ? '' : 's'}`;
    }
  }
  cards.push(ftf);

  // 5) Technician utilization
  const timeRange = `${md(ptDateKey(input.timeFrom))} – ${md(today)} (timesheet start)`;
  const te = input.time.rows;
  const ut: MetricCard = { id: 'util', title: 'Technician utilization', value: NA, measures: 'Clocked hours on a job ÷ all clocked hours (job + general/travel/shop time). Hours on internal/training/test jobs are excluded.', source: 'Jobber timesheets.', range: timeRange };
  const timesheetBlocked = timesheetPermissionDenied(input.time.error);
  if (timesheetBlocked && (!te || te.length === 0)) {
    ut.value = TIMESHEET_PERMISSION_STATE;
    ut.needs = TIMESHEET_PERMISSION_NEEDS;
  } else if (!te) ut.needs = `needs Jobber timesheets (query failed: ${input.time.error ?? 'unknown'})`;
  else {
    const hrs = (e: TimeEntry) => { if (typeof e.finalDuration === 'number' && e.finalDuration > 0) return e.finalDuration / 3600; const a = Date.parse(e.startAt || ''), b = Date.parse(e.endAt || ''); return Number.isFinite(a) && Number.isFinite(b) && b > a ? (b - a) / 3600_000 : 0; };
    const total = te.reduce((s, e) => s + hrs(e), 0); const onJob = te.filter((e) => e.job?.id).reduce((s, e) => s + hrs(e), 0);
    const users = new Set(te.map((e) => e.user?.id).filter(Boolean)).size;
    if (te.length < 20 || total < 40) ut.needs = `needs crew timesheets in Jobber: only ${te.length} entries (${Math.round(total)} h) logged in the window. Paid hours per tech are also needed for true utilization.`;
    else { ut.value = pct(onJob / total); ut.sub = `${Math.round(onJob)} h on jobs of ${Math.round(total)} h clocked · ${users} people`; }
  }
  cards.push(ut);

  // 6) Quote-to-close cycle time
  const qs = input.quotes?.filter((q) => !isInternalJob(q)) ?? null;
  const qRange = `Quotes created ${md(ptDateKey(input.quotesFrom))} – ${md(today)}`;
  const cy: MetricCard = { id: 'cycle', title: 'Quote-to-close cycle time', value: NA, measures: 'Median days from quote sent to approved (or converted to a job). Jobber only exposes the latest status change, so converted quotes are measured to conversion, which can run a little long. ' + INTERNAL_EXCLUSION_NOTE, source: 'Jobber quotes: sentAt → transitionedAt, status approved/converted. Service-call quotes ($200, auto-created) and quotes never marked sent (approved on the spot) are excluded.', range: qRange };
  if (!qs) cy.needs = 'needs Jobber quotes (load failed)';
  else {
    const days = (c: Cat | null) => qs.filter((q) => /approved|converted/i.test(q.quoteStatus || '') && workCategory(q.title) !== 'service_call' && (!c || cat2(q.title) === c))
      .map((q) => (Date.parse(q.transitionedAt || '') - Date.parse(q.sentAt || '')) / DAY).filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
    const med = (a: number[]) => (a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null);
    const f = (a: number[]) => { const m = med(a); return m == null ? NA : m < 1 ? 'Same day' : `${Math.round(m)} day${Math.round(m) === 1 ? '' : 's'}`; };
    const sameDay = (a: number[]) => (a.length ? `${pct(a.filter((x) => x < 1).length / a.length)} within 24 h` : '');
    const all = days(null), p = days('pump'), d = days('drilling');
    cy.value = f(all); cy.sub = `Median of ${all.length} won quotes · ${sameDay(all)}`;
    cy.rows = [{ label: 'Pump & service', value: f(p), note: `${p.length} quotes · ${sameDay(p)}` }, { label: 'Drilling', value: f(d), note: `${d.length} quotes · ${sameDay(d)}` }];
  }
  cards.push(cy);

  // 7) Repeat purchase rate — full history
  const rp: MetricCard = { id: 'repeat', title: 'Repeat purchase rate', value: NA, badge: FULL, measures: 'Share of all customers since Oct 2020 who came back: bought again at least 60 days after an earlier purchase. The 60-day gap keeps a $200 service call plus the repair it led to from counting as a repeat. ' + INTERNAL_EXCLUSION_NOTE + trunc, source: `${FULL}, grouped by customer (same merge as card 1).`, range: fullRange, needs: card1Needs() };
  if (sA) {
    rp.value = pct(sA.repeatRate ?? 0); rp.sub = `${sA.repeat60.toLocaleString()} of ${sA.n.toLocaleString()} customers`;
    rp.rows = [{ label: 'Pump & service customers', value: pct(sP!.repeatRate ?? 0), note: `${sP!.repeat60} of ${sP!.n.toLocaleString()}` }, { label: 'Drilling customers', value: pct(sD!.repeatRate ?? 0), note: `${sD!.repeat60} of ${sD!.n}` }];
  }
  cards.push(rp);

  // 9) Net revenue retention — trailing 12 months vs the 12 before, full history
  const ymd = (k: string, dy: number) => `${Number(k.slice(0, 4)) - dy}${k.slice(4)}`;
  const nr: MetricCard = { id: 'nrr', title: 'Net revenue retention', value: NA, badge: FULL, measures: 'What last year\'s customers spent this year ÷ what they spent last year (same customers). Over 100% = existing customers spend more. Emergency pump and one-off drilling work naturally runs low; watch the trend. ' + INTERNAL_EXCLUSION_NOTE, source: `${FULL}, pre-tax, grouped by customer (same merge as card 1).`, range: `Last year: ${md(ymd(today, 2))} – ${md(ymd(today, 1))}; this year: ${md(ymd(today, 1))} – ${md(today)}`, needs: card1Needs() };
  if (full) {
    const w = (k: number, d?: 'pump' | 'drilling') => nrrWindow(full, ymd(today, k + 1), ymd(today, k), ymd(today, k - 1), d);
    const a = w(1), p = w(1, 'pump'), d = w(1, 'drilling');
    nr.value = a.nrr != null ? pct(a.nrr) : NA;
    nr.sub = `${a.customers} customers: ${usd(a.prior)} last year → ${usd(a.next)} this year · ${pct(a.customers ? a.retained / a.customers : 0)} bought again`;
    nr.rows = [{ label: 'Pump & service', value: p.nrr != null ? pct(p.nrr) : NA, note: `${usd(p.prior)} → ${usd(p.next)}` }, { label: 'Drilling', value: d.nrr != null ? pct(d.nrr) : NA, note: `${usd(d.prior)} → ${usd(d.next)}` }];
    const prior: string[] = [];
    for (let k = 2; ymd(today, k + 1) >= '2020-10-03'; k++) { const x = w(k); if (x.nrr != null) prior.push(`${ymd(today, k).slice(0, 4)}→${ymd(today, k - 1).slice(0, 4)}: ${pct(x.nrr)} (${x.customers} customers)`); }
    if (prior.length) { nr.hover = `Prior years (same dates, 12 months → next 12): ${prior.join(' · ')}` }
  }
  cards.push(nr);
  function card1Needs() { return histNeeds ?? (input.qbo ? undefined : 'needs the QuickBooks history file'); }
  const order = ['ltv', 'ltv-cac', 'margin', 'ftf', 'util', 'cycle', 'repeat', 'cac', 'nrr'];
  return order.map((id) => cards.find((c) => c.id === id)!);
}
