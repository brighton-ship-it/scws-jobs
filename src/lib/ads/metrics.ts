/** Pure builders for the /ops/metrics page. Never estimates: a metric without honest data returns value null + needs. */
import { invoicePretaxUsd } from './invoice-value.ts';
import { workCategory } from './work-category.ts';
import { ptDateKey, type RoasView } from './call-dashboard.ts';
import type { HistInvoice, CostJob, TimeEntry } from './metrics-data.ts';
import type { WeeklyQuote } from './weekly-sales.ts';

export interface MetricRow { label: string; value: string; note?: string }
export interface MetricCard { id: string; title: string; value: string; sub?: string; rows?: MetricRow[]; measures: string; source: string; range: string; needs?: string }

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

  // 1) LTV
  const ltv = inv ? lifetimeValue(inv) : null;
  cards.push({
    id: 'ltv', title: 'Customer lifetime value',
    value: ltv?.overall != null ? usd(ltv.overall) : NA,
    sub: ltv ? `${ltv.clients.toLocaleString()} customers · ${usd(ltv.revenue)} invoiced` : undefined,
    rows: ltv ? [
      { label: 'Pump & service', value: ltv.pump != null ? usd(ltv.pump) : NA, note: `${ltv.pumpClients} customers` },
      { label: 'Drilling', value: ltv.drilling != null ? usd(ltv.drilling) : NA, note: `${ltv.drillClients} customers` },
    ] : undefined,
    measures: 'Average pre-tax revenue invoiced per customer over the window (actual history, not a projection). Pump/drilling = that customer\'s invoices of that type, by job title.' + trunc,
    source: 'Jobber invoices (not draft/void), pre-tax subtotal, grouped by Jobber client.', range: histRange, needs: histNeeds,
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
    measures: 'Ad spend ÷ new customers acquired. New customer = no Jobber job before their first Google Ads call, and invoiced in the window (credited to the campaign of their last ad call).',
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
    measures: 'Customer lifetime value (card 1) ÷ Google Ads CAC (card 8). Above 3:1 is the usual rule of thumb. Mixes a long LTV window with a short CAC window, so read it as directional.',
    source: 'Cards 1 and 8.', range: `LTV: ${histRange}. CAC: ${input.sinceLabel}.`,
    needs: ltv?.overall == null || cacAll == null ? 'needs both LTV and CAC' : undefined,
  });

  // 3) Gross margin per job
  const costRange = `${md(ptDateKey(input.costFrom))} – ${md(today)} (job completed date)`;
  const cj = input.costs.rows;
  let gm: MetricCard = { id: 'margin', title: 'Gross margin per job', value: NA, measures: 'Average (revenue − cost) per completed job, and margin %, using Jobber job costing (line-item cost + labour from timesheets + expenses).', source: `Jobber job costing.${input.qboConnected ? '' : ' QuickBooks API is not connected to this app, so QuickBooks costs are not used.'}`, range: costRange };
  if (!cj) gm.needs = `needs Jobber job costing (query failed: ${input.costs.error ?? 'unknown'})`;
  else {
    const withRev = cj.filter((j) => (j.jobCosting?.totalRevenue ?? 0) > 0);
    const costed = withRev.filter((j) => (j.jobCosting?.totalCost ?? 0) > 0);
    const share = withRev.length ? costed.length / withRev.length : 0;
    gm.sub = `${costed.length} of ${withRev.length} completed jobs with revenue have any cost entered`;
    if (costed.length < 10 || share < 0.5) gm.needs = `needs job costs: only ${costed.length} of ${withRev.length} completed jobs have a cost in Jobber (line-item costs, timesheets or expenses), so a margin would be overstated`;
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
  const ut: MetricCard = { id: 'util', title: 'Technician utilization', value: NA, measures: 'Clocked hours on a job ÷ all clocked hours (job + general/travel/shop time).', source: 'Jobber timesheets.', range: timeRange };
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
  const qs = input.quotes;
  const qRange = `Quotes created ${md(ptDateKey(input.quotesFrom))} – ${md(today)}`;
  const cy: MetricCard = { id: 'cycle', title: 'Quote-to-close cycle time', value: NA, measures: 'Median days from quote sent to approved (or converted to a job). Jobber only exposes the latest status change, so converted quotes are measured to conversion, which can run a little long.', source: 'Jobber quotes: sentAt → transitionedAt, status approved/converted. Service-call quotes ($200, auto-created) and quotes never marked sent (approved on the spot) are excluded.', range: qRange };
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

  // 7) Repeat purchase rate
  const rp: MetricCard = { id: 'repeat', title: 'Repeat purchase rate', value: NA, measures: 'Share of customers invoiced in the window who came back: invoiced again at least 60 days after an earlier invoice. The 60-day gap keeps a $200 service call plus the repair it led to from counting as a repeat.' + trunc, source: 'Jobber invoices (not draft/void), grouped by client.', range: histRange, needs: histNeeds };
  if (inv) {
    const span = new Map<string, { a: number; b: number }>(); const catBy = { pump: new Set<string>(), drilling: new Set<string>() };
    for (const i of inv) { const t = Date.parse(i.issuedDate || ''); if (!invoicePretaxUsd(i) || !i.client?.id || !Number.isFinite(t)) continue; const x = span.get(i.client.id); span.set(i.client.id, { a: Math.min(x?.a ?? t, t), b: Math.max(x?.b ?? t, t) }); catBy[cat2(i.jobs?.nodes?.[0]?.title)].add(i.client.id); }
    const jobsBy = { get: (id: string) => { const x = span.get(id); return { size: x && x.b - x.a >= 60 * DAY ? 2 : 1 }; }, keys: () => span.keys() };
    const rate = (ids: string[]) => { const rep = ids.filter((id) => (jobsBy.get(id)?.size ?? 0) >= 2).length; return { rep, n: ids.length, v: ids.length ? pct(rep / ids.length) : NA }; };
    const a = rate(Array.from(jobsBy.keys())), p = rate(Array.from(catBy.pump)), d = rate(Array.from(catBy.drilling));
    rp.value = a.v; rp.sub = `${a.rep} of ${a.n} customers`;
    rp.rows = [{ label: 'Pump & service customers', value: p.v, note: `${p.rep} of ${p.n}` }, { label: 'Drilling customers', value: d.v, note: `${d.rep} of ${d.n}` }];
  }
  cards.push(rp);

  // 9) Net revenue retention
  const nowT = input.now.getTime(); const yrAgo = nowT - 365 * DAY; const twoAgo = nowT - 730 * DAY;
  const nr: MetricCard = { id: 'nrr', title: 'Net revenue retention', value: NA, measures: 'Revenue this year from customers who bought last year ÷ what those same customers spent last year. Over 100% = existing customers are spending more.', source: 'Jobber invoices (not draft/void), pre-tax, grouped by client.', range: `Last year: ${md(ptDateKey(new Date(twoAgo)))} – ${md(ptDateKey(new Date(yrAgo)))}; this year: ${md(ptDateKey(new Date(yrAgo)))} – ${md(today)}`, needs: histNeeds };
  if (inv) {
    if (histStart.getTime() > twoAgo + 7 * DAY) nr.needs = `needs 24 months of invoice history: Jobber invoices only go back to ${md(ptDateKey(histStart))}, so last year is only partly in Jobber. Comparing a partial year with a full one would understate retention. Older invoices (QuickBooks / pre-Jobber) would fill it in; this card turns on by itself around Mar 2027.`;
    else {
      const base = new Map<string, { v: number; c: Cat }>(); const cur = new Map<string, number>();
      for (const i of inv) {
        const pre = invoicePretaxUsd(i); const cid = i.client?.id; const t = Date.parse(i.issuedDate || '');
        if (!pre || !cid || !Number.isFinite(t)) continue;
        if (t >= twoAgo && t < yrAgo) { const b = base.get(cid); base.set(cid, { v: (b?.v ?? 0) + pre, c: b?.c === 'drilling' || cat2(i.jobs?.nodes?.[0]?.title) === 'drilling' ? 'drilling' : 'pump' }); }
        else if (t >= yrAgo) cur.set(cid, (cur.get(cid) ?? 0) + pre);
      }
      const calc = (c: Cat | null) => { let b = 0, n = 0, k = 0; base.forEach((x, id) => { if (c && x.c !== c) return; b += x.v; n += cur.get(id) ?? 0; k++; }); return { b, n, k, v: b > 0 ? pct(n / b) : NA }; };
      const a = calc(null), p = calc('pump'), d = calc('drilling');
      if (a.b < 1000) nr.needs = 'needs more Jobber history: almost no invoices in the base year';
      else {
        nr.value = a.v; nr.sub = `${a.k} customers: ${usd(a.b)} last year → ${usd(a.n)} this year`;
        nr.rows = [{ label: 'Pump & service', value: p.v, note: `${usd(p.b)} → ${usd(p.n)}` }, { label: 'Drilling (any drilling job last year)', value: d.v, note: `${usd(d.b)} → ${usd(d.n)}` }];
      }
    }
  }
  cards.push(nr);

  const order = ['ltv', 'ltv-cac', 'margin', 'ftf', 'util', 'cycle', 'repeat', 'cac', 'nrr'];
  return order.map((id) => cards.find((c) => c.id === id)!);
}
