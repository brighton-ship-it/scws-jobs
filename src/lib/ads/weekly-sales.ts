/** Weekly sales rollup for the ops call dashboard (pure; Jobber loaders live in weekly-sales-data.ts). */
import { ptDateKey, ptStartOfDay, ptWeekStart, DASH_FLOOR_ISO } from './call-dashboard.ts';
import { invoicePretaxUsd, isIssuedInvoice, type InvoiceAmountInput } from './invoice-value.ts';
import { workCategory, WORK_CATEGORIES, WORK_CATEGORY_RULE, type WorkCategory } from './work-category.ts';

export const WEEKLY_WEEKS = 9; // current week-to-date + previous 8

export interface WeeklyInvoice extends InvoiceAmountInput {
  amounts?: { subtotal?: number | null; total?: number | null; taxAmount?: number | null; paymentsTotal?: number | null } | null;
  jobs?: { nodes?: Array<{ title?: string | null }> | null } | null;
  client?: { id?: string | null; createdAt?: string | null; phones?: Array<{ number?: string | null }> | null; jobs?: { nodes?: Array<{ createdAt?: string | null }> | null } | null } | null;
}
export interface WeeklyQuote { title?: string | null; quoteStatus?: string | null; sentAt?: string | null; /** Jobber: when the quote entered its current status (= approval time for approved/converted quotes) */ transitionedAt?: string | null; amounts?: { subtotal?: number | null; total?: number | null } | null }
export interface WeeklyPayment { id?: string | null; amount?: number | null; entryDate?: string | null; adjustmentType?: string | null }
export interface WeeklyJob { title?: string | null; createdAt?: string | null; completedAt?: string | null }

export interface WeekRow {
  weekStart: string; // YYYY-MM-DD Monday PT
  weekEnd: string;   // YYYY-MM-DD Sunday PT (or today for the current week)
  label: string;     // "Oct 5–Oct 10"
  current: boolean;
  invoiced: number | null;
  paid: number | null;
  /** Cash actually received that week by payment date (payments + deposits − refunds/failed ACH). */
  cash: number | null;
  cashCount: number | null;
  invoiceCount: number | null;
  /** Issued invoices with $0 pre-tax value (included in invoiceCount). */
  zeroInvoices?: number;
  jobsBooked: number | null;
  jobsCompleted: number | null;
  quotesSent: number | null;
  quotesSentValue: number | null;
  quotesApproved: number | null;
  quotesApprovedValue: number | null;
  calls: number;
  bookedCalls: number | null;
  closingRate: number | null;
}
export interface CategoryRow {
  quotesSent: number; quotesSentValue: number; quotesApproved: number; quotesApprovedValue: number;
  invoiced: number; invoiceCount: number; jobsBooked: number;
}
export interface AdClosing { calls: number; booked: number; closingRate: number | null }
/** Headline totals over the dashboard's selected date range (same definitions as a week row). */
export interface RangeTotals extends Omit<WeekRow, 'weekStart' | 'weekEnd' | 'current'> {
  range: string;      // '7' | '30' | '90' | 'since'
  startKey: string;   // YYYY-MM-DD PT (inclusive)
  endKey: string;     // YYYY-MM-DD PT (inclusive, today)
  title: string;      // "Last 30 days: Sep 13–Oct 12"
  /** Drilling vs pump/service vs service-call split of quotes, invoices and jobs (see WORK_CATEGORY_RULE). */
  byCategory?: Record<WorkCategory, CategoryRow> | null;
  /** Closing rate by ad campaign type (Google Ads drilling vs pump campaigns). */
  closingByAd?: { pump: AdClosing; drilling: AdClosing } | null;
}
export interface WeeklySales {
  weeks: WeekRow[]; // oldest -> newest
  /** Totals for the selected range; absent when the caller did not pass one. */
  totals?: RangeTotals | null;
  /** Same split for the last full Mon–Sun week. */
  lastWeekByCategory?: Record<WorkCategory, CategoryRow> | null;
  sources: string[];
  gaps: string[];
}

export const isApprovedStatus = (st: string | null | undefined) => ['approved', 'converted'].includes((st || '').toLowerCase());
const round = (n: number) => Math.round(n * 100) / 100;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (key: string) => { const [, m, d] = key.split('-').map(Number); return `${MON[m - 1]} ${d}`; };

/** PT date key for a Jobber timestamp; bare YYYY-MM-DD dates are used as-is. */
export function jobberDateKey(v: string | null | undefined): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? ptDateKey(new Date(t)) : null;
}

export function weekBounds(now: Date, weeks = WEEKLY_WEEKS): Array<{ start: Date; startKey: string; endKey: string; current: boolean }> {
  const cur = ptWeekStart(now);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = ptStartOfDay(cur, -7 * i);
    const startKey = ptDateKey(start);
    const current = i === 0;
    const endKey = current ? ptDateKey(now) : ptDateKey(ptStartOfDay(start, 6));
    out.push({ start, startKey, endKey, current });
  }
  return out;
}

export interface WeeklyInput {
  now?: Date;
  invoices: WeeklyInvoice[] | null;
  quotes: WeeklyQuote[] | null;
  jobsCreated: WeeklyJob[] | null;
  jobsCompleted: WeeklyJob[] | null;
  /** Jobber payment records by entry date; omit/null = unavailable */
  payments?: WeeklyPayment[] | null;
  /** all inbound calls (started_at ISO) */
  callTimes: string[];
  /** booked-call conversion timestamps (new-customer bookings credited to a call) */
  bookedAt: string[];
  /** Calls / credited bookings tagged with the Google Ads campaign type (null = not an ad call). */
  adCalls?: Array<{ at: string; cat: 'pump' | 'drilling' | null }>;
  adBooked?: Array<{ at: string; cat: 'pump' | 'drilling' | null }>;
  /** Selected dashboard range for the headline totals (inclusive PT date keys). */
  range?: { range: string; startKey: string; endKey: string; name: string } | null;
}

type Row = Pick<WeekRow, 'zeroInvoices' | 'invoiced' | 'paid' | 'cash' | 'cashCount' | 'invoiceCount' | 'jobsBooked' | 'jobsCompleted' | 'quotesSent' | 'quotesSentValue' | 'quotesApproved' | 'quotesApprovedValue' | 'calls' | 'bookedCalls' | 'closingRate'>;
const emptyRow = (input: WeeklyInput): Row => ({
  invoiced: input.invoices ? 0 : null, paid: input.invoices ? 0 : null, cash: input.payments ? 0 : null, cashCount: input.payments ? 0 : null, invoiceCount: input.invoices ? 0 : null,
  jobsBooked: input.jobsCreated ? 0 : null, jobsCompleted: input.jobsCompleted ? 0 : null,
  quotesSent: input.quotes ? 0 : null, quotesSentValue: input.quotes ? 0 : null,
  quotesApproved: input.quotes ? 0 : null, quotesApprovedValue: input.quotes ? 0 : null,
  calls: 0, bookedCalls: 0, closingRate: null,
});

/** Adds every record into the row returned by `at(dateKey)` (undefined = outside any bucket). */
function accumulate(input: WeeklyInput, at: (key: string | null) => Row | undefined, floorKey: string) {
  for (const inv of input.invoices ?? []) {
    const w = at(jobberDateKey(inv.issuedDate));
    const pre = invoicePretaxUsd(inv);
    if (!w || !isIssuedInvoice(inv)) continue;
    w.invoiceCount = (w.invoiceCount ?? 0) + 1; // every issued invoice, incl. $0 ones (matches Jobber's count)
    if (!pre) { w.zeroInvoices = (w.zeroInvoices ?? 0) + 1; continue; }
    w.invoiced = round((w.invoiced ?? 0) + pre);
    const total = inv.amounts?.total, pay = inv.amounts?.paymentsTotal;
    if (typeof total === 'number' && total > 0 && typeof pay === 'number' && pay > 0) {
      w.paid = round((w.paid ?? 0) + Math.min(pay, total) * (pre / total));
    }
  }
  for (const p of input.payments ?? []) {
    const w = at(jobberDateKey(p.entryDate));
    const amt = p.amount;
    if (!w || typeof amt !== 'number' || !Number.isFinite(amt)) continue;
    const kind = (p.adjustmentType || '').toUpperCase();
    if (kind === 'PAYMENT' || kind === 'DEPOSIT') w.cash = round((w.cash ?? 0) + amt);
    else if (kind === 'REFUND' || kind === 'FAILED_ACH_PAYMENT') w.cash = round((w.cash ?? 0) - Math.abs(amt));
    else continue;
    w.cashCount = (w.cashCount ?? 0) + 1;
  }
  for (const q of input.quotes ?? []) {
    const val = q.amounts?.subtotal ?? q.amounts?.total ?? 0;
    const sent = at(jobberDateKey(q.sentAt));
    if (sent) {
      sent.quotesSent = (sent.quotesSent ?? 0) + 1;
      sent.quotesSentValue = round((sent.quotesSentValue ?? 0) + val);
    }
    // Approved is bucketed by APPROVAL date (transitionedAt), independent of when the quote was sent.
    // Quotes never sent to the customer (Jobber auto-quotes converted straight into a job) are not approvals.
    if (isApprovedStatus(q.quoteStatus) && q.sentAt) {
      const appr = at(jobberDateKey(q.transitionedAt));
      if (appr) {
        appr.quotesApproved = (appr.quotesApproved ?? 0) + 1;
        appr.quotesApprovedValue = round((appr.quotesApprovedValue ?? 0) + val);
      }
    }
  }
  for (const j of input.jobsCreated ?? []) { const w = at(jobberDateKey(j.createdAt)); if (w) w.jobsBooked = (w.jobsBooked ?? 0) + 1; }
  for (const j of input.jobsCompleted ?? []) { const w = at(jobberDateKey(j.completedAt)); if (w) w.jobsCompleted = (w.jobsCompleted ?? 0) + 1; }
  // Closing rate only counts calls/bookings since the tracking floor (booking attribution starts then).
  for (const t of input.callTimes) { const k = jobberDateKey(t); const w = at(k); if (w && k! >= floorKey) w.calls += 1; }
  for (const t of input.bookedAt) { const k = jobberDateKey(t); const w = at(k); if (w && k! >= floorKey) w.bookedCalls = (w.bookedCalls ?? 0) + 1; }
}

const emptyCat = (): CategoryRow => ({ quotesSent: 0, quotesSentValue: 0, quotesApproved: 0, quotesApprovedValue: 0, invoiced: 0, invoiceCount: 0, jobsBooked: 0 });
export const invoiceTitle = (inv: WeeklyInvoice) => inv.jobs?.nodes?.find((j) => j?.title)?.title ?? null;

/** Drilling / pump / service-call split over inclusive PT date keys. Same definitions as the headline row. */
export function categoryTotals(input: WeeklyInput, startKey: string, endKey: string): Record<WorkCategory, CategoryRow> | null {
  if (!input.quotes && !input.invoices && !input.jobsCreated) return null;
  const out = Object.fromEntries(WORK_CATEGORIES.map((c) => [c, emptyCat()])) as Record<WorkCategory, CategoryRow>;
  const inR = (k: string | null) => k != null && k >= startKey && k <= endKey;
  for (const q of input.quotes ?? []) {
    const r = out[workCategory(q.title)];
    const val = q.amounts?.subtotal ?? q.amounts?.total ?? 0;
    if (inR(jobberDateKey(q.sentAt))) { r.quotesSent += 1; r.quotesSentValue = round(r.quotesSentValue + val); }
    if (isApprovedStatus(q.quoteStatus) && q.sentAt && inR(jobberDateKey(q.transitionedAt))) { r.quotesApproved += 1; r.quotesApprovedValue = round(r.quotesApprovedValue + val); }
  }
  for (const inv of input.invoices ?? []) {
    const pre = invoicePretaxUsd(inv);
    if (!pre || !inR(jobberDateKey(inv.issuedDate))) continue;
    const r = out[workCategory(invoiceTitle(inv))];
    r.invoiced = round(r.invoiced + pre); r.invoiceCount += 1;
  }
  for (const j of input.jobsCreated ?? []) if (inR(jobberDateKey(j.createdAt))) out[workCategory(j.title)].jobsBooked += 1;
  return out;
}

function adClosing(input: WeeklyInput, startKey: string, endKey: string, floorKey: string) {
  if (!input.adCalls || !input.adBooked) return null;
  const lo = startKey > floorKey ? startKey : floorKey;
  const inR = (t: string) => { const k = jobberDateKey(t); return k != null && k >= lo && k <= endKey; };
  const mk = (cat: 'pump' | 'drilling'): AdClosing => {
    const calls = input.adCalls!.filter((c) => c.cat === cat && inR(c.at)).length;
    const booked = input.adBooked!.filter((c) => c.cat === cat && inR(c.at)).length;
    return { calls, booked, closingRate: calls > 0 ? Math.min(1, booked / calls) : null };
  };
  return { pump: mk('pump'), drilling: mk('drilling') };
}

const RANGE_NAMES: Record<string, string> = { '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days', since: 'Since Sep 18' };
export const rangeTitle = (range: string, startKey: string, endKey: string) => `${RANGE_NAMES[range] ?? 'Selected range'}: ${md(startKey)}–${md(endKey)}`;

/** Oldest PT date key the loaders must cover: the 9-week chart window or the selected range, whichever is earlier. */
export function salesWindowStart(now: Date, rangeStart: Date): Date {
  const wk = weekBounds(now)[0].start;
  return rangeStart.getTime() < wk.getTime() ? ptStartOfDay(rangeStart, 0) : wk;
}

export function buildWeeklySales(input: WeeklyInput): WeeklySales {
  const now = input.now ?? new Date();
  const bounds = weekBounds(now);
  const idx = new Map<string, number>();
  const weeks: WeekRow[] = bounds.map((b, i) => {
    for (let d = 0; d < 7; d++) idx.set(ptDateKey(ptStartOfDay(b.start, d)), i);
    return { weekStart: b.startKey, weekEnd: b.endKey, label: `${md(b.startKey)}–${md(b.endKey)}`, current: b.current, ...emptyRow(input) };
  });
  const at = (key: string | null) => (key != null && idx.has(key) ? weeks[idx.get(key)!] : undefined);
  const floorKey = ptDateKey(new Date(DASH_FLOOR_ISO));
  accumulate(input, at, floorKey);
  let totals: RangeTotals | null = null;
  if (input.range) {
    const { range, startKey, endKey } = input.range;
    const row = emptyRow(input);
    accumulate(input, (k) => (k != null && k >= startKey && k <= endKey ? row : undefined), floorKey);
    if (endKey < floorKey) { row.bookedCalls = null; row.calls = 0; }
    row.closingRate = row.calls > 0 ? Math.min(1, (row.bookedCalls ?? 0) / row.calls) : null;
    totals = {
      ...row, range, startKey, endKey, label: `${md(startKey)}–${md(endKey)}`, title: rangeTitle(range, startKey, endKey),
      byCategory: categoryTotals(input, startKey, endKey), closingByAd: adClosing(input, startKey, endKey, floorKey),
    };
  }
  for (const w of weeks) {
    if (w.weekEnd < floorKey) { w.bookedCalls = null; w.closingRate = null; w.calls = 0; continue; }
    w.closingRate = w.calls > 0 ? Math.min(1, (w.bookedCalls ?? 0) / w.calls) : null;
  }

  const gaps: string[] = [];
  if (!input.invoices) gaps.push('Weekly invoiced/paid unavailable (Jobber invoices query failed).');
  if (input.payments && (input.payments as { truncated?: boolean }).truncated) gaps.push('Weekly cash collected is incomplete: Jobber payment history hit the page cap, so the oldest weeks may be low.');
  if (!input.payments) gaps.push('Weekly cash collected unavailable (Jobber payments query failed).');
  if (input.quotes && (input.quotes as { truncated?: boolean }).truncated) gaps.push('Weekly quotes may be incomplete: Jobber quote history hit the page cap.');
  if (!input.quotes) gaps.push('Weekly quotes unavailable (Jobber quotes query failed).');
  if (!input.jobsCreated) gaps.push('Weekly jobs booked unavailable (Jobber jobs query failed).');
  if (!input.jobsCompleted) gaps.push('Weekly jobs completed unavailable (Jobber jobs query failed).');
  const lw = weeks.length >= 2 ? weeks[weeks.length - 2] : null;
  return {
    weeks, gaps, totals,
    lastWeekByCategory: lw ? categoryTotals(input, lw.weekStart, lw.weekEnd) : null,
    sources: [
      'Invoiced = pre-tax Jobber invoices by issue date (drafts/void excluded). Paid = payments received to date on those invoices (pre-tax share), so it follows the invoice week, not the day the money arrived.',
      'Cash collected = Jobber payment records by the date the payment was received (payments and deposits, less refunds and failed ACH), whichever week the invoice was issued.',
      'Jobs booked = Jobber jobs created that week; completed = jobs with a completion date that week.',
      'Quotes sent = Jobber quotes by sent date. Quotes approved = quotes that were sent to the customer and are now approved/converted, counted in the week they were approved (Jobber status-change time). Quotes Jobber converted into a job without ever sending (auto-created service-call quotes) are not counted as approvals.',
      WORK_CATEGORY_RULE,
      'Quote close rate = quotes approved ÷ quotes sent in the range, by count (approved counted by approval date, sent by sent date). Call to booking (real leads) = new-customer bookings ÷ real new leads in the range: Google Ads + Mike calls since Sep 18, one lead per caller (dated by their first call), excluding spam/robocalls/solicitors/vendors, hang-ups and short calls never reached, repeat calls, missed calls later reached, existing customers (Jobber job before their first call) and staff numbers. Any caller with a new booking always counts as a lead. New customer = no Jobber job before their first call.',
      `Closing rate = new-customer bookings credited to a call (same bookings as the Conversion funnel "Booked") ÷ real new leads, since ${md(floorKey)} (tracking start). Drilling vs pump: a lead's type is its booking's campaign, else its first Google Ads call's campaign; Mike-only leads count in the total only. Weeks are Mon–Sun, Pacific. Headline tiles total the selected date range (Pacific days, today inclusive); bar charts stay weekly.`,
    ],
  };
}
