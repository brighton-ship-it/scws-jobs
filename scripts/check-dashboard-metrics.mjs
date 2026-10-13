#!/usr/bin/env node
// Consistency check for the /ops dashboards (read-only). Usage: OPS_KEY=... node scripts/check-dashboard-metrics.mjs [baseUrl]
// Fails (exit 1) when numbers on the same page disagree with each other.
const base = process.argv[2] || 'https://scws-jobs.vercel.app';
const key = process.env.OPS_KEY;
if (!key) { console.error('set OPS_KEY'); process.exit(2); }
const get = async (p) => { const r = await fetch(`${base}${p}${p.includes('?') ? '&' : '?'}key=${key}`); if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json(); };
const fails = []; const ok = [];
const eq = (name, a, b, tol = 0.011) => ((a == null || b == null || Math.abs(a - b) > tol) ? fails : ok).push(`${name}: ${a} vs ${b}`);
const sum = (xs) => Math.round(xs.reduce((s, x) => s + (x ?? 0), 0) * 100) / 100;
for (const range of ['since', 'month', '7', '30', '90']) {
  const d = await get(`/api/ops/call-dashboard?range=${range}`);
  const t = d.weekly?.totals, c = t?.byCategory;
  if (!t || !c) { fails.push(`${range}: weekly totals missing`); continue; }
  const C = ['drilling', 'pump', 'service_call'];
  eq(`${range} invoiced = sum of type cards`, t.invoiced, sum(C.map((k) => c[k].invoiced)));
  eq(`${range} non-$0 invoices = sum of type cards`, t.invoiceCount - (t.zeroInvoices ?? 0), sum(C.map((k) => c[k].invoiceCount)), 0);
  eq(`${range} jobs booked = type cards + site walks`, t.jobsBooked, sum(C.map((k) => c[k].jobsBooked + (c[k].siteVisits ?? 0))), 0);
  eq(`${range} quotes sent = drilling + pump`, t.quotesSent, c.drilling.quotesSent + c.pump.quotesSent, 0);
  eq(`${range} quotes approved = drilling + pump`, t.quotesApproved, c.drilling.quotesApproved + c.pump.quotesApproved, 0);
  const f = d.funnel, rl = d.realLeads;
  eq(`${range} booked: funnel = campaign rows`, f.booked, sum((d.byCampaign ?? []).map((r) => r.booked)), 0);
  eq(`${range} booked: funnel = Sales call-to-booking numerator`, f.booked, t.bookedCalls, 0);
  eq(`${range} real leads = Sales denominator`, rl.leads, t.calls, 0);
  eq(`${range} real leads = calls − exclusions`, rl.leads, rl.calls - sum(rl.excluded.map((e) => e.count)), 0);
  const r = d.roas;
  eq(`${range} ROAS new pump+drilling = total`, r.newOnly.invoiced, sum([r.byCategory.pump.newOnly.invoiced, r.byCategory.drilling.newOnly.invoiced]));
  eq(`${range} ROAS spend = Google Ads spend total`, r.spend, d.totals.spend);
  // 7/30/90-day campaign rows cover the whole range; ROAS spend is floored at Sep 18 (tracking start).
  if (range === 'since' || range === 'month') eq(`${range} campaign spend = ROAS spend`, sum((d.byCampaign ?? []).map((x) => x.spend)), r.spend);
  // Campaign $/call uses ad calls since the spend window start (Sep 18 floor), so derive each campaign's call count from it.
  // Campaign $/call uses ad calls since the spend window start (Sep 18 floor).
  const adCalls = (d.byCampaign ?? []).filter((x) => x.spend != null && x.costPerCall).reduce((a, x) => a + Math.round(x.spend / x.costPerCall), 0);
  if (range === 'since' || range === 'month') eq(`${range} cost per ad call = spend ÷ ad calls`, d.totals.costPerCall, Math.round((r.spend / adCalls) * 100) / 100);
}
const since = await get('/api/ops/call-dashboard?range=since');
const m = await get('/api/ops/metrics');
const cac = m.cards.find((x) => x.id === 'cac');
const n = Number((cac?.sub || '').match(/÷ (\d+) new customers/)?.[1]);
eq('CAC new customers (metrics) = ROAS new clients (calls page, since Sep 18)', n, since.roas.newOnly.clients, 0);
console.log(ok.map((x) => `OK   ${x}`).join('\n'));
if (fails.length) { console.log(fails.map((x) => `FAIL ${x}`).join('\n')); process.exit(1); }
console.log('all consistent');
