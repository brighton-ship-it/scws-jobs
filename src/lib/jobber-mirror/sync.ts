/**
 * Jobber -> Supabase read mirror for the /ops dashboards. Uses the shared jobberGraphql client
 * (durable single-writer OAuth; no separate refresh path). Resumable: backfill cursors and the
 * run lock live in jobber_sync_state. Each run: finish backfills (all history), then re-pull rolling
 * windows (short every run, wide once an hour) so status/payment changes on recent records land.
 */
import { jobberGraphql } from '../jobber/client.ts';

type Db = any;
const digits10 = (s: unknown) => { const d = String(s ?? '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('1') ? d.slice(1) : d; };
/** Mirror waits for the shared bucket to refill to this before its next page. */
export const MIRROR_BUCKET_RESERVE = 9000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400_000;

const CLIENT_FIELDS = 'client { id name companyName createdAt phones { number } emails { address } }';
export const Q = {
  invoices: `query MirInv($first: Int!, $after: String, $filter: InvoiceFilterAttributes) { invoices(first: $first, after: $after, filter: $filter) {
    nodes { id invoiceNumber invoiceStatus issuedDate dueDate subject updatedAt amounts { subtotal total taxAmount paymentsTotal discountAmount } jobs(first: 5) { nodes { id title } } ${CLIENT_FIELDS} }
    pageInfo { hasNextPage endCursor } } }`,
  jobs: `query MirJobs($first: Int!, $after: String, $filter: JobFilterAttributes) { jobs(first: $first, after: $after, filter: $filter) {
    nodes { id jobNumber jobStatus title createdAt completedAt updatedAt jobCosting { totalRevenue totalCost lineItemCost labourCost expenseCost profitAmount } ${CLIENT_FIELDS} }
    pageInfo { hasNextPage endCursor } } }`,
  quotes: `query MirQuotes($first: Int!, $after: String, $filter: QuoteFilterAttributes) { quotes(first: $first, after: $after, filter: $filter) {
    nodes { id title quoteStatus sentAt transitionedAt createdAt updatedAt amounts { subtotal total discountAmount } client { id name phones { number } emails { address } } }
    pageInfo { hasNextPage endCursor } } }`,
  paymentRecords: `query MirPay($first: Int!, $after: String, $filter: PaymentRecordFilterAttributes) { paymentRecords(first: $first, after: $after, filter: $filter) {
    nodes { id amount entryDate adjustmentType }
    pageInfo { hasNextPage endCursor } } }`,
  timeSheetEntries: `query MirTime($first: Int!, $after: String, $filter: TimeSheetEntriesFilterAttributes) { timeSheetEntries(first: $first, after: $after, filter: $filter) {
    nodes { id startAt endAt finalDuration job { id } user { id } }
    pageInfo { hasNextPage endCursor } } }`,
} as const;
export type Field = keyof typeof Q;
const PAGE: Record<Field, number> = { invoices: 25, jobs: 25, quotes: 100, paymentRecords: 100, timeSheetEntries: 100 };
/** Backfill filter (Jobber started Jan 31 2025; pull from Jan 1 2025 to be safe). Unfiltered for jobs so every client job time is known. */
const BACKFILL_FROM = '2025-01-01T00:00:00Z';
const backfillFilter = (f: Field) => ({
  invoices: { issuedDate: { after: BACKFILL_FROM } },
  jobs: null,
  quotes: { createdAt: { after: BACKFILL_FROM } },
  paymentRecords: { entryDate: { after: BACKFILL_FROM } },
  timeSheetEntries: { startAt: { after: new Date(Date.now() - 120 * DAY).toISOString() } },
}[f]);

/** Rolling windows. short = every run, wide = hourly. */
export function rollingTasks(now: Date, wide: boolean): Array<{ field: Field; filter: Record<string, unknown> }> {
  const ago = (d: number) => new Date(now.getTime() - d * DAY).toISOString();
  const end = new Date(now.getTime() + 2 * DAY).toISOString();
  const w = (d: number) => ({ after: ago(d), before: end });
  return wide ? [
    { field: 'invoices', filter: { issuedDate: w(120) } },
    { field: 'paymentRecords', filter: { entryDate: w(40) } },
    { field: 'quotes', filter: { createdAt: w(200) } },
    { field: 'quotes', filter: { status: 'approved' } },
    { field: 'quotes', filter: { status: 'converted' } }, // hourly: old quote approved and converted at once
    { field: 'jobs', filter: { createdAt: w(60) } },
    { field: 'jobs', filter: { status: 'archived', createdAt: w(60) } },
    { field: 'jobs', filter: { completedAt: w(95) } },
    { field: 'invoices', filter: { invoiceStatus: ['past_due'] } },
    { field: 'invoices', filter: { invoiceStatus: ['awaiting_payment'] } },
    { field: 'timeSheetEntries', filter: { startAt: w(35) } },
  ] : [
    { field: 'invoices', filter: { issuedDate: w(21) } },
    { field: 'paymentRecords', filter: { entryDate: w(7) } },
    { field: 'quotes', filter: { createdAt: w(30) } },
    // Old quotes approved today (e.g. #3726, created Jul, approved Oct 12) land within one 10-min run.
    { field: 'quotes', filter: { status: 'approved' } },
    { field: 'jobs', filter: { createdAt: w(14) } },
    { field: 'jobs', filter: { status: 'archived', createdAt: w(14) } },
    { field: 'jobs', filter: { completedAt: w(14) } },
    { field: 'invoices', filter: { invoiceStatus: ['past_due'] } },
    { field: 'invoices', filter: { invoiceStatus: ['awaiting_payment'] } },
    { field: 'timeSheetEntries', filter: { startAt: w(3) } },
  ];
}

/** One Jobber page with cost-aware backoff. */
async function page(field: Field, filter: unknown, after: string | null) {
  for (let attempt = 0; ; attempt++) {
    let res: any;
    try {
      res = await jobberGraphql(Q[field], { first: PAGE[field], after, filter });
    } catch (e) {
      if (attempt >= 5 || !/throttl|rate|cost|429|50\d/i.test(e instanceof Error ? e.message : '')) throw e;
      await sleep(3000 * (attempt + 1)); continue;
    }
    const msg = res?.errors?.[0]?.message as string | undefined;
    if (msg) {
      if (attempt >= 8 || !/throttl|rate|cost/i.test(msg)) throw new Error(`${field}: ${msg}`);
      // Wait exactly long enough for the bucket to refill to this query's cost (+ headroom).
      const c = res?.extensions?.cost; const ts = c?.throttleStatus;
      const need = ts && c?.requestedQueryCost ? ((c.requestedQueryCost + 1000 - ts.currentlyAvailable) / (ts.restoreRate || 500)) * 1000 : 5000 * (attempt + 1);
      await sleep(Math.min(20_000, Math.max(2000, need))); continue;
    }
    // Leave headroom for the receptionist / booking calls sharing this Jobber app's 10,000-point bucket.
    // One checkSchedule board read costs ~8–9k points (several 1,905-point visit pages), so a 4k floor
    // starved live calls into "Throttled" while the mirror ran. Refill to near-full before the next page.
    const ts = res?.extensions?.cost?.throttleStatus;
    if (ts && ts.currentlyAvailable < MIRROR_BUCKET_RESERVE) await sleep(Math.min(20_000, ((MIRROR_BUCKET_RESERVE - ts.currentlyAvailable) / (ts.restoreRate || 500)) * 1000));
    const conn = res?.data?.[field];
    return { nodes: (conn?.nodes ?? []) as any[], next: conn?.pageInfo?.hasNextPage ? (conn.pageInfo.endCursor as string) : null };
  }
}

function clientEmails(c: any): string[] {
  const raw = Array.isArray(c?.emails) ? c.emails : [];
  return Array.from(new Set(raw.map((e: any) => String(e?.address ?? e ?? '').trim().toLowerCase()).filter(Boolean)));
}

function clientRow(c: any) {
  if (!c?.id) return null;
  return { id: c.id, created_at: c.createdAt ?? null, name: c.name ?? null, company_name: c.companyName ?? null,
    phones_digits: Array.from(new Set((c.phones ?? []).map((p: any) => digits10(p?.number)).filter((d: string) => d.length === 10))),
    data: { id: c.id, name: c.name ?? null, companyName: c.companyName ?? null, createdAt: c.createdAt ?? null, phones: c.phones ?? [], emails: clientEmails(c) }, synced_at: new Date().toISOString() };
}

/** Map one page of nodes to upserts. Exported for tests. */
export function rowsFor(field: Field, nodes: any[]) {
  const now = new Date().toISOString();
  const clients = new Map<string, any>();
  const addClient = (c: any) => { const r = clientRow(c); if (r) clients.set(r.id, r); };
  let table: string; let rows: any[];
  switch (field) {
    case 'invoices':
      table = 'jobber_invoices';
      rows = nodes.map((n) => { addClient(n.client); const { client, ...rest } = n; return {
        id: n.id, invoice_status: n.invoiceStatus ?? null, issued_date: n.issuedDate ?? null, client_id: client?.id ?? null,
        job_ids: (n.jobs?.nodes ?? []).map((j: any) => j?.id).filter(Boolean), jobber_updated_at: n.updatedAt ?? null,
        data: { ...rest, client: client?.id ? { id: client.id } : null }, synced_at: now }; });
      break;
    case 'jobs':
      table = 'jobber_jobs';
      rows = nodes.map((n) => { addClient(n.client); const { client, ...rest } = n; return {
        id: n.id, job_number: n.jobNumber ?? null, client_id: client?.id ?? null, title: n.title ?? null,
        created_at: n.createdAt ?? null, completed_at: n.completedAt ?? null, jobber_updated_at: n.updatedAt ?? null,
        data: { ...rest, client: client?.id ? { id: client.id } : null }, synced_at: now }; });
      break;
    case 'quotes':
      table = 'jobber_quotes';
      rows = nodes.map((n) => { addClient(n.client); return { id: n.id, quote_status: n.quoteStatus ?? null, created_at: n.createdAt ?? null, jobber_updated_at: n.updatedAt ?? null, data: n, synced_at: now }; });
      break;
    case 'paymentRecords':
      table = 'jobber_payments';
      rows = nodes.map((n) => ({ id: n.id, entry_date: n.entryDate ?? null, data: n, synced_at: now }));
      break;
    case 'timeSheetEntries':
      table = 'jobber_timesheets';
      rows = nodes.map((n) => ({ id: n.id, start_at: n.startAt ?? null, data: n, synced_at: now }));
      break;
  }
  return { table: table!, rows: rows!.filter((r) => r.id), clients: Array.from(clients.values()) };
}

async function store(db: Db, field: Field, nodes: any[]) {
  const { table, rows, clients } = rowsFor(field, nodes);
  if (clients.length) { const r = await db.from('jobber_clients').upsert(clients, { onConflict: 'id' }); if (r.error) throw new Error(`jobber_clients: ${r.error.message}`); }
  if (rows.length) { const r = await db.from(table).upsert(rows, { onConflict: 'id' }); if (r.error) throw new Error(`${table}: ${r.error.message}`); }
  return rows.length;
}

async function setState(db: Db, key: string, patch: Record<string, unknown>) {
  const r = await db.from('jobber_sync_state').upsert({ key, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (r.error) throw new Error(`jobber_sync_state: ${r.error.message}`);
}

export const BACKFILL_FIELDS: Field[] = ['jobs', 'invoices', 'quotes', 'paymentRecords', 'timeSheetEntries'];

export async function runMirrorSync(db: Db, opts: { budgetMs?: number; forceWide?: boolean; now?: Date } = {}) {
  const t0 = Date.now(); const budget = opts.budgetMs ?? 230_000; const now = opts.now ?? new Date();
  const left = () => budget - (Date.now() - t0);
  // Single runner: claim the lock row (conditional update) so overlapping cron runs never double-pull Jobber.
  const lockUntil = new Date(Date.now() + budget + 60_000).toISOString();
  const claim = await db.from('jobber_sync_state').update({ locked_until: lockUntil, updated_at: new Date().toISOString() })
    .eq('key', 'lock').lt('locked_until', new Date().toISOString()).select('key');
  if (claim.error) throw new Error(`lock: ${claim.error.message}`);
  if (!claim.data?.length) return { skipped: 'locked' };
  const report: Record<string, unknown> = {};
  try {
    const { data: states } = await db.from('jobber_sync_state').select('key, cursor, done, last_success_at, last_error');
    const st = new Map<string, any>((states ?? []).map((s: any) => [s.key, s]));
    // 1) Backfills (resumable).
    for (const f of BACKFILL_FIELDS) {
      const key = `backfill:${f}`; const s = st.get(key);
      if (s?.done) continue;
      let cursor: string | null = s?.cursor ?? null; let n = 0;
      while (left() > 60_000) {
        let p;
        try { p = await page(f, backfillFilter(f), cursor); }
        catch (e) {
          // Timesheets are hidden from this Jobber app (permissions): skip them; metrics falls back to live (same '—' as before).
          if (f === 'timeSheetEntries' && /permission|hidden/i.test(e instanceof Error ? e.message : '')) { await setState(db, key, { cursor: null, done: true, last_error: 'permission' }); cursor = null; break; }
          throw e;
        }
        n += await store(db, f, p.nodes);
        cursor = p.next;
        await setState(db, key, { cursor, done: !cursor, ...(cursor ? {} : { last_success_at: new Date().toISOString() }) });
        if (!cursor) break;
      }
      report[key] = { rows: n, done: !cursor };
      if (cursor) break; // out of time; resume next run
    }
    const backfilled = BACKFILL_FIELDS.every((f) => st.get(`backfill:${f}`)?.done || (report[`backfill:${f}`] as any)?.done);
    // 2) Rolling refresh (only once history is in, so the first runs spend their budget on backfill).
    if (backfilled && left() > 45_000) {
      const lastWide = Date.parse(st.get('rolling:wide')?.last_success_at || '') || 0;
      const wide = opts.forceWide || Date.now() - lastWide > 55 * 60_000;
      let n = 0; let complete = true;
      for (const t of rollingTasks(now, wide)) {
        let cursor: string | null = null;
        if (t.field === 'timeSheetEntries' && st.get('backfill:timeSheetEntries')?.last_error === 'permission') continue;
        const optional = (t.filter as { status?: string }).status === 'archived' || 'invoiceStatus' in t.filter;
        try {
          do {
            if (left() < 15_000) { complete = false; break; }
            const p = await page(t.field, t.filter, cursor);
            n += await store(db, t.field, p.nodes); cursor = p.next;
          } while (cursor);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'error';
          if (!optional || /throttl/i.test(msg)) throw e;
          report[`skip:${t.field}`] = msg.slice(0, 180);
          continue;
        }
        if (!complete) break;
      }
      if (complete) {
        const at = new Date().toISOString();
        await setState(db, 'rolling', { done: true, last_success_at: at, last_error: null });
        if (wide) await setState(db, 'rolling:wide', { done: true, last_success_at: at });
      }
      report.rolling = { wide, rows: n, complete };
    }
    // 3) Daily resumable re-sweep of ALL quotes: old quotes can be approved months after creation (e.g. #2235 created
    //    Feb 2026, approved Oct 5), outside the 200-day rolling window. Cursor is saved so a short budget just resumes.
    if (backfilled && left() > 45_000) {
      const fq = st.get('rolling:quotes-full');
      const due = opts.forceWide || !!fq?.cursor || Date.now() - (Date.parse(fq?.last_success_at || '') || 0) > 23 * 3600_000;
      if (due) {
        let cursor: string | null = fq?.cursor ?? null; let n = 0;
        while (left() > 30_000) {
          const p = await page('quotes', { createdAt: { after: BACKFILL_FROM } }, cursor);
          n += await store(db, 'quotes', p.nodes); cursor = p.next;
          await setState(db, 'rolling:quotes-full', { cursor, done: !cursor, ...(cursor ? {} : { last_success_at: new Date().toISOString() }) });
          if (!cursor) break;
        }
        report.quotesFull = { rows: n, done: !cursor };
      }
    }
    return report;
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'error';
    if (/throttl/i.test(msg)) { report.stopped = msg; return report; } // progress is saved per page; resume next run
    await setState(db, 'rolling', { last_error: msg }).catch(() => {});
    throw e;
  } finally {
    await db.from('jobber_sync_state').update({ locked_until: new Date(Date.now() - 1000).toISOString() }).eq('key', 'lock');
  }
}
