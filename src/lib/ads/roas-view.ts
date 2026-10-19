/**
 * ROAS for the ops call dashboard, computed straight from Jobber invoices (pure).
 *  - Overall: every non-draft/void invoice issued in the range to a client whose phone called a Google Ads
 *    number BEFORE the invoice was issued (new and repeat customers).
 *  - New customers only: the same invoices, limited to clients with no Jobber job created before their first
 *    Google Ads call (not already a customer when they called).
 * Attribution goes to the campaign of the client's latest ad call before the invoice.
 */
import { adCategory, digits10, ptDateKey, type AdCategory, type AdSplit, type AdSplitRow, type AdSplitWindow, type BlendedRoas, type RoasSide, type RoasView, type SpendDay } from './call-dashboard.ts';
import { invoicePretaxUsd } from './invoice-value.ts';
import { jobberDateKey, type WeeklyInvoice } from './weekly-sales.ts';
import { INTERNAL_EXCLUSION_NOTE, isInternalJob } from './internal-job.ts';

const round = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400_000;

export interface RoasDetailRow { invoiceId: string | null; issuedDate: string | null; clientId: string; pretax: number; paid: number; cat: AdCategory; isNew: boolean; firstAdCallAt: string; lastAdCallAt: string; priorJobs: number }

export interface AdCallLite { started_at: string | null; caller_phone: string | null; campaign_name: string | null }

export function buildRoasView(input: {
  invoices: WeeklyInvoice[] | null;
  adCalls: AdCallLite[];
  spend: SpendDay[] | null;
  start: Date; // range/revenue start (UTC instant of PT midnight)
  now: Date;
  /** Optional sink: one row per ad-attributed invoice (debug/verification endpoint). */
  detail?: RoasDetailRow[];
}): RoasView | null {
  if (!input.invoices) return null;
  const byPhone = new Map<string, Array<{ t: number; cat: AdCategory | null }>>();
  for (const c of input.adCalls) {
    const d = digits10(c.caller_phone); const t = Date.parse(c.started_at || '');
    if (!d || !Number.isFinite(t)) continue;
    const cat = adCategory(c.campaign_name);
    if (!cat) continue; // Google Ads calls only
    (byPhone.get(d) ?? byPhone.set(d, []).get(d)!).push({ t, cat });
  }
  byPhone.forEach((l) => l.sort((a, b) => a.t - b.t));
  const a = ptDateKey(input.start), b = ptDateKey(input.now);
  const side = (): RoasSide & { _c: Set<string>; _u: Set<string> } => ({ invoiced: 0, paid: 0, invoices: 0, clients: 0, multipleInvoiced: null, multiplePaid: null, _c: new Set(), _u: new Set() });
  const S = { all: side(), neu: side(), pump: { all: side(), neu: side() }, drilling: { all: side(), neu: side() } };
  const add = (s: ReturnType<typeof side>, pre: number, paid: number, cid: string, unpaid: boolean) => { s.invoiced += pre; s.paid += paid; s.invoices += 1; s._c.add(cid); if (unpaid) s._u.add(cid); };
  for (const inv of input.invoices) {
    if (isInternalJob(inv)) continue;
    const pre = invoicePretaxUsd(inv);
    const issued = Date.parse(inv.issuedDate || '');
    if (!pre || !Number.isFinite(issued)) continue;
    const key = ptDateKey(new Date(issued));
    if (key < a || key > b) continue;
    const phones = (inv.client?.phones ?? []).map((p) => digits10(p?.number)).filter((x): x is string => !!x);
    let last: { t: number; cat: AdCategory | null } | null = null; let first = Infinity;
    for (const p of phones) for (const c of byPhone.get(p) ?? []) {
      first = Math.min(first, c.t);
      // Bare-date invoices: treat as end of that PT day.
      if (c.t <= issued + (/^\d{4}-\d{2}-\d{2}$/.test(inv.issuedDate || '') ? DAY : 0) && (!last || c.t > last.t)) last = c;
    }
    if (!last || !last.cat) continue;
    const total = inv.amounts?.total, pay = inv.amounts?.paymentsTotal;
    const paid = typeof total === 'number' && total > 0 && typeof pay === 'number' && pay > 0 ? Math.min(pay, total) * (pre / total) : 0;
    const cid = inv.client?.id || phones[0];
    // New = no Jobber job for this client created before their first Google Ads call (client record age is ignored:
    // a lead created earlier with no work is still a new customer).
    const jobTimes = (inv.client?.jobs?.nodes ?? []).map((j) => Date.parse(j?.createdAt || '')).filter(Number.isFinite);
    const isNew = inv.client?.jobs ? !jobTimes.some((t) => t < first) : (Number.isFinite(Date.parse(inv.client?.createdAt || '')) && Date.parse(inv.client?.createdAt || '') >= first - DAY);
    const unpaid = !(typeof total === 'number' && typeof pay === 'number' && pay >= total - 0.01);
    input.detail?.push({ invoiceId: inv.id ?? null, issuedDate: inv.issuedDate ?? null, clientId: cid, pretax: pre, paid: round(paid), cat: last.cat, isNew, firstAdCallAt: new Date(first).toISOString(), lastAdCallAt: new Date(last.t).toISOString(), priorJobs: jobTimes.filter((t) => t < first).length });
    add(S.all, pre, paid, cid, unpaid); add(S[last.cat].all, pre, paid, cid, unpaid);
    if (isNew) { add(S.neu, pre, paid, cid, unpaid); add(S[last.cat].neu, pre, paid, cid, unpaid); }
  }
  const spendOf = (cat?: AdCategory) => input.spend
    ? round(input.spend.filter((d) => d.date >= a && d.date <= b && (!cat || adCategory(d.campaign) === cat)).reduce((x, d) => x + d.costUsd, 0))
    : null;
  const fin = (s: ReturnType<typeof side>, spend: number | null): RoasSide => ({
    invoiced: round(s.invoiced), paid: round(s.paid), invoices: s.invoices, clients: s._c.size, paidClients: s._c.size - s._u.size,
    multipleInvoiced: spend && spend > 0 ? round(s.invoiced / spend) : null,
    multiplePaid: spend && spend > 0 ? round(s.paid / spend) : null,
  });
  const spend = spendOf();
  const sp = spendOf('pump'), sd = spendOf('drilling');
  const overall = fin(S.all, spend);
  // Blended ROAS = revenue from every ad-sourced customer (new AND returning) ÷ total ad spend, same window.
  // Not all company revenue: customers who never came in through an ad are excluded.
  const blended: BlendedRoas = { invoiced: overall.invoiced, invoices: overall.invoices, clients: overall.clients, spend, multiple: overall.multipleInvoiced, startKey: a, endKey: b };
  return {
    blended,
    spend,
    overall,
    newOnly: fin(S.neu, spend),
    byCategory: {
      pump: { spend: sp, overall: fin(S.pump.all, sp), newOnly: fin(S.pump.neu, sp) },
      drilling: { spend: sd, overall: fin(S.drilling.all, sd), newOnly: fin(S.drilling.neu, sd) },
    },
    method: [
      'Blended ROAS = pre-tax Jobber invoices (not draft/void) issued in the range to every ad-sourced customer, new and returning, ÷ total ad spend for the same Pacific days. Customers who never came in through an ad are not counted. Ad spend today is Google Ads (the only tracked ad channel).',
      'ROAS overall = pre-tax Jobber invoices (not draft/void) issued in the range to any client whose phone called a Google Ads number before the invoice, ÷ Google Ads spend for the same Pacific days. Includes repeat customers.',
      'ROAS new customers = the same, limited to clients with no Jobber job created before their first Google Ads call (not already a customer when they called; repeat customers such as Cauzza are excluded).',
      'Paid = payments received to date on those invoices (pre-tax share). Credit goes to the campaign of the latest ad call before the invoice. Mike/AI receptionist calls are not ad calls and are excluded.',
      INTERNAL_EXCLUSION_NOTE,
    ],
  };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const mdKey = (k: string) => { const [, m, d] = k.split('-').map(Number); return `${MON[m - 1]} ${d}`; };

/**
 * Pump vs drilling campaign cards, built from the SAME calculation as the ROAS card (buildRoasView):
 * same invoices/attribution, same spend rows, same Pacific-day window. Calls = Google Ads calls in the window;
 * booked = new-customer bookings credited to a call (same set as the funnel).
 */
export function buildSharedAdSplit(input: {
  invoices: WeeklyInvoice[] | null;
  adCalls: AdCallLite[];
  booked: Array<{ at: string; cat: AdCategory | null }>;
  spend: SpendDay[] | null;
  windows: { main: { label: string; start: Date }; week: { label: string; start: Date } };
  now: Date;
}): AdSplit | null {
  const mk = (w: { label: string; start: Date }): AdSplitWindow | null => {
    const v = buildRoasView({ invoices: input.invoices, adCalls: input.adCalls, spend: input.spend, start: w.start, now: input.now });
    if (!v) return null;
    const a = ptDateKey(w.start), b = ptDateKey(input.now), t0 = w.start.getTime();
    const dayKeys: string[] = [];
    for (let d = new Date(`${a}T12:00:00Z`); ptDateKey(d) <= b && dayKeys.length < 400; d = new Date(d.getTime() + 86400_000)) dayKeys.push(d.toISOString().slice(0, 10));
    const rows = (['pump', 'drilling'] as AdCategory[]).map((category): AdSplitRow => {
      const c = v.byCategory[category];
      const sp = input.spend ? input.spend.filter((d) => adCategory(d.campaign) === category && d.date >= a && d.date <= b) : null;
      return {
        category, spend: c.spend, clicks: sp ? sp.reduce((x, d) => x + (d.clicks ?? 0), 0) : null,
        calls: input.adCalls.filter((x) => adCategory(x.campaign_name) === category && Date.parse(x.started_at || '') >= t0).length,
        booked: input.booked.filter((x) => x.cat === category && Date.parse(x.at) >= t0).length,
        invoiced: c.overall.invoiced, multiple: c.overall.multipleInvoiced,
        invoicedNew: c.newOnly.invoiced, multipleNew: c.newOnly.multipleInvoiced,
        paid: c.overall.paid, multiplePaid: c.overall.multiplePaid,
        dailySpend: sp ? dayKeys.map((k) => Math.round(sp.filter((d) => d.date === k).reduce((x, d) => x + d.costUsd, 0) * 100) / 100) : undefined,
      };
    });
    const dates = a === b ? mdKey(a) : `${mdKey(a)}–${mdKey(b)}`;
    const otherBooked = input.booked.filter((x) => !x.cat && Date.parse(x.at) >= t0).length;
    return { label: `${w.label}: ${dates}`, dates, from: w.start.toISOString(), to: input.now.toISOString(), rows, otherBooked };
  };
  const main = mk(input.windows.main), week = mk(input.windows.week);
  return main && week ? { since: main, week } : null;
}
