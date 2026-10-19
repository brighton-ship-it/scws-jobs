/** Pure builders for the /ops/metrics page. Never estimates: a metric without honest data returns value null + needs. */
import { invoicePretaxUsd } from './invoice-value.ts';
import { workCategory } from './work-category.ts';
import { ptDateKey, type RoasView } from './call-dashboard.ts';
import type { HistInvoice, CostJob, TimeEntry } from './metrics-data.ts';
import type { WeeklyQuote } from './weekly-sales.ts';
import { mergeFullHistory, summarize, nrrWindow, type QboHistory } from './ltv-full.ts';
import { INTERNAL_EXCLUSION_NOTE, isInternalJob } from './internal-job.ts';

export interface MetricRow { label: string; value: string; note?: string; hover?: string }
export interface MetricCard { id: string; title: string; value: string; sub?: string; rows?: MetricRow[]; measures: string; source: string; range: string; needs?: string; hover?: string; badge?: string }

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const NA = '—';
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
  costs: { rows: CostJob[] | null; error?: string }; costFrom: Date;
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

  // 3) Gross margin per job
  const costRange = `${md(ptDateKey(input.costFrom))} – ${md(today)} (job completed date)`;
  const cj = input.costs.rows?.filter((j) => !isInternalJob(j)) ?? null;
  let gm: MetricCard = { id: 'margin', title: 'Gross margin per job', value: NA, measures: 'Average (revenue − cost) per completed job, and margin %, using Jobber job costing (line-item cost + labour from timesheets + expenses). ' + INTERNAL_EXCLUSION_NOTE, source: `Jobber job costing.${input.qboConnected ? '' : ' QuickBooks API is not connected to this app, so QuickBooks costs are not used.'}`, range: costRange };
  if (!cj) gm.needs = `needs Jobber job costing (query failed: ${input.costs.error ?? 'unknown'})`;
  else {
    const withRev = cj.filter((j) => (j.jobCosting?.totalRevenue ?? 0) > 0);
    const costed = withRev.filter((j) => (j.jobCosting?.totalCost ?? 0) > 0);
    const share = withRev.length ? costed.length / withRev.length : 0;
    gm.sub = `${costed.length} of ${withRev.length} completed jobs with revenue have any cost entered`;
    // Line-item costs entered per foot / per unit at the wrong scale show up as cost far above revenue.
    const bad = costed.filter((j) => (j.jobCosting?.totalCost ?? 0) > 2 * (j.jobCosting?.totalRevenue ?? 0));
    const worst = bad.slice().sort((a, b) => (b.jobCosting!.totalCost! - b.jobCosting!.totalRevenue!) - (a.jobCosting!.totalCost! - a.jobCosting!.totalRevenue!))[0];
    if (bad.length >= 3) gm.needs = `needs correct Jobber line-item costs: ${bad.length} of ${costed.length} costed jobs show cost over 2× revenue (worst: #${worst.jobNumber ?? '?'} ${worst.title?.trim() ?? ''}, cost ${usd(worst.jobCosting!.totalCost!)} on ${usd(worst.jobCosting!.totalRevenue!)} revenue), which points to unit costs entered at the wrong scale. Those few jobs swing the average negative, so no margin is shown until they're fixed.`;
    else if (costed.length < 10 || share < 0.5) gm.needs = `needs job costs: only ${costed.length} of ${withRev.length} completed jobs have a cost in Jobber (line-item costs, timesheets or expenses), so a margin would be overstated`;
    else {
      const agg = (js: CostJob[]) => { const rev = js.reduce((s, j) => s + (j.jobCosting?.totalRevenue ?? 0), 0); const cost = js.reduce((s, j) => s + (j.jobCosting?.totalCost ?? 0), 0); return { n: js.length, per: js.length ? (rev - cost) / js.length : 0, m: rev > 0 ? (rev - cost) / rev : 0 }; };
      const a = agg(costed); const p = agg(costed.filter((j) => cat2(j.title) === 'pump')); const d = agg(costed.filter((j) => cat2(j.title) === 'drilling'));
      gm.value = `${usd(a.per)} · ${pct(a.m)}`;
      gm.rows = [
        { label: 'Pump & service', value: p.n ? `${usd(p.per)} · ${pct(p.m)}` : NA, note: `${p.n} jobs` },
        { label: 'Drilling', value: d.n ? `${usd(d.per)} · ${pct(d.m)}` : NA, note: `${d.n} jobs` },
      ];
      gm.measures += ' Only jobs with a cost entered are included.';
    }
  }
  cards.push(gm);

  // 4) First-time fix rate
  cards.push({
    id: 'ftf', title: 'First-time fix rate', value: NA,
    measures: 'Share of service jobs fixed on the first visit with no callback for the same problem.',
    source: 'Would come from Jobber jobs/visits.', range: '—',
    needs: 'needs callbacks tagged in Jobber (e.g. a "Callback" / "Warranty" job type or tag). A return job for the same client is usually planned follow-on work (service call → booster install), so it can\'t be counted as a failed fix without that tag.',
  });

  // 5) Technician utilization
  const timeRange = `${md(ptDateKey(input.timeFrom))} – ${md(today)} (timesheet start)`;
  const te = input.time.rows;
  const ut: MetricCard = { id: 'util', title: 'Technician utilization', value: NA, measures: 'Clocked hours on a job ÷ all clocked hours (job + general/travel/shop time). Hours on internal/training/test jobs are excluded.', source: 'Jobber timesheets.', range: timeRange };
  if (!te) ut.needs = /permission/i.test(input.time.error ?? '') ? 'needs timesheet access: the SCWS Jobber app isn\'t allowed to read timesheets (Jobber says "hidden due to permissions"). Add the Timesheets read scope to the app and re-authorize, and crews need to clock in/out in Jobber. Paid hours per tech are also needed for true utilization.' : `needs Jobber timesheets (query failed: ${input.time.error ?? 'unknown'})`;
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
