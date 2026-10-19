/**
 * Jobber -> Supabase read mirror for the /ops dashboards. Uses the shared jobberGraphql client
 * (durable single-writer OAuth; no separate refresh path). Resumable: backfill cursors and the
 * run lock live in jobber_sync_state. Each run: finish backfills (all history), then re-pull rolling
 * windows (short every run, wide once an hour) so status/payment changes on recent records land.
 * A finished window also drops mirror rows Jobber no longer returns (deleted jobs/invoices/quotes/
 * payments). A partial, throttled, or failed sweep never deletes, and a short pass still marks the
 * mirror fresh before any wide or full-history work.
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
    nodes { id invoiceNumber invoiceStatus issuedDate dueDate subject updatedAt amounts { subtotal total taxAmount paymentsTotal discountAmount } jobs(first: 5) { nodes { id title } } paymentRecords(first: 15) { nodes { id } } ${CLIENT_FIELDS} }
    pageInfo { hasNextPage endCursor } } }`,
  jobs: `query MirJobs($first: Int!, $after: String, $filter: JobFilterAttributes) { jobs(first: $first, after: $after, filter: $filter) {
    nodes { id jobNumber jobStatus title createdAt completedAt updatedAt jobCosting { totalRevenue totalCost lineItemCost labourCost expenseCost profitAmount } ${CLIENT_FIELDS} }
    pageInfo { hasNextPage endCursor } } }`,
  quotes: `query MirQuotes($first: Int!, $after: String, $filter: QuoteFilterAttributes) { quotes(first: $first, after: $after, filter: $filter) {
    nodes { id title quoteStatus sentAt transitionedAt createdAt updatedAt amounts { subtotal total discountAmount } client { id name companyName phones { number } emails { address } } }
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

/** Refuse to delete when a finished sweep disagrees with the mirror by more than this. A real delete is one or a few rows; a partial page walk is hundreds. */
export const MAX_MIRROR_PRUNE = 25;

export type PruneSpec = { table: string; column: string | null; after: string | null; before: string | null };
export type SweepPart = 'dated' | 'archived';
export type SweepWindows = Record<string, { dated?: string[]; archived?: string[] }>;
export type SyncProgress = { i: number; cursor: string | null; anchor: string | null; seen: string[] | null; windows: SweepWindows };
type Gone = 'gone' | 'present' | 'unknown';

const TABLES: Record<Field, string> = {
  invoices: 'jobber_invoices', jobs: 'jobber_jobs', quotes: 'jobber_quotes', paymentRecords: 'jobber_payments', timeSheetEntries: 'jobber_timesheets',
};
/** By-id reads. Payments and timesheets have no singular query; a finished entry-date / start window is the proof for those. */
const BY_ID: Partial<Record<Field, { query: string; root: string }>> = {
  jobs: { query: 'query MirGoneJob($id: EncodedId!) { job(id: $id) { id } }', root: 'job' },
  invoices: { query: 'query MirGoneInv($id: EncodedId!) { invoice(id: $id) { id } }', root: 'invoice' },
  quotes: { query: 'query MirGoneQuote($id: EncodedId!) { quote(id: $id) { id } }', root: 'quote' },
};

function asStringList(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) return null;
  return v;
}

function parseWindows(raw: unknown): SweepWindows {
  if (!raw || typeof raw !== 'object') return {};
  const out: SweepWindows = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const dated = asStringList((value as { dated?: unknown })?.dated);
    const archived = asStringList((value as { archived?: unknown })?.archived);
    if (!dated && !archived) continue;
    out[key] = { ...(dated ? { dated } : {}), ...(archived ? { archived } : {}) };
  }
  return out;
}

/** Saved rolling-pass position. `seen` is null when a resumed cursor has no ids from the pages already pulled (not safe to prune). Exported for tests. */
export function parseProgress(raw: unknown): SyncProgress | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!Number.isInteger(v?.i) || v.i < 0) return null;
    const anchor = typeof v.anchor === 'string' && Number.isFinite(Date.parse(v.anchor)) ? v.anchor : null;
    // A pass left unfinished for over a day restarts with fresh windows.
    if (anchor && Date.now() - Date.parse(anchor) > 86400_000) return null;
    const cursor = typeof v.cursor === 'string' ? v.cursor : null;
    const listed = asStringList(v.seen);
    // A saved cursor without the ids already pulled cannot prove the rest of the walk is the whole window.
    const seen = listed ?? (cursor ? null : []);
    return { i: v.i, cursor, anchor, seen, windows: parseWindows(v.windows) };
  } catch { return null; }
}

/**
 * Date window whose rows are the full population of that column. Status slices (archived jobs,
 * approved quotes, past-due invoices) are not, and neither is jobs.completedAt. Jobs are pruned
 * only from the union of the open createdAt walk and the archived createdAt walk (see jobWindowId).
 */
export function pruneSpec(field: Field, filter: Record<string, unknown> | null): PruneSpec | null {
  if (!filter) return null;
  const map: Partial<Record<Field, { key: string; column: string; table: string }>> = {
    invoices: { key: 'issuedDate', column: 'issued_date', table: 'jobber_invoices' },
    quotes: { key: 'createdAt', column: 'created_at', table: 'jobber_quotes' },
    paymentRecords: { key: 'entryDate', column: 'entry_date', table: 'jobber_payments' },
    timeSheetEntries: { key: 'startAt', column: 'start_at', table: 'jobber_timesheets' },
  };
  const spec = map[field];
  if (!spec || Object.keys(filter).length !== 1 || !(spec.key in filter)) return null;
  const range = filter[spec.key];
  if (!range || typeof range !== 'object') return null;
  if (Object.keys(range as object).some((k) => k !== 'after' && k !== 'before')) return null;
  const after = (range as { after?: unknown }).after;
  const before = (range as { before?: unknown }).before;
  if (typeof after !== 'string' || !after) return null;
  if (before != null && typeof before !== 'string') return null;
  return { table: spec.table, column: spec.column, after, before: typeof before === 'string' ? before : null };
}

/** Jobber's default jobs connection omits archived jobs, so both walks of the same createdAt window are required. `null` is the unfiltered history walk. */
export function jobWindowId(filter: Record<string, unknown> | null): { id: string; part: SweepPart } | null {
  if (filter == null) return { id: 'jobs:all', part: 'dated' };
  const keys = Object.keys(filter);
  if (keys.length === 1 && keys[0] === 'status' && filter.status === 'archived') return { id: 'jobs:all', part: 'archived' };
  const created = filter.createdAt as { after?: unknown; before?: unknown } | undefined;
  const after = typeof created?.after === 'string' ? created.after : null;
  if (!after) return null;
  const before = typeof created?.before === 'string' ? created.before : '';
  const sorted = keys.slice().sort();
  if (sorted.length === 1 && sorted[0] === 'createdAt') return { id: `jobs|${after}|${before}`, part: 'dated' };
  if (filter.status === 'archived' && sorted.length === 2 && sorted[0] === 'createdAt' && sorted[1] === 'status') {
    return { id: `jobs|${after}|${before}`, part: 'archived' };
  }
  return null;
}

export function withSweepIds(windows: SweepWindows, id: string, part: SweepPart, ids: string[]): SweepWindows {
  return { ...windows, [id]: { ...windows[id], [part]: ids.slice() } };
}

/** Null until both the open walk and the archived walk of this window have finished. */
export function readyJobIds(parts: { dated?: string[]; archived?: string[] } | undefined): string[] | null {
  if (!parts?.dated || !parts?.archived) return null;
  return [...parts.dated, ...parts.archived];
}

export function jobPruneSpec(windowId: string): PruneSpec | null {
  if (windowId === 'jobs:all') return { table: 'jobber_jobs', column: null, after: null, before: null };
  const split = windowId.split('|');
  if (split.length !== 3 || split[0] !== 'jobs' || !split[1]) return null;
  return { table: 'jobber_jobs', column: 'created_at', after: split[1], before: split[2] || null };
}

/** Mirror ids a finished sweep did not return. Null `seen` (incomplete walk) and an empty walk delete nothing. */
export function idsMissingFromSweep(mirrorIds: string[], seenIds: string[] | null, max = MAX_MIRROR_PRUNE): { deleteIds: string[]; skipped: string | null } {
  if (seenIds == null) return { deleteIds: [], skipped: 'incomplete' };
  const seen = new Set(seenIds);
  const missing: string[] = [];
  const once = new Set<string>();
  for (const id of mirrorIds) {
    if (!id || once.has(id)) continue;
    once.add(id);
    if (!seen.has(id)) missing.push(id);
  }
  if (seenIds.length === 0 && missing.length > 0) return { deleteIds: [], skipped: 'empty-sweep' };
  if (missing.length > max) return { deleteIds: [], skipped: `too-many:${missing.length}` };
  return { deleteIds: missing, skipped: null };
}

/** Jobber's answer for one id. Schema errors and throttling are unknown, never "gone". */
export function goneVerdict(res: { data?: Record<string, { id?: string } | null>; errors?: Array<{ message?: string }> } | null | undefined, root: string): Gone {
  if (!res || typeof res !== 'object') return 'unknown';
  const errors = Array.isArray(res.errors) ? res.errors : [];
  const msg = errors.map((e) => String(e?.message ?? '')).join(' ');
  if (/throttl|rate|cost|timeout|429/i.test(msg)) return 'unknown';
  if (/cannot query field|unknown argument|doesn't exist on type|undefinedField|Field '[^']+' doesn't exist/i.test(msg)) return 'unknown';
  const node = res.data?.[root];
  if (node?.id) return 'present';
  if (errors.length === 0 && res.data && node == null) return 'gone';
  if (node == null && /not found|does not exist|couldn't find|could not find|no .+ found/i.test(msg)) return 'gone';
  return 'unknown';
}

/** Confirm mode deletes only ids Jobber says are gone. Sweep mode deletes the finished-window diff (payments / timesheets). */
export function confirmedDeletes(missing: string[], verdicts: Gone[] | null, mode: 'confirm' | 'sweep'): string[] {
  if (mode === 'sweep') return missing;
  if (!verdicts || verdicts.length !== missing.length) return [];
  const out: string[] = [];
  for (let i = 0; i < missing.length; i++) {
    if (verdicts[i] === 'unknown') break;
    if (verdicts[i] === 'gone') out.push(missing[i]);
  }
  return out;
}

export const BACKFILL_FIELDS: Field[] = ['jobs', 'invoices', 'quotes', 'paymentRecords', 'timeSheetEntries'];

async function mirrorIdsFor(db: Db, spec: PruneSpec): Promise<string[] | null> {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(spec.table).select('id');
    if (spec.column && spec.after) q = q.gt(spec.column, spec.after);
    if (spec.column && spec.before) q = q.lt(spec.column, spec.before);
    const { data, error } = await q.order('id').range(from, from + 999);
    if (error) return null;
    const rows = data ?? [];
    for (const row of rows) if (row?.id) ids.push(String(row.id));
    if (rows.length < 1000) return ids;
  }
}

/** Delete mirror rows a finished sweep proved are gone. Exported for tests. Confirm mode asks Jobber about each id first. */
export async function pruneMirrorRows(
  db: Db,
  spec: PruneSpec,
  seen: string[] | null,
  opts: { mode: 'confirm' | 'sweep'; confirm?: (id: string) => Promise<Gone>; max?: number }
): Promise<{ deleted: string[]; skipped: string | null; missing: number }> {
  if (opts.mode === 'confirm' && !opts.confirm) return { deleted: [], skipped: 'no-confirm', missing: 0 };
  const mirror = await mirrorIdsFor(db, spec);
  if (!mirror) return { deleted: [], skipped: 'mirror-read', missing: 0 };
  const plan = idsMissingFromSweep(mirror, seen, opts.max ?? MAX_MIRROR_PRUNE);
  if (plan.skipped || !plan.deleteIds.length) return { deleted: [], skipped: plan.skipped, missing: plan.deleteIds.length };
  const verdicts: Gone[] = [];
  if (opts.mode === 'confirm') {
    for (const id of plan.deleteIds) {
      const verdict = await opts.confirm!(id);
      verdicts.push(verdict);
      if (verdict === 'unknown') break;
    }
    while (verdicts.length < plan.deleteIds.length) verdicts.push('unknown');
  }
  const doomed = confirmedDeletes(plan.deleteIds, opts.mode === 'confirm' ? verdicts : null, opts.mode);
  const deleted: string[] = [];
  for (const id of doomed) {
    const r = await db.from(spec.table).delete().eq('id', id);
    if (r?.error) return { deleted, skipped: String(r.error.message ?? 'delete failed'), missing: plan.deleteIds.length };
    deleted.push(id);
  }
  return { deleted, skipped: null, missing: plan.deleteIds.length };
}

async function confirmGone(field: Field, id: string, left: () => number): Promise<Gone> {
  const spec = BY_ID[field];
  if (!spec) return 'unknown';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (left() < 8_000) return 'unknown';
    let res: any;
    try { res = await jobberGraphql(spec.query, { id }); }
    catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (!/throttl|rate|cost/i.test(msg) || attempt === 2) return 'unknown';
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const msg = (res?.errors ?? []).map((e: { message?: string }) => e?.message ?? '').join(' ');
    const verdict = goneVerdict(res, spec.root);
    if (verdict !== 'unknown' || !/throttl|rate|cost/i.test(msg)) return verdict;
    await sleep(2000 * (attempt + 1));
  }
  return 'unknown';
}

async function pruneFinished(
  db: Db,
  windows: SweepWindows,
  singles: Array<{ field: Field; filter: Record<string, unknown>; seen: string[] | null }>,
  left: () => number,
) {
  const out: Array<Record<string, unknown>> = [];
  const run = async (field: Field, spec: PruneSpec | null, seen: string[] | null) => {
    if (!spec || !seen) return;
    const mode = BY_ID[field] ? 'confirm' as const : 'sweep' as const;
    const result = await pruneMirrorRows(db, spec, seen, {
      mode,
      confirm: mode === 'confirm' ? (id) => confirmGone(field, id, left) : undefined,
    });
    if (result.deleted.length || result.skipped) out.push({ field, table: spec.table, deleted: result.deleted, skipped: result.skipped, missing: result.missing });
  };
  for (const [id, parts] of Object.entries(windows)) await run('jobs', jobPruneSpec(id), readyJobIds(parts));
  for (const single of singles) {
    if (single.field === 'jobs') continue;
    await run(single.field, pruneSpec(single.field, single.filter), single.seen);
  }
  return out;
}

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
    const { data: states } = await db.from('jobber_sync_state').select('key, cursor, done, last_success_at, last_error, meta');
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
    //    a) Short windows every run; a finished short pass alone marks the mirror fresh ('rolling').
    //    b) Wide windows hourly. Both passes resume across runs (task index + cursor + window anchor saved in
    //       'rolling:short-progress' / 'rolling:wide-progress').
    //    Before this split, a wide pass that could not finish in one budget (the 9k-point reserve sleeps between
    //    pages) never saved progress or freshness, so every run restarted the wide pass, the mirror went stale,
    //    and the dashboards fell back to live Jobber pulls that were throttled (call dashboard stuck loading).
    if (backfilled && left() > 45_000) {
      const runTasks = async (tasks: Array<{ field: Field; filter: Record<string, unknown> }>, start: SyncProgress) => {
        let n = 0;
        let windows: SweepWindows = { ...start.windows };
        const singles: Array<{ field: Field; filter: Record<string, unknown>; seen: string[] | null }> = [];
        const stop = (i: number, cursor: string | null, seen: string[] | null) => ({ n, done: false as const, at: { i, cursor, seen, windows }, singles });
        for (let i = start.i; i < tasks.length; i++) {
          const t = tasks[i];
          const resuming = i === start.i;
          let cursor: string | null = resuming ? start.cursor : null;
          // A cursor saved before ids were recorded (or by an older deploy) is not a complete window.
          const untrusted = resuming && !!cursor && start.seen == null;
          let seen: string[] = resuming && !untrusted ? [...(start.seen ?? [])] : [];
          const trusted = !untrusted;
          if (t.field === 'timeSheetEntries' && st.get('backfill:timeSheetEntries')?.last_error === 'permission') continue;
          const optional = (t.filter as { status?: string }).status === 'archived' || 'invoiceStatus' in t.filter;
          const part = t.field === 'jobs' ? jobWindowId(t.filter) : null;
          const singleSpec = part ? null : pruneSpec(t.field, t.filter);
          const track = !!(part || singleSpec);
          try {
            do {
              if (left() < 15_000) return stop(i, cursor, trusted ? seen : null);
              const p = await page(t.field, t.filter, cursor);
              if (trusted && track) for (const node of p.nodes) if (node?.id) seen.push(String(node.id));
              n += await store(db, t.field, p.nodes); cursor = p.next;
            } while (cursor);
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'error';
            // Throttled: keep the position so the next run resumes here instead of starting over. Do not prune.
            if (/throttl/i.test(msg)) { report.stopped = msg.slice(0, 180); return stop(i, cursor, trusted ? seen : null); }
            if (!optional) throw e;
            report[`skip:${t.field}`] = msg.slice(0, 180);
            continue;
          }
          if (trusted && part) windows = withSweepIds(windows, part.id, part.part, seen);
          else if (trusted && singleSpec) singles.push({ field: t.field, filter: t.filter, seen });
        }
        return { n, done: true as const, at: null, windows, singles };
      };
      // Each pass resumes where the last run stopped. The window anchor is saved with the cursor so a resumed
      // cursor is always replayed against the exact same filter it came from. Seen ids ride along so a sweep
      // that spans runs can still prune, and only once both halves of a job window have finished.
      const pass = async (kind: 'short' | 'wide') => {
        const key = `rolling:${kind}-progress`;
        const prog = parseProgress(st.get(key)?.cursor);
        const anchor = prog?.anchor ? new Date(prog.anchor) : now;
        const r = await runTasks(rollingTasks(anchor, kind === 'wide'), prog ?? { i: 0, cursor: null, anchor: null, seen: [], windows: {} });
        await setState(db, key, {
          cursor: r.done ? null : JSON.stringify({ i: r.at!.i, cursor: r.at!.cursor, anchor: anchor.toISOString(), seen: r.at!.seen, windows: r.at!.windows }),
          done: r.done,
        });
        return {
          rows: r.n, complete: r.done, windows: r.done ? r.windows : {}, singles: r.done ? r.singles : [],
          ...(r.at ? { resumeAt: r.at.i } : {}), ...(prog ? { resumedFrom: prog.i } : {}),
        };
      };
      const short = await pass('short');
      // Freshness is the finished short pass alone, saved before prune / wide / full sweeps.
      if (short.complete) await setState(db, 'rolling', { done: true, last_success_at: new Date().toISOString(), last_error: null });
      const { windows: shortWindows, singles: shortSingles, ...shortReport } = short;
      report.rolling = { wide: false, ...shortReport };
      if (short.complete) {
        try {
          const pruned = await pruneFinished(db, shortWindows, shortSingles, left);
          if (pruned.length) report.pruned = [...((report.pruned as Array<Record<string, unknown>> | undefined) ?? []), ...pruned];
        } catch (e) { report.pruneError = e instanceof Error ? e.message.slice(0, 180) : 'prune failed'; }
      }
      const lastWide = Date.parse(st.get('rolling:wide')?.last_success_at || '') || 0;
      const wideDue = opts.forceWide || !!parseProgress(st.get('rolling:wide-progress')?.cursor) || Date.now() - lastWide > 55 * 60_000;
      if (short.complete && wideDue && left() > 45_000) {
        const wide = await pass('wide');
        if (wide.complete) await setState(db, 'rolling:wide', { done: true, last_success_at: new Date().toISOString() });
        const { windows: wideWindows, singles: wideSingles, ...wideReport } = wide;
        report.wide = wideReport;
        if (wide.complete) {
          try {
            const pruned = await pruneFinished(db, wideWindows, wideSingles, left);
            if (pruned.length) report.pruned = [...((report.pruned as Array<Record<string, unknown>> | undefined) ?? []), ...pruned];
          } catch (e) { report.pruneError = e instanceof Error ? e.message.slice(0, 180) : 'prune failed'; }
        }
      }
    }
    // 3) Daily resumable re-sweep of ALL quotes: old quotes can be approved months after creation (e.g. #2235 created
    //    Feb 2026, approved Oct 5), outside the 200-day rolling window. Cursor is saved so a short budget just resumes.
    // Only after the short pass finished: freshness first (the full quote sweep used to eat the budget a throttled short pass needed).
    const shortDone = (report.rolling as { complete?: boolean } | undefined)?.complete;
    if (backfilled && shortDone && left() > 45_000) {
      const fq = st.get('rolling:quotes-full');
      const due = opts.forceWide || !!fq?.cursor || Date.now() - (Date.parse(fq?.last_success_at || '') || 0) > 23 * 3600_000;
      if (due) {
        let cursor: string | null = fq?.cursor ?? null;
        let seen: string[] = asStringList(fq?.meta?.seen) ?? [];
        if (cursor && !asStringList(fq?.meta?.seen)) { cursor = null; seen = []; } // pages already pulled were not recorded; start over rather than prune a fragment
        if (!cursor) seen = [];
        const filter = { createdAt: { after: BACKFILL_FROM } };
        let n = 0;
        while (left() > 30_000) {
          const p = await page('quotes', filter, cursor);
          for (const node of p.nodes) if (node?.id) seen.push(String(node.id));
          n += await store(db, 'quotes', p.nodes); cursor = p.next;
          await setState(db, 'rolling:quotes-full', { cursor, done: !cursor, meta: { seen }, ...(cursor ? {} : { last_success_at: new Date().toISOString() }) });
          if (!cursor) break;
        }
        let pruned: { deleted: string[]; skipped: string | null; missing: number } | null = null;
        if (!cursor) {
          pruned = await pruneMirrorRows(db, pruneSpec('quotes', filter)!, seen, { mode: 'confirm', confirm: (id) => confirmGone('quotes', id, left) });
          await setState(db, 'rolling:quotes-full', { meta: { seen: [] } });
        }
        report.quotesFull = { rows: n, done: !cursor, ...(pruned && (pruned.deleted.length || pruned.skipped) ? { pruned } : {}) };
      }
    }
    // 4) Daily resumable walk of every job (open + archived). The 60-day rolling window will not see a delete
    //    older than that, and Since Sep 18 / the 90-day dashboard grow past it. Same freshness rule: only after
    //    the short pass. Prune only when BOTH halves finish; a throttle keeps the cursor and deletes nothing.
    if (backfilled && shortDone && left() > 45_000) {
      const key = 'rolling:jobs-reconcile';
      const row = st.get(key);
      const meta = row?.meta ?? {};
      const last = Date.parse(row?.last_success_at || '') || 0;
      const due = opts.forceWide || !!row?.cursor || meta.phase === 'archived' || Date.now() - last > 23 * 3600_000;
      if (due) {
        let phase: 'dated' | 'archived' = meta.phase === 'archived' ? 'archived' : 'dated';
        let cursor: string | null = row?.cursor ?? null;
        let seenDated = asStringList(meta.seenDated) ?? [];
        let seenArchived = asStringList(meta.seenArchived) ?? [];
        if (cursor && phase === 'dated' && !asStringList(meta.seenDated)) { cursor = null; seenDated = []; }
        if (cursor && phase === 'archived' && !asStringList(meta.seenArchived)) { cursor = null; seenArchived = []; }
        if (!cursor && phase === 'dated') seenDated = [];
        const save = (patch: Record<string, unknown>) => setState(db, key, patch);
        const pull = async (filter: Record<string, unknown> | null, seen: string[]) => {
          let n = 0;
          while (left() > 30_000) {
            let p;
            try { p = await page('jobs', filter, cursor); }
            catch (e) {
              const msg = e instanceof Error ? e.message : 'error';
              if (/throttl/i.test(msg)) return { n, done: false, stopped: msg.slice(0, 180) };
              throw e;
            }
            for (const node of p.nodes) if (node?.id) seen.push(String(node.id));
            n += await store(db, 'jobs', p.nodes);
            cursor = p.next;
            await save({ cursor, meta: { phase, seenDated, seenArchived } });
            if (!cursor) return { n, done: true, stopped: null as string | null };
          }
          return { n, done: false, stopped: null as string | null };
        };
        let rows = 0;
        if (phase === 'dated') {
          const pulled = await pull(null, seenDated);
          rows += pulled.n;
          if (!pulled.done) { report.jobsReconcile = { phase, rows, done: false, ...(pulled.stopped ? { stopped: pulled.stopped } : {}) }; }
          else { phase = 'archived'; cursor = null; await save({ cursor: null, meta: { phase, seenDated, seenArchived } }); }
        }
        if (!report.jobsReconcile && left() > 30_000) {
          try {
            const pulled = await pull({ status: 'archived' }, seenArchived);
            rows += pulled.n;
            if (!pulled.done) report.jobsReconcile = { phase: 'archived', rows, done: false, ...(pulled.stopped ? { stopped: pulled.stopped } : {}) };
            else {
              const pruned = await pruneMirrorRows(db, jobPruneSpec('jobs:all')!, [...seenDated, ...seenArchived], { mode: 'confirm', confirm: (id) => confirmGone('jobs', id, left) });
              await save({ cursor: null, done: true, last_success_at: new Date().toISOString(), last_error: null, meta: { phase: 'dated', seenDated: [], seenArchived: [] } });
              report.jobsReconcile = { phase: 'done', rows, done: true, ...(pruned.deleted.length || pruned.skipped ? { pruned } : {}) };
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'error';
            if (/throttl/i.test(msg)) report.jobsReconcile = { phase: 'archived', rows, done: false, stopped: msg.slice(0, 180) };
            else {
              // No archived half means the open walk is not the full job list. Do not prune.
              await save({ cursor: null, done: true, last_success_at: new Date().toISOString(), last_error: msg.slice(0, 180), meta: { phase: 'dated', seenDated: [], seenArchived: [] } });
              report.jobsReconcile = { phase: 'archived', rows, done: false, skipped: msg.slice(0, 180) };
            }
          }
        } else if (!report.jobsReconcile) report.jobsReconcile = { phase, rows, done: false };
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
