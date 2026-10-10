/** Weekly sales rollup for the ops call dashboard (pure; Jobber loaders live in weekly-sales-data.ts). */
import { ptDateKey, ptStartOfDay, ptWeekStart, DASH_FLOOR_ISO } from './call-dashboard.ts';
import { invoicePretaxUsd, type InvoiceAmountInput } from './invoice-value.ts';

export const WEEKLY_WEEKS = 9; // current week-to-date + previous 8

export interface WeeklyInvoice extends InvoiceAmountInput {
  amounts?: { subtotal?: number | null; total?: number | null; taxAmount?: number | null; paymentsTotal?: number | null } | null;
}
export interface WeeklyQuote { quoteStatus?: string | null; sentAt?: string | null; /** Jobber: when the quote entered its current status (= approval time for approved/converted quotes) */ transitionedAt?: string | null; amounts?: { subtotal?: number | null; total?: number | null } | null }
export interface WeeklyPayment { id?: string | null; amount?: number | null; entryDate?: string | null; adjustmentType?: string | null }
export interface WeeklyJob { createdAt?: string | null; completedAt?: string | null }

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
export interface WeeklySales {
  weeks: WeekRow[]; // oldest -> newest
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
}

export function buildWeeklySales(input: WeeklyInput): WeeklySales {
  const now = input.now ?? new Date();
  const bounds = weekBounds(now);
  const idx = new Map<string, number>();
  const weeks: WeekRow[] = bounds.map((b, i) => {
    for (let d = 0; d < 7; d++) idx.set(ptDateKey(ptStartOfDay(b.start, d)), i);
    return {
      weekStart: b.startKey, weekEnd: b.endKey, label: `${md(b.startKey)}–${md(b.endKey)}`, current: b.current,
      invoiced: input.invoices ? 0 : null, paid: input.invoices ? 0 : null, cash: input.payments ? 0 : null, cashCount: input.payments ? 0 : null, invoiceCount: input.invoices ? 0 : null,
      jobsBooked: input.jobsCreated ? 0 : null, jobsCompleted: input.jobsCompleted ? 0 : null,
      quotesSent: input.quotes ? 0 : null, quotesSentValue: input.quotes ? 0 : null,
      quotesApproved: input.quotes ? 0 : null, quotesApprovedValue: input.quotes ? 0 : null,
      calls: 0, bookedCalls: 0, closingRate: null,
    };
  });
  const at = (key: string | null) => (key != null && idx.has(key) ? weeks[idx.get(key)!] : undefined);

  for (const inv of input.invoices ?? []) {
    const w = at(jobberDateKey(inv.issuedDate));
    const pre = invoicePretaxUsd(inv);
    if (!w || !pre) continue;
    w.invoiced = round((w.invoiced ?? 0) + pre);
    w.invoiceCount = (w.invoiceCount ?? 0) + 1;
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
    // Approved is bucketed by APPROVAL date (transitionedAt), independent of the week the quote was sent.
    if (isApprovedStatus(q.quoteStatus)) {
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
  const floorKey = ptDateKey(new Date(DASH_FLOOR_ISO));
  for (const t of input.callTimes) {
    const k = jobberDateKey(t);
    const w = at(k);
    if (w && k! >= floorKey) w.calls += 1;
  }
  for (const t of input.bookedAt) {
    const k = jobberDateKey(t);
    const w = at(k);
    if (w && k! >= floorKey) w.bookedCalls = (w.bookedCalls ?? 0) + 1;
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
  return {
    weeks, gaps,
    sources: [
      'Invoiced = pre-tax Jobber invoices by issue date (drafts/void excluded). Paid = payments received to date on those invoices (pre-tax share), so it follows the invoice week, not the day the money arrived.',
      'Cash collected = Jobber payment records by the date the payment was received (payments and deposits, less refunds and failed ACH), whichever week the invoice was issued.',
      'Jobs booked = Jobber jobs created that week; completed = jobs with a completion date that week.',
      'Quotes sent = Jobber quotes by sent date. Quotes approved = quotes now approved/converted, counted in the week they were approved (Jobber status-change time), whenever they were sent.',
      `Closing rate = new-customer bookings credited to a call ÷ all calls, weeks since ${md(floorKey)} (tracking start). Weeks are Mon–Sun, Pacific.`,
    ],
  };
}
