/**
 * Full-history customer value: static pre-Jobber QuickBooks sales (Oct 2020 – Feb 2025, src/data/qbo-ltv-history.json)
 * merged with live Jobber invoices. Mirrors /workspace/qc/ltv-full/ltv.py: exact normalized-name match (client name or
 * company), QuickBooks invoices dated Feb 25+ 2025 dropped when Jobber has the same amount within 3 days.
 */
import { ptDateKey } from './call-dashboard.ts';
import { workCategory } from './work-category.ts';
import { isInternalJob } from './internal-job.ts';

/** [normalizedName, drillingFlag 0|1, [[yyyy-mm-dd, pretaxUsd, invoiceNo (only for Feb 25+ 2025)], ...]] */
export type QboCustomer = [string, number, Array<[string, number] | [string, number, string]>];
export interface QboHistory { source: string; customers: QboCustomer[] }
export interface LtvInvoice { id: string; invoiceStatus?: string | null; issuedDate?: string | null; subject?: string | null; amounts?: { subtotal?: number | null; discountAmount?: number | null } | null; client?: { id?: string | null; name?: string | null; companyName?: string | null } | null; jobs?: { nodes?: Array<{ title?: string | null } | null> | null } | null }

export function normName(n?: string | null): string {
  let s = (n || '').toLowerCase().replace(/&/g, ' and ');
  s = s.replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(inc|llc|the|mr|mrs|ms|dr|and)\b/g, ' ');
  return s.split(/\s+/).filter(Boolean).sort().join(' ');
}
const CUTOVER = '2025-02-25';
const DAY = 86400_000;
const dnum = (k: string) => Date.parse(`${k}T00:00:00Z`) / DAY;

export interface Tx { d: string; a: number }
export interface FullCustomer { key: string; dept: 'pump' | 'drilling'; source: 'qbo' | 'jobber' | 'both'; rev: number; dates: string[]; tx: Tx[] }
export interface FullLtv {
  customers: FullCustomer[]; all: Tx[][]; keys: string[];
  matched: number; qboCustomers: number; jobberCustomers: number; droppedDupes: number; droppedDupeUsd: number;
}

export function mergeFullHistory(qbo: QboHistory, jobber: LtvInvoice[]): FullLtv {
  const seen = new Set<string>();
  const J = new Map<string, { tx: Array<Tx & { s: string }>; name: string; co?: string | null }>();
  for (const i of jobber) {
    const st = (i.invoiceStatus || '').toLowerCase();
    const cid = i.client?.id;
    if (['draft', 'void', 'bad_debt'].includes(st) || !i.issuedDate || !cid || seen.has(i.id) || isInternalJob(i)) continue;
    seen.add(i.id);
    const a = (i.amounts?.subtotal ?? 0) - (i.amounts?.discountAmount ?? 0);
    const c = J.get(cid) ?? { tx: [], name: '' };
    c.tx.push({ d: ptDateKey(new Date(i.issuedDate)), a, s: i.subject || '' });
    c.name = i.client?.name || i.client?.companyName || ''; c.co = i.client?.companyName;
    J.set(cid, c);
  }
  const idx = new Map<string, string[]>();
  const add = (k: string, id: string) => { const l = idx.get(k) ?? []; if (!l.includes(id)) l.push(id); idx.set(k, l); };
  J.forEach((c, id) => { const n = normName(c.name); add(n, id); if (c.co && normName(c.co) !== n) add(normName(c.co), id); });

  const cust = new Map<string, { q: Tx[]; j: Array<Tx & { s: string }>; qdr: boolean }>();
  let matched = 0, droppedDupes = 0, droppedDupeUsd = 0;
  qbo.customers.forEach(([n, dr, inv], ix) => {
    const m = idx.get(n)?.[0];
    let rows = inv.map((e) => ({ d: e[0], a: e[1], num: e[2] }));
    if (m) {
      matched++;
      const jv = J.get(m)!.tx; const late = new Map<string, { a: number; d: string }>();
      for (const r of rows) if (r.d >= CUTOVER && r.num != null) { const x = late.get(r.num); late.set(r.num, { a: (x?.a ?? 0) + r.a, d: r.d }); }
      late.forEach((x, num) => {
        if (jv.some((y) => Math.abs(y.a - x.a) < 0.01 && Math.abs(dnum(y.d) - dnum(x.d)) <= 3)) {
          rows = rows.filter((r) => !(r.num === num && r.d >= CUTOVER)); droppedDupes++; droppedDupeUsd += x.a;
        }
      });
    }
    const key = m ?? `Q:${ix}`;
    const c = cust.get(key) ?? { q: [], j: [], qdr: false };
    c.q.push(...rows.map((r) => ({ d: r.d, a: r.a }))); c.qdr = c.qdr || dr === 1;
    cust.set(key, c);
  });
  J.forEach((v, id) => { const c = cust.get(id) ?? { q: [], j: [], qdr: false }; c.j.push(...v.tx); cust.set(id, c); });

  const customers: FullCustomer[] = []; const all: Tx[][] = []; const keys: string[] = [];
  cust.forEach((c, key) => {
    const tx = [...c.q, ...c.j.map((x) => ({ d: x.d, a: x.a }))];
    all.push(tx); keys.push(key);
    const rev = tx.reduce((s, x) => s + x.a, 0);
    if (rev <= 0) return;
    const dates = Array.from(new Set(tx.filter((x) => x.a > 0).map((x) => x.d))).sort();
    const dept = c.qdr || c.j.some((x) => workCategory(x.s) === 'drilling') ? 'drilling' : 'pump';
    customers.push({ key, dept, source: c.j.length ? (c.q.length ? 'both' : 'jobber') : 'qbo', rev, dates, tx });
  });
  return { customers, all, keys, matched, qboCustomers: qbo.customers.length, jobberCustomers: J.size, droppedDupes, droppedDupeUsd };
}

export interface Summary { n: number; total: number; avg: number | null; median: number | null; repeat60: number; repeatRate: number | null }
export function summarize(cs: FullCustomer[]): Summary {
  const v = cs.map((c) => c.rev).sort((a, b) => a - b); const n = v.length;
  const total = v.reduce((s, x) => s + x, 0);
  const median = n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null;
  const repeat60 = cs.filter((c) => c.dates.length > 1 && dnum(c.dates[c.dates.length - 1]) - dnum(c.dates[0]) >= 60).length;
  return { n, total, avg: n ? total / n : null, median, repeat60, repeatRate: n ? repeat60 / n : null };
}

/** Cohort = customers with revenue in [a0, a1); NRR = their spend in [a1, b1) ÷ their spend in [a0, a1). */
export function nrrWindow(f: FullLtv, a0: string, a1: string, b1: string, dept?: 'pump' | 'drilling') {
  const deptOf = new Map(f.customers.map((c) => [c.key, c.dept]));
  let prior = 0, next = 0, k = 0, kept = 0;
  f.all.forEach((tx, i) => {
    if (dept && deptOf.get(f.keys[i]) !== dept) return;
    let A = 0, B = 0;
    for (const x of tx) { if (x.d >= a0 && x.d < a1) A += x.a; else if (x.d >= a1 && x.d < b1) B += x.a; }
    if (A > 0) { prior += A; next += B; k++; if (B > 0) kept++; }
  });
  return { prior, next, customers: k, retained: kept, nrr: prior > 0 ? next / prior : null };
}
