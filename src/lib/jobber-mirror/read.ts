/**
 * Readers over the Jobber mirror (see sync.ts). Each returns the exact node shape the old live Jobber
 * loaders returned, so dashboard / metrics calculations are unchanged. Every reader returns null when the
 * mirror is not ready (backfill unfinished, or last good sync > 40 min old); callers then fall back to live Jobber.
 */
import { createServiceClient } from '../supabase/service.ts';
import { BACKFILL_FIELDS } from './sync.ts';

const STALE_MS = 40 * 60_000;
let tsBlocked = false;
let stateMemo: { at: number; v: { ready: boolean; asOf: string | null } } | null = null;
const db = () => { try { return createServiceClient() as any; } catch { return null; } };
const digits10 = (s: unknown) => { const d = String(s ?? '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('1') ? d.slice(1) : d; };

export async function mirrorState(): Promise<{ ready: boolean; asOf: string | null }> {
  if (process.env.JOBBER_MIRROR_DISABLED === '1') return { ready: false, asOf: null };
  if (stateMemo && Date.now() - stateMemo.at < 20_000) return stateMemo.v;
  let v = { ready: false, asOf: null as string | null };
  try {
    const c = db(); if (!c) return v;
    const { data, error } = await c.from('jobber_sync_state').select('key, done, last_success_at, last_error');
    if (!error) {
      const m = new Map<string, any>((data ?? []).map((r: any) => [r.key, r]));
      tsBlocked = m.get('backfill:timeSheetEntries')?.last_error === 'permission';
      const asOf = m.get('rolling')?.last_success_at ?? null;
      const ready = BACKFILL_FIELDS.every((f) => m.get(`backfill:${f}`)?.done) && !!asOf && Date.now() - Date.parse(asOf) < STALE_MS;
      v = { ready, asOf };
    }
  } catch { /* table missing => not ready */ }
  stateMemo = { at: Date.now(), v };
  return v;
}

/** All rows of a PostgREST query, 1000 at a time. */
async function all(build: (c: any) => any): Promise<any[] | null> {
  const c = db(); if (!c) return null;
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(c).range(from, from + 999);
    if (error) { console.warn('[jobber-mirror] read failed:', error.message); return null; }
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

/** Clients + every job time per client (memoized briefly; shared by all readers in one request). */
let ctxMemo: { at: number; p: Promise<Ctx | null> } | null = null;
interface Ctx { clients: Map<string, any>; jobsByClient: Map<string, Array<{ id: string; createdAt: string }>>; byPhone: Map<string, string[]> }
function ctx(): Promise<Ctx | null> {
  if (ctxMemo && Date.now() - ctxMemo.at < 30_000) return ctxMemo.p;
  const p = (async () => {
    const [cl, jb] = await Promise.all([
      all((c) => c.from('jobber_clients').select('id, phones_digits, data').order('id')),
      all((c) => c.from('jobber_jobs').select('id, client_id, created_at').order('id')),
    ]);
    if (!cl || !jb) return null;
    const clients = new Map<string, any>(); const byPhone = new Map<string, string[]>();
    for (const r of cl) { clients.set(r.id, r.data); for (const p of r.phones_digits ?? []) (byPhone.get(p) ?? byPhone.set(p, []).get(p)!).push(r.id); }
    const jobsByClient = new Map<string, Array<{ id: string; createdAt: string }>>();
    for (const j of jb) if (j.client_id && j.created_at) (jobsByClient.get(j.client_id) ?? jobsByClient.set(j.client_id, []).get(j.client_id)!).push({ id: j.id, createdAt: j.created_at });
    for (const v of Array.from(jobsByClient.values())) v.sort((a: { createdAt: string }, b: { createdAt: string }) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return { clients, jobsByClient, byPhone };
  })();
  ctxMemo = { at: Date.now(), p };
  p.then((v) => { if (!v) ctxMemo = null; });
  return p;
}
const fullClient = (x: Ctx, id: string | null | undefined) => {
  if (!id) return null;
  const c = x.clients.get(id) ?? { id };
  return { ...c, jobs: { nodes: x.jobsByClient.get(id) ?? [] } };
};

/** Invoices issued in [from, to): the union of the weekly + metrics invoice node shapes. */
export async function mirrorInvoices(from: string, to: string): Promise<any[] | null> {
  if (!(await mirrorState()).ready) return null;
  const [rows, x] = await Promise.all([
    all((c) => c.from('jobber_invoices').select('data').not('issued_date', 'is', null).gte('issued_date', from).lt('issued_date', to).order('issued_date').order('id')),
    ctx(),
  ]);
  if (!rows || !x) return null;
  return rows.map((r) => ({ ...r.data, jobs: { nodes: (r.data.jobs?.nodes ?? []).slice(0, 1) }, client: fullClient(x, r.data.client?.id) }));
}

export async function mirrorQuotes(createdFrom: string, createdTo: string): Promise<any[] | null> {
  if (!(await mirrorState()).ready) return null;
  const rows = await all((c) => c.from('jobber_quotes').select('data').gte('created_at', createdFrom).lt('created_at', createdTo).order('created_at').order('id'));
  return rows ? rows.map((r) => r.data) : null;
}

export async function mirrorPayments(from: string, to: string): Promise<any[] | null> {
  if (!(await mirrorState()).ready) return null;
  const rows = await all((c) => c.from('jobber_payments').select('data').gte('entry_date', from).lt('entry_date', to).order('entry_date').order('id'));
  return rows ? rows.map((r) => r.data) : null;
}

export async function mirrorJobs(by: 'created_at' | 'completed_at', from: string, to: string): Promise<any[] | null> {
  if (!(await mirrorState()).ready) return null;
  const rows = await all((c) => c.from('jobber_jobs').select('data').gte(by, from).lt(by, to).order(by).order('id'));
  return rows ? rows.map((r) => r.data) : null;
}

export async function mirrorTimesheets(from: string, to: string): Promise<any[] | null> {
  if (!(await mirrorState()).ready || tsBlocked) return null;
  const rows = await all((c) => c.from('jobber_timesheets').select('data').gte('start_at', from).lt('start_at', to).order('start_at').order('id'));
  return rows ? rows.map((r) => r.data) : null;
}

/** Per-job: { createdAt, client.jobs, invoices } — the DashJobPaid shape. */
export async function mirrorJobsWithInvoices(jobIds: string[]): Promise<Map<string, any> | null> {
  if (!(await mirrorState()).ready) return null;
  const ids = Array.from(new Set(jobIds.filter(Boolean)));
  const x = await ctx(); if (!x) return null;
  const out = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 150) {
    const part = ids.slice(i, i + 150);
    const [jobs, invs] = await Promise.all([
      all((c) => c.from('jobber_jobs').select('id, client_id, created_at').in('id', part).order('id')),
      all((c) => c.from('jobber_invoices').select('job_ids, data').overlaps('job_ids', part).order('id')),
    ]);
    if (!jobs || !invs) return null;
    for (const j of jobs) out.set(j.id, { createdAt: j.created_at, client: fullClient(x, j.client_id), invoices: { nodes: invs.filter((v) => (v.job_ids ?? []).includes(j.id)).map((v) => v.data) } });
  }
  return out;
}

/** Earliest job createdAt (ms) over clients whose phone matches exactly; null = none. Same rule as the live search. */
export async function mirrorFirstJobByPhone(phones: string[]): Promise<Map<string, number | null> | null> {
  if (!(await mirrorState()).ready) return null;
  const x = await ctx(); if (!x) return null;
  const out = new Map<string, number | null>();
  for (const p of phones) {
    let f: number | null = null;
    for (const cid of x.byPhone.get(digits10(p)) ?? []) for (const j of x.jobsByClient.get(cid) ?? []) { const t = Date.parse(j.createdAt); if (Number.isFinite(t) && (f == null || t < f)) f = t; }
    out.set(p, f);
  }
  return out;
}

/** Jobs created since `after` with client phones + other job times (LiveJob shape). */
export async function mirrorJobsCreatedSince(after: string) {
  if (!(await mirrorState()).ready) return null;
  const [rows, x] = await Promise.all([all((c) => c.from('jobber_jobs').select('id, job_number, client_id, created_at').gte('created_at', after).order('created_at').order('id')), ctx()]);
  if (!rows || !x) return null;
  return rows.map((j) => ({
    id: j.id as string, jobNumber: (j.job_number ?? null) as number | null, createdAt: j.created_at as string,
    phones: ((x.clients.get(j.client_id)?.phones ?? []) as any[]).map((p) => digits10(p?.number)).filter((d) => d.length === 10),
    clientJobTimes: (x.jobsByClient.get(j.client_id) ?? []).filter((o) => o.id !== j.id).map((o) => Date.parse(o.createdAt)).filter(Number.isFinite),
  }));
}
