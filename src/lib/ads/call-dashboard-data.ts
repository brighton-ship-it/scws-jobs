/** Server-side loaders for the call dashboard, with small in-memory caches. */
import {
  googleAdsConfig, googleAdsSearch, refreshGoogleAccessToken, searchResultRows, costMicrosToUsd,
} from './google-ads-api.ts';
import { assertNoJobberErrors, jobberGraphql } from '../jobber/client.ts';
import { invoicePretaxUsd } from './invoice-value.ts';
import { ptDateKey, DASH_FLOOR_ISO, type SpendDay } from './call-dashboard.ts';

const SPEND_TTL_MS = 30 * 60_000;
const PAID_TTL_MS = 10 * 60_000;
let spendCache: { at: number; key: string; rows: SpendDay[] } | null = null;
const paidCache = new Map<string, { at: number; paid: number }>();

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
      invoices(first: 20) {
        nodes { id invoiceStatus issuedDate amounts { subtotal total taxAmount paymentsTotal } }
      }
    }
  }
`;

/** Pre-tax paid dollars per job (payments scaled to the pre-tax share of each invoice). */
export async function loadPaidByJob(jobIds: string[]): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  const todo = jobIds.filter((id) => {
    const hit = paidCache.get(id);
    if (hit && Date.now() - hit.at < PAID_TTL_MS) { out.set(id, hit.paid); return false; }
    return true;
  });
  let failed = 0;
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async (id) => {
      try {
        const res = await jobberGraphql(JOB_PAID_QUERY, { id });
        assertNoJobberErrors(res, 'dashboard job paid');
        const nodes = res.data?.job?.invoices?.nodes ?? [];
        let paid = 0;
        for (const inv of nodes) {
          const pre = invoicePretaxUsd(inv);
          const total = inv?.amounts?.total;
          const pay = inv?.amounts?.paymentsTotal;
          if (pre && typeof total === 'number' && total > 0 && typeof pay === 'number' && pay > 0) {
            paid += Math.min(pay, total) * (pre / total);
          }
        }
        paid = Math.round(paid * 100) / 100;
        paidCache.set(id, { at: Date.now(), paid });
        out.set(id, paid);
      } catch (error) {
        failed += 1;
        console.warn('[call-dashboard] paid failed:', error instanceof Error ? error.message : 'error');
      }
    }));
  }
  if (todo.length > 0 && failed === todo.length && out.size === 0) return null;
  return out;
}
