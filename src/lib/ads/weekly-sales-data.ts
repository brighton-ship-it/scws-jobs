/** Jobber loaders for the weekly sales strip. Each loader fails independently (null) and is cached 10 min. */
import { assertNoJobberErrors, jobberGraphql, type JobberGraphqlResult } from '../jobber/client.ts';
import { mirrorInvoices, mirrorQuotes, mirrorJobs, mirrorPayments } from '../jobber-mirror/read.ts';
import type { WeeklyInvoice, WeeklyQuote, WeeklyJob, WeeklyPayment } from './weekly-sales.ts';

const TTL_MS = 10 * 60_000;
const MAX_PAGES = 20;
/** Payment records include one INVOICE-type row per invoice, so ~100/week: 9 weeks needs ~20 pages; newest come first. */
const PAYMENT_MAX_PAGES = 60; // up to 90-day range
/** ~125 days of created quotes (9 weeks + 60d slack) at ~75/week needs well over 12 pages. */
const QUOTE_MAX_PAGES = 45; // up to 90-day range + 60d slack
const cache = new Map<string, { at: number; rows: unknown[] | null }>();

async function paged<T>(key: string, query: string, field: string, variables: Record<string, unknown>, maxPages = MAX_PAGES): Promise<T[] | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows as T[] | null;
  try {
    const rows: T[] = [];
    let after: string | null = null;
    let capped = false;
    for (let page = 0; page < maxPages; page++) {
      let res: JobberGraphqlResult | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          res = await jobberGraphql(query, { ...variables, first: 50, after });
          assertNoJobberErrors(res, `weekly ${field}`);
          break;
        } catch (e) {
          // Jobber rate-limits by query cost; the main page and TV load together, so back off and retry.
          if (attempt === 3 || !/throttl|rate|cost|429/i.test(e instanceof Error ? e.message : '')) throw e;
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      if (!res) throw new Error(`weekly ${field}: no response`);
      const conn: any = res.data?.[field];
      rows.push(...((conn?.nodes ?? []) as T[]));
      if (!conn?.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor ?? null;
      if (page === maxPages - 1) capped = true;
    }
    if (capped) { (rows as any).truncated = true; console.warn(`[weekly-sales] ${field} hit page cap ${maxPages}`); }
    cache.set(key, { at: Date.now(), rows });
    return rows;
  } catch (error) {
    console.warn(`[weekly-sales] ${field} failed:`, error instanceof Error ? error.message : 'error');
    return (cache.get(key)?.rows as T[] | undefined) ?? null;
  }
}

const INVOICES = `
  query WeeklyInvoices($first: Int!, $after: String, $filter: InvoiceFilterAttributes) {
    invoices(first: $first, after: $after, filter: $filter) {
      nodes { id invoiceStatus issuedDate amounts { subtotal total taxAmount paymentsTotal discountAmount } jobs(first: 1) { nodes { title } } client { id createdAt phones { number } jobs(first: 10) { nodes { createdAt } } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
const QUOTES = `
  query WeeklyQuotes($first: Int!, $after: String, $filter: QuoteFilterAttributes) {
    quotes(first: $first, after: $after, filter: $filter) {
      nodes { id title quoteStatus sentAt transitionedAt amounts { subtotal total } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
const PAYMENTS = `
  query WeeklyPayments($first: Int!, $after: String, $filter: PaymentRecordFilterAttributes) {
    paymentRecords(first: $first, after: $after, filter: $filter) {
      nodes { id amount entryDate adjustmentType }
      pageInfo { hasNextPage endCursor }
    }
  }`;
const JOBS = `
  query WeeklyJobs($first: Int!, $after: String, $filter: JobFilterAttributes) {
    jobs(first: $first, after: $after, filter: $filter) {
      nodes { id title createdAt completedAt }
      pageInfo { hasNextPage endCursor }
    }
  }`;

/** Supabase mirror first (fast); live Jobber only when the mirror is not ready. */
const mirrorFirst = async <T>(m: () => Promise<any[] | null>, live: () => Promise<T[] | null>): Promise<T[] | null> => {
  try { const r = await m(); if (r) return r as T[]; } catch (e) { console.warn('[weekly-sales] mirror read failed:', e instanceof Error ? e.message : e); }
  return live();
};
export const loadWeeklyInvoices = (after: string, before: string) => mirrorFirst<WeeklyInvoice>(() => mirrorInvoices(after, before), () =>
  paged<WeeklyInvoice>(`inv3|${after}`, INVOICES, 'invoices', { filter: { issuedDate: { after, before } } }));
/** Quotes sent in the window may have been created earlier, so filter by created date with slack. */
export const loadWeeklyQuotes = (createdAfter: string, createdBefore: string) => mirrorFirst<WeeklyQuote>(() => mirrorQuotes(createdAfter, createdBefore), () =>
  paged<WeeklyQuote>(`q2|${createdAfter}`, QUOTES, 'quotes', { filter: { createdAt: { after: createdAfter, before: createdBefore } } }, QUOTE_MAX_PAGES));
/** Quotes for sent/approved counts in a window: a quote can be approved months after it was created (e.g. #2235 created
 *  Feb 2026, approved Oct 5), so the mirror path reads every mirrored quote; the live fallback keeps the created-date slack. */
export const loadWindowQuotes = (createdAfter: string, createdBefore: string) => mirrorFirst<WeeklyQuote>(() => mirrorQuotes('2025-01-01T00:00:00Z', createdBefore), () =>
  paged<WeeklyQuote>(`q2|${createdAfter}`, QUOTES, 'quotes', { filter: { createdAt: { after: createdAfter, before: createdBefore } } }, QUOTE_MAX_PAGES));
export const loadWeeklyJobsCreated = (after: string, before: string) => mirrorFirst<WeeklyJob>(() => mirrorJobs('created_at', after, before), () =>
  paged<WeeklyJob>(`jc2|${after}`, JOBS, 'jobs', { filter: { createdAt: { after, before } } }));
export const loadWeeklyJobsCompleted = (after: string, before: string) => mirrorFirst<WeeklyJob>(() => mirrorJobs('completed_at', after, before), () =>
  paged<WeeklyJob>(`jd|${after}`, JOBS, 'jobs', { filter: { completedAt: { after, before } } }));
/** Payment records by payment received (entry) date, regardless of which week the invoice was issued. */
export const loadWeeklyPayments = (after: string, before: string) => mirrorFirst<WeeklyPayment>(() => mirrorPayments(after, before), () =>
  paged<WeeklyPayment>(`pay|${after}`, PAYMENTS, 'paymentRecords', { filter: { entryDate: { after, before } } }, PAYMENT_MAX_PAGES));
