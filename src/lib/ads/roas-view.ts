/**
 * ROAS for the ops call dashboard, computed straight from Jobber invoices (pure).
 *  - Overall: every non-draft/void invoice issued in the range to a client whose phone called a Google Ads
 *    number BEFORE the invoice was issued (new and repeat customers).
 *  - New customers only: the same invoices, limited to clients created in Jobber no earlier than one day
 *    before their first Google Ads call (i.e. not already a customer when they called).
 * Attribution goes to the campaign of the client's latest ad call before the invoice.
 */
import { adCategory, digits10, ptDateKey, type AdCategory, type RoasSide, type RoasView, type SpendDay } from './call-dashboard.ts';
import { invoicePretaxUsd } from './invoice-value.ts';
import type { WeeklyInvoice } from './weekly-sales.ts';

const round = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400_000;

export interface AdCallLite { started_at: string | null; caller_phone: string | null; campaign_name: string | null }

export function buildRoasView(input: {
  invoices: WeeklyInvoice[] | null;
  adCalls: AdCallLite[];
  spend: SpendDay[] | null;
  start: Date; // range/revenue start (UTC instant of PT midnight)
  now: Date;
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
  const side = (): RoasSide & { _c: Set<string> } => ({ invoiced: 0, paid: 0, invoices: 0, clients: 0, multipleInvoiced: null, multiplePaid: null, _c: new Set() });
  const S = { all: side(), neu: side(), pump: { all: side(), neu: side() }, drilling: { all: side(), neu: side() } };
  const add = (s: ReturnType<typeof side>, pre: number, paid: number, cid: string) => { s.invoiced += pre; s.paid += paid; s.invoices += 1; s._c.add(cid); };
  for (const inv of input.invoices) {
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
    const created = Date.parse(inv.client?.createdAt || '');
    const isNew = Number.isFinite(created) && created >= first - DAY;
    add(S.all, pre, paid, cid); add(S[last.cat].all, pre, paid, cid);
    if (isNew) { add(S.neu, pre, paid, cid); add(S[last.cat].neu, pre, paid, cid); }
  }
  const spendOf = (cat?: AdCategory) => input.spend
    ? round(input.spend.filter((d) => d.date >= a && d.date <= b && (!cat || adCategory(d.campaign) === cat)).reduce((x, d) => x + d.costUsd, 0))
    : null;
  const fin = (s: ReturnType<typeof side>, spend: number | null): RoasSide => ({
    invoiced: round(s.invoiced), paid: round(s.paid), invoices: s.invoices, clients: s._c.size,
    multipleInvoiced: spend && spend > 0 ? round(s.invoiced / spend) : null,
    multiplePaid: spend && spend > 0 ? round(s.paid / spend) : null,
  });
  const spend = spendOf();
  const sp = spendOf('pump'), sd = spendOf('drilling');
  return {
    spend,
    overall: fin(S.all, spend),
    newOnly: fin(S.neu, spend),
    byCategory: {
      pump: { spend: sp, overall: fin(S.pump.all, sp), newOnly: fin(S.pump.neu, sp) },
      drilling: { spend: sd, overall: fin(S.drilling.all, sd), newOnly: fin(S.drilling.neu, sd) },
    },
    method: [
      'ROAS overall = pre-tax Jobber invoices (not draft/void) issued in the range to any client whose phone called a Google Ads number before the invoice, ÷ Google Ads spend for the same Pacific days. Includes repeat customers.',
      'ROAS new customers = the same, limited to clients created in Jobber no earlier than 1 day before their first Google Ads call (not already a customer when they called).',
      'Paid = payments received to date on those invoices (pre-tax share). Credit goes to the campaign of the latest ad call before the invoice. Mike/AI receptionist calls are not ad calls and are excluded.',
    ],
  };
}
