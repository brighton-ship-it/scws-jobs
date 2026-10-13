import { unstable_cache } from 'next/cache';
/** Server-side loaders for the call dashboard, with small in-memory caches. */
import {
  googleAdsConfig, googleAdsSearch, refreshGoogleAccessToken, searchResultRows, costMicrosToUsd,
} from './google-ads-api.ts';
import { assertNoJobberErrors, jobberGraphql } from '../jobber/client.ts';
import { mirrorJobsWithInvoices, mirrorFirstJobByPhone, mirrorJobsCreatedSince } from '../jobber-mirror/read.ts';
import { invoicePretaxUsd } from './invoice-value.ts';
import { ptDateKey, DASH_FLOOR_ISO, type SpendDay, type JobMoney } from './call-dashboard.ts';

const SPEND_TTL_MS = 30 * 60_000;
const PAID_TTL_MS = 10 * 60_000;
let spendCache: { at: number; key: string; rows: SpendDay[] } | null = null;
const paidCache = new Map<string, { at: number; paid: number; money: JobMoney }>();

export function dailySpendGaql(from: string, to: string): string {
  return `SELECT campaign.name, segments.date, metrics.cost_micros, metrics.clicks FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status != 'REMOVED'`;
}

/** Daily campaign cost since the tracking floor (or 90 days, whichever is earlier). Cached 30 min. */
export async function loadDailySpend(now = new Date()): Promise<SpendDay[] | null> {
  const config = googleAdsConfig();
  if (!config) return null;
  const from = ptDateKey(new Date(Math.min(Date.parse(DASH_FLOOR_ISO), now.getTime() - 90 * 86400_000)));
  const to = ptDateKey(now);
  const key = `${from}|${to}`;
  if (spendCache && spendCache.key === key && Date.now() - spendCache.at < SPEND_TTL_MS) return spendCache.rows;
  try {
    const token = await refreshGoogleAccessToken(config);
    const payload = await googleAdsSearch(config, dailySpendGaql(from, to), fetch, token);
    const rows: SpendDay[] = [];
    for (const r of searchResultRows(payload)) {
      const campaign = (r.campaign as { name?: string } | undefined)?.name;
      const date = (r.segments as { date?: string } | undefined)?.date;
      const m = r.metrics as { costMicros?: unknown; cost_micros?: unknown; clicks?: unknown } | undefined;
      const costUsd = costMicrosToUsd(m?.costMicros ?? m?.cost_micros);
      if (campaign && date) rows.push({ date, campaign, costUsd, clicks: Number(m?.clicks ?? 0) || 0 });
    }
    spendCache = { at: Date.now(), key, rows };
    return rows;
  } catch (error) {
    console.warn('[call-dashboard] spend failed:', error instanceof Error ? error.message : 'error');
    return spendCache?.rows ?? null;
  }
}

const JOB_PAID_QUERY = `
  query DashJobPaid($id: EncodedId!) {
    job(id: $id) {
      createdAt
      client { jobs(first: 10) { nodes { id createdAt } } }
      invoices(first: 20) {
        nodes { id invoiceStatus issuedDate amounts { subtotal total taxAmount paymentsTotal } }
      }
    }
  }
`;

/** Live Jobber money per booked job: pre-tax invoiced, pre-tax paid share, and whether every invoice is paid in full. */
export async function loadJobMoney(jobIds: string[]): Promise<Map<string, JobMoney> | null> {
  const out = new Map<string, JobMoney>();
  const mir = await mirrorJobsWithInvoices(jobIds).catch(() => null);
  if (mir) { for (const id of jobIds) { const j = mir.get(id); if (j) out.set(id, jobMoneyFrom(id, j)); } return out; }
  const todo = jobIds.filter((id) => {
    const hit = paidCache.get(id);
    if (hit && Date.now() - hit.at < PAID_TTL_MS) { out.set(id, hit.money); return false; }
    return true;
  });
  let failed = 0;
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async (id) => {
      try {
        const res = await jobberGraphql(JOB_PAID_QUERY, { id });
        assertNoJobberErrors(res, 'dashboard job paid');
        const money = jobMoneyFrom(id, res.data?.job);
        const paid = money.paid;
        paidCache.set(id, { at: Date.now(), paid, money });
        out.set(id, money);
      } catch (error) {
        failed += 1;
        console.warn('[call-dashboard] paid failed:', error instanceof Error ? error.message : 'error');
      }
    }));
  }
  if (todo.length > 0 && failed === todo.length && out.size === 0) return null;
  return out;
}

function jobMoneyFrom(id: string, job: any): JobMoney {
        const nodes = job?.invoices?.nodes ?? [];
        let paid = 0, invoiced = 0, invoiceCount = 0, fullyPaid = true;
        for (const inv of nodes) {
          const pre = invoicePretaxUsd(inv);
          if (!pre) continue; // drafts / void / bad debt are not revenue
          invoiceCount += 1;
          invoiced += pre;
          const total = inv?.amounts?.total;
          const pay = inv?.amounts?.paymentsTotal;
          if (typeof total === 'number' && total > 0 && typeof pay === 'number' && pay > 0) {
            paid += Math.min(pay, total) * (pre / total);
          }
          if (!(typeof total === 'number' && typeof pay === 'number' && pay >= total - 0.01)) fullyPaid = false;
        }
        paid = Math.round(paid * 100) / 100;
        const priorJobTimes = (job?.client?.jobs?.nodes ?? [])
          .filter((j: any) => j?.id !== id).map((j: any) => Date.parse(j?.createdAt || '')).filter(Number.isFinite);
        const money: JobMoney = { invoiced: Math.round(invoiced * 100) / 100, paid, invoiceCount, fullyPaid: invoiceCount > 0 && fullyPaid, clientJobTimes: priorJobTimes };
        return money;
}

/** Back-compat: pre-tax paid dollars per job. */
export async function loadPaidByJob(jobIds: string[]): Promise<Map<string, number> | null> {
  const m = await loadJobMoney(jobIds);
  return m ? new Map(Array.from(m.entries()).map(([k, v]) => [k, v.paid])) : null;
}

const CLIENT_BY_PHONE = `
  query DashClientByPhone($q: String!) {
    clients(searchTerm: $q, first: 5) { nodes { phones { number } jobs(first: 25) { nodes { createdAt } } } }
  }
`;
const FIRST_JOB_TTL_MS = 6 * 3600_000;
const firstJobCache = new Map<string, { at: number; v: number | null }>();
const digits = (s: string | null | undefined) => { const d = (s ?? '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('1') ? d.slice(1) : d; };

/** Earliest Jobber job createdAt (ms) for clients whose phone matches exactly; null = no such client/job.
 *  Phones not resolved within the time budget (or on Jobber error) are left out (= unknown). Cached 6 h. */
export async function loadFirstJobByPhone(phones: string[], budgetMs = 60_000, cached?: Map<string, number | null>): Promise<Map<string, number | null>> {
  const mir = await mirrorFirstJobByPhone(Array.from(new Set(phones))).catch(() => null);
  if (mir) return mir;
  const out = new Map<string, number | null>();
  const t0 = Date.now();
  const todo: string[] = [];
  for (const p of Array.from(new Set(phones))) {
    const hit = firstJobCache.get(p);
    if (hit && Date.now() - hit.at < FIRST_JOB_TTL_MS) out.set(p, hit.v);
    else if (cached?.has(p)) out.set(p, cached.get(p)!);
    else todo.push(p);
  }
  for (let i = 0; i < todo.length && Date.now() - t0 < budgetMs; i += 1) {
    await Promise.all(todo.slice(i, i + 1).map(async (p) => {
      try {
        // Shared Vercel data cache (all instances): each phone hits Jobber at most once per 6 h.
        const first = await unstable_cache(async () => {
          const res = await jobberGraphql(CLIENT_BY_PHONE, { q: p });
          assertNoJobberErrors(res, 'dashboard client by phone'); // throws => not cached
          let f: number | null = null;
          for (const c of res.data?.clients?.nodes ?? []) {
            if (!(c?.phones ?? []).some((x: any) => digits(x?.number) === p)) continue;
            for (const j of c?.jobs?.nodes ?? []) { const t = Date.parse(j?.createdAt || ''); if (Number.isFinite(t) && (f == null || t < f)) f = t; }
          }
          return f;
        }, ['dash-firstjob-v1', p], { revalidate: 21600 })();
        out.set(p, first); firstJobCache.set(p, { at: Date.now(), v: first });
      } catch { /* unknown */ }
    }));
  }
  return out;
}

const JOBS_CREATED_LIVE = `
  query DashJobsCreatedLive($filter: JobFilterAttributes, $cursor: String) {
    jobs(first: 20, after: $cursor, filter: $filter) {
      nodes { id jobNumber createdAt client { phones { number } jobs(first: 10) { nodes { id createdAt } } } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
export interface LiveJob { id: string; jobNumber: number | null; createdAt: string; phones: string[]; clientJobTimes: number[] }
/** Jobber jobs created since `after` (live; the offline-conversion table only refreshes nightly). */
export async function loadJobsCreatedSince(after: string): Promise<LiveJob[] | null> {
  const mir = await mirrorJobsCreatedSince(after).catch(() => null); if (mir) return mir;
  // Shared across instances for 10 min so dashboard refreshes don't each re-pull Jobber.
  const bucket = Math.floor(Date.now() / 600_000);
  try { return await unstable_cache(async () => { const r = await loadJobsCreatedSinceRaw(after); if (!r) throw new Error('live jobs failed'); return r; }, ['dash-livejobs-v1', after, String(bucket)], { revalidate: 600 })(); }
  catch { return null; }
}
async function loadJobsCreatedSinceRaw(after: string): Promise<LiveJob[] | null> {
  try {
    const out: LiveJob[] = []; let cursor: string | null = null;
    for (let i = 0; i < 15; i++) {
      const res: any = await jobberGraphql(JOBS_CREATED_LIVE, { filter: { createdAt: { after } }, cursor });
      assertNoJobberErrors(res, 'dashboard live jobs');
      for (const j of res.data?.jobs?.nodes ?? []) out.push({
        id: j.id, jobNumber: j.jobNumber ?? null, createdAt: j.createdAt,
        phones: (j.client?.phones ?? []).map((p: any) => digits(p?.number)).filter((d: string) => d.length === 10),
        clientJobTimes: (j.client?.jobs?.nodes ?? []).filter((x: any) => x?.id !== j.id).map((x: any) => Date.parse(x?.createdAt || '')).filter(Number.isFinite),
      });
      const pi = res.data?.jobs?.pageInfo; if (!pi?.hasNextPage) break; cursor = pi.endCursor;
    }
    return out;
  } catch (e) { console.warn('[call-dashboard] live jobs failed:', e instanceof Error ? e.message : e); return null; }
}
