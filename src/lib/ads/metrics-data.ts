/** Jobber loaders for /ops/metrics. Each loader fails independently ({ rows: null, error }) and is cached 30 min. */
import { assertNoJobberErrors, jobberGraphql } from '../jobber/client.ts';

const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; v: Loaded<unknown> }>();
export interface Loaded<T> { rows: T[] | null; error?: string; truncated?: boolean }

async function paged<T>(key: string, query: string, field: string, variables: Record<string, unknown>, maxPages = 40, first = 100): Promise<Loaded<T>> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v as Loaded<T>;
  try {
    const rows: T[] = [];
    let after: string | null = null; let truncated = false;
    for (let page = 0; page < maxPages; page++) {
      let res: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try { res = await jobberGraphql(query, { ...variables, first, after }); assertNoJobberErrors(res, `metrics ${field}`); break; }
        catch (e) {
          if (attempt === 4 || !/throttl|rate|cost|429/i.test(e instanceof Error ? e.message : '')) throw e;
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
      const conn = res?.data?.[field];
      rows.push(...(conn?.nodes ?? []));
      if (!conn?.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor ?? null;
      if (page === maxPages - 1) truncated = true;
    }
    const v = { rows, truncated };
    cache.set(key, { at: Date.now(), v });
    return v;
  } catch (e) {
    const prev = cache.get(key)?.v as Loaded<T> | undefined;
    return prev ?? { rows: null, error: e instanceof Error ? e.message.slice(0, 200) : 'error' };
  }
}

export interface HistInvoice { id: string; invoiceStatus?: string | null; issuedDate?: string | null; amounts?: { subtotal?: number | null; total?: number | null; taxAmount?: number | null } | null; client?: { id?: string | null } | null; jobs?: { nodes?: Array<{ id?: string | null; title?: string | null }> | null } | null }
const HIST_INVOICES = `query MetricsInvoices($first: Int!, $after: String, $filter: InvoiceFilterAttributes) {
  invoices(first: $first, after: $after, filter: $filter) {
    nodes { id invoiceStatus issuedDate amounts { subtotal total taxAmount } client { id } jobs(first: 1) { nodes { id title } } }
    pageInfo { hasNextPage endCursor } } }`;

/** Invoices issued between from and to, fetched in parallel quarter-sized chunks. */
export async function loadHistoryInvoices(fromIso: string, toIso: string): Promise<Loaded<HistInvoice>> {
  const chunks: Array<[string, string]> = [];
  let a = new Date(fromIso);
  const end = new Date(toIso);
  while (a < end) { const b = new Date(Math.min(a.getTime() + 91 * 86400_000, end.getTime())); chunks.push([a.toISOString(), b.toISOString()]); a = b; }
  const parts = await Promise.all(chunks.map(([x, y], i) => new Promise<Loaded<HistInvoice>>((r) => setTimeout(r, i * 400)).then(() => paged<HistInvoice>(`hinv|${x}|${y.slice(0, 10)}`, HIST_INVOICES, 'invoices', { filter: { issuedDate: { after: x, before: y } } })) as any));
  const bad = parts.find((p) => !p.rows);
  if (bad) return { rows: null, error: bad.error };
  const seen = new Set<string>(); const rows: HistInvoice[] = [];
  for (const p of parts) for (const r of p.rows!) if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); }
  return { rows, truncated: parts.some((p) => p.truncated) };
}

export interface CostJob { id: string; title?: string | null; completedAt?: string | null; jobCosting?: { totalRevenue?: number | null; totalCost?: number | null; lineItemCost?: number | null; labourCost?: number | null; expenseCost?: number | null; profitAmount?: number | null } | null }
const COST_JOBS = `query MetricsJobCosts($first: Int!, $after: String, $filter: JobFilterAttributes) {
  jobs(first: $first, after: $after, filter: $filter) {
    nodes { id title completedAt jobCosting { totalRevenue totalCost lineItemCost labourCost expenseCost profitAmount } }
    pageInfo { hasNextPage endCursor } } }`;
export const loadCompletedJobCosts = (from: string, to: string) =>
  paged<CostJob>(`cost|${from.slice(0, 10)}`, COST_JOBS, 'jobs', { filter: { completedAt: { after: from, before: to } } }, 20, 50);

export interface TimeEntry { id: string; startAt?: string | null; endAt?: string | null; finalDuration?: number | null; job?: { id?: string | null } | null; user?: { id?: string | null } | null }
const TIMESHEETS = `query MetricsTime($first: Int!, $after: String, $filter: TimeSheetEntryFilterAttributes) {
  timeSheetEntries(first: $first, after: $after, filter: $filter) {
    nodes { id startAt endAt finalDuration job { id } user { id } }
    pageInfo { hasNextPage endCursor } } }`;
export const loadTimesheets = (from: string, to: string) =>
  paged<TimeEntry>(`ts|${from.slice(0, 10)}`, TIMESHEETS, 'timeSheetEntries', { filter: { startAt: { after: from, before: to } } }, 20, 100);
