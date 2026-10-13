/** Jobber loaders for /ops/metrics. Each loader fails independently ({ rows: null, error }) and is cached 30 min. */
import { unstable_cache } from 'next/cache';
import { assertNoJobberErrors, jobberGraphql } from '../jobber/client.ts';
import { mirrorInvoices, mirrorJobs, mirrorTimesheets } from '../jobber-mirror/read.ts';
const fromMirror = async <T>(m: () => Promise<any[] | null>): Promise<Loaded<T> | null> => { try { const r = await m(); return r ? { rows: r as T[] } : null; } catch { return null; } };

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
      for (let attempt = 0; attempt < 8; attempt++) {
        try { res = await jobberGraphql(query, { ...variables, first, after }); assertNoJobberErrors(res, `metrics ${field}`); break; }
        catch (e) {
          if (attempt === 7 || !/throttl|rate|cost|429/i.test(e instanceof Error ? e.message : '')) throw e;
          await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
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

export interface HistInvoice { id: string; invoiceStatus?: string | null; issuedDate?: string | null; subject?: string | null; amounts?: { subtotal?: number | null; total?: number | null; taxAmount?: number | null; discountAmount?: number | null } | null; client?: { id?: string | null; name?: string | null; companyName?: string | null } | null; jobs?: { nodes?: Array<{ id?: string | null; title?: string | null }> | null } | null }
const HIST_INVOICES = `query MetricsInvoices($first: Int!, $after: String, $filter: InvoiceFilterAttributes) {
  invoices(first: $first, after: $after, filter: $filter) {
    nodes { id invoiceStatus issuedDate subject amounts { subtotal total taxAmount discountAmount } client { id name companyName } jobs(first: 1) { nodes { id title } } }
    pageInfo { hasNextPage endCursor } } }`;

/** Invoices issued between from and to, fetched in parallel quarter-sized chunks. */
export async function loadHistoryInvoices(fromIso: string, toIso: string): Promise<Loaded<HistInvoice>> {
  const m = await fromMirror<HistInvoice>(() => mirrorInvoices(fromIso, toIso)); if (m) return m;
  const chunks: Array<[string, string]> = [];
  // Calendar-quarter boundaries (UTC) so chunk cache keys are stable from one request to the next.
  const f = new Date(fromIso);
  let a = new Date(Date.UTC(f.getUTCFullYear(), Math.floor(f.getUTCMonth() / 3) * 3, 1));
  const end = new Date(toIso);
  while (a < end) { const q = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 3, 1)); const b = q < end ? q : end; chunks.push([a.toISOString(), b.toISOString()]); a = b; }
  // Sequential: parallel chunks trip Jobber's query-cost throttle (and starve the call dashboard).
  const parts: Loaded<HistInvoice>[] = [];
  // Closed quarters (ending 14+ days ago) are kept in Vercel's shared Data Cache for 12 h, so a pull that times out under
  // Jobber throttling still banks the chunks it finished and the next request picks up where it left off.
  for (const [x, y] of chunks) {
    const k = `hinv|${x.slice(0, 10)}|${y.slice(0, 10)}`;
    const pull = () => paged<HistInvoice>(k, HIST_INVOICES, 'invoices', { filter: { issuedDate: { after: x, before: y } } }, 40, 50);
    if (Date.parse(y) < Date.now() - 14 * 86400_000) {
      try {
        parts.push(await unstable_cache(async () => { const r = await pull(); if (!r.rows) throw new Error(r.error || 'load failed'); return r; }, ['ops-metrics-hinv-v2', x.slice(0, 10), y.slice(0, 10)], { revalidate: 43200 })());
      } catch (e) { parts.push({ rows: null, error: e instanceof Error ? e.message.slice(0, 200) : 'error' }); }
    } else parts.push(await pull());
  }
  const bad = parts.find((p) => !p.rows);
  if (bad) return { rows: null, error: bad.error };
  const seen = new Set<string>(); const rows: HistInvoice[] = [];
  for (const p of parts) for (const r of p.rows!) if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); }
  return { rows, truncated: parts.some((p) => p.truncated) };
}

export interface CostJob { id: string; jobNumber?: number | null; title?: string | null; completedAt?: string | null; jobCosting?: { totalRevenue?: number | null; totalCost?: number | null; lineItemCost?: number | null; labourCost?: number | null; expenseCost?: number | null; profitAmount?: number | null } | null }
const COST_JOBS = `query MetricsJobCosts($first: Int!, $after: String, $filter: JobFilterAttributes) {
  jobs(first: $first, after: $after, filter: $filter) {
    nodes { id jobNumber title completedAt jobCosting { totalRevenue totalCost lineItemCost labourCost expenseCost profitAmount } }
    pageInfo { hasNextPage endCursor } } }`;
export const loadCompletedJobCosts = async (from: string, to: string) => (await fromMirror<CostJob>(() => mirrorJobs('completed_at', from, to))) ??
  paged<CostJob>(`cost|${from.slice(0, 10)}`, COST_JOBS, 'jobs', { filter: { completedAt: { after: from, before: to } } }, 20, 50);

export interface TimeEntry { id: string; startAt?: string | null; endAt?: string | null; finalDuration?: number | null; job?: { id?: string | null } | null; user?: { id?: string | null } | null }
const TIMESHEETS = `query MetricsTime($first: Int!, $after: String, $filter: TimeSheetEntriesFilterAttributes) {
  timeSheetEntries(first: $first, after: $after, filter: $filter) {
    nodes { id startAt endAt finalDuration job { id } user { id } }
    pageInfo { hasNextPage endCursor } } }`;
export const loadTimesheets = async (from: string, to: string) => (await fromMirror<TimeEntry>(() => mirrorTimesheets(from, to))) ??
  paged<TimeEntry>(`ts|${from.slice(0, 10)}`, TIMESHEETS, 'timeSheetEntries', { filter: { startAt: { after: from, before: to } } }, 20, 100);
