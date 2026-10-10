/** Jobber loaders for the weekly sales strip. Each loader fails independently (null) and is cached 10 min. */
import { assertNoJobberErrors, jobberGraphql, type JobberGraphqlResult } from '../jobber/client.ts';
import type { WeeklyInvoice, WeeklyQuote, WeeklyJob } from './weekly-sales.ts';

const TTL_MS = 10 * 60_000;
const MAX_PAGES = 12;
const cache = new Map<string, { at: number; rows: unknown[] | null }>();

async function paged<T>(key: string, query: string, field: string, variables: Record<string, unknown>): Promise<T[] | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows as T[] | null;
  try {
    const rows: T[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
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
    }
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
      nodes { id invoiceStatus issuedDate amounts { subtotal total taxAmount paymentsTotal } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
const QUOTES = `
  query WeeklyQuotes($first: Int!, $after: String, $filter: QuoteFilterAttributes) {
    quotes(first: $first, after: $after, filter: $filter) {
      nodes { id quoteStatus sentAt amounts { subtotal total } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
const JOBS = `
  query WeeklyJobs($first: Int!, $after: String, $filter: JobFilterAttributes) {
    jobs(first: $first, after: $after, filter: $filter) {
      nodes { id createdAt completedAt }
      pageInfo { hasNextPage endCursor }
    }
  }`;

export const loadWeeklyInvoices = (after: string, before: string) =>
  paged<WeeklyInvoice>(`inv|${after}`, INVOICES, 'invoices', { filter: { issuedDate: { after, before } } });
/** Quotes sent in the window may have been created earlier, so filter by created date with slack. */
export const loadWeeklyQuotes = (createdAfter: string, createdBefore: string) =>
  paged<WeeklyQuote>(`q|${createdAfter}`, QUOTES, 'quotes', { filter: { createdAt: { after: createdAfter, before: createdBefore } } });
export const loadWeeklyJobsCreated = (after: string, before: string) =>
  paged<WeeklyJob>(`jc|${after}`, JOBS, 'jobs', { filter: { createdAt: { after, before } } });
export const loadWeeklyJobsCompleted = (after: string, before: string) =>
  paged<WeeklyJob>(`jd|${after}`, JOBS, 'jobs', { filter: { completedAt: { after, before } } });
