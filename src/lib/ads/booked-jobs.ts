/**
 * Offline conversion candidates at BOOKING time (job created in Jobber), for
 * NEW customers only. Replaces the invoice/paid trigger.
 *
 * Rules:
 *  - booked at = job.createdAt (a booked job / accepted quote creates the job).
 *  - floor: nothing before 2026-09-18 (tracking go-live, 00:00 PT).
 *  - the ad signal (ads call, click-id lead, google_ads lead) must precede the job.
 *  - existing client: another job, or an issued invoice, for the same client
 *    dated before the first ad signal. Skipped.
 *  - only the client's first booked job after the signal counts.
 *  - order_id = Jobber job id. Value = quote subtotal, else issued invoice
 *    pre-tax subtotal, else job total.
 */

import { hasStoredClickId, normalizeEmail, normalizePhone } from './book-job.ts';
import { sumIssuedInvoicePretax, type InvoiceAmountInput } from './invoice-value.ts';
import type { AdsPhoneHit, AttributedLead, OfflineCandidate, OfflineSignal } from './offline-import.ts';

export const BOOKED_FLOOR_ISO = '2026-09-18T07:00:00.000Z';

export interface BookedJobInput {
  id: string;
  createdAt: string | null;
  jobStatus?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  phones?: Array<string | null | undefined>;
  emails?: Array<string | null | undefined>;
  quoteSubtotal?: number | null;
  jobTotal?: number | null;
  invoices?: InvoiceAmountInput[] | null;
}

export type ValueSource = 'quote_subtotal' | 'invoice_pretax' | 'job_total';

export interface BookedCandidate extends OfflineCandidate {
  clientName: string | null;
  valueSource: ValueSource;
}

export type ExclusionReason =
  | 'before_floor'
  | 'no_ads_signal'
  | 'signal_after_job'
  | 'existing_client'
  | 'repeat_job'
  | 'no_value'
  | 'archived';

export interface BookedExclusion {
  jobId: string;
  clientName: string | null;
  bookedAt: string | null;
  reason: ExclusionReason;
}

export interface AdsCallHit extends AdsPhoneHit {
  startedAt?: string | null;
}

function ms(value: string | null | undefined): number {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : Number.NaN;
}

function positive(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function bookedValue(job: BookedJobInput): { valueUsd: number; valueSource: ValueSource } | null {
  const quote = positive(job.quoteSubtotal);
  if (quote) return { valueUsd: quote, valueSource: 'quote_subtotal' };
  const invoice = sumIssuedInvoicePretax(job.invoices);
  if (invoice) return { valueUsd: invoice, valueSource: 'invoice_pretax' };
  const total = positive(job.jobTotal);
  if (total) return { valueUsd: total, valueSource: 'job_total' };
  return null;
}

function keysOf(job: BookedJobInput): Set<string> {
  const keys = new Set<string>();
  if (job.clientId) keys.add(`c:${job.clientId}`);
  for (const p of job.phones ?? []) {
    const n = normalizePhone(p);
    if (n) keys.add(`p:${n}`);
  }
  for (const e of job.emails ?? []) {
    const n = normalizeEmail(e);
    if (n) keys.add(`e:${n}`);
  }
  return keys;
}

function sharesKey(a: Set<string>, b: Set<string>): boolean {
  for (const k of Array.from(a)) if (b.has(k)) return true;
  return false;
}

interface Signal {
  at: number;
  kind: OfflineSignal;
  lead: AttributedLead | null;
}

function signalsFor(
  keys: Set<string>,
  leads: AttributedLead[],
  calls: AdsCallHit[]
): Signal[] {
  const out: Signal[] = [];
  for (const lead of leads) {
    const p = normalizePhone(lead.phone);
    const e = normalizeEmail(lead.email);
    if (!((p && keys.has(`p:${p}`)) || (e && keys.has(`e:${e}`)))) continue;
    const at = ms(lead.created_at);
    if (!Number.isFinite(at)) continue;
    if (hasStoredClickId(lead)) out.push({ at, kind: 'click_id', lead });
    else if ((lead.lead_source || '').trim().toLowerCase() === 'google_ads') out.push({ at, kind: 'google_ads_lead', lead });
  }
  for (const call of calls) {
    const p = normalizePhone(call.phone);
    if (!p || !keys.has(`p:${p}`)) continue;
    const at = ms(call.startedAt);
    if (Number.isFinite(at)) out.push({ at, kind: 'ads_call', lead: null });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function candidatesFromBookedJobs(input: {
  jobs: BookedJobInput[];
  leads: AttributedLead[];
  adsCalls: AdsCallHit[];
  floorIso?: string;
}): { candidates: BookedCandidate[]; excluded: BookedExclusion[] } {
  const floor = ms(input.floorIso ?? BOOKED_FLOOR_ISO);
  const jobs = input.jobs.map((job) => ({ job, keys: keysOf(job), at: ms(job.createdAt) }));
  const candidates: BookedCandidate[] = [];
  const excluded: BookedExclusion[] = [];
  const firstBookedByClient: Array<{ keys: Set<string>; anchor: number }> = [];

  const ordered = [...jobs].sort((a, b) => a.at - b.at);
  for (const { job, keys, at } of ordered) {
    if (!Number.isFinite(at) || at < floor) continue; // pre-floor jobs are not reported one by one
    const ex = (reason: ExclusionReason) =>
      excluded.push({ jobId: job.id, clientName: job.clientName ?? null, bookedAt: job.createdAt, reason });
    if ((job.jobStatus || '').toLowerCase() === 'archived') {
      ex('archived');
      continue;
    }
    const signals = signalsFor(keys, input.leads, input.adsCalls);
    if (!signals.length) {
      ex('no_ads_signal');
      continue;
    }
    const before = signals.filter((s) => s.at <= at);
    if (!before.length) {
      ex('signal_after_job');
      continue;
    }
    const anchor = before[0].at;

    const existing = jobs.some((other) => {
      if (other.job.id === job.id || !sharesKey(keys, other.keys)) return false;
      if (Number.isFinite(other.at) && other.at < anchor) {
        return (other.job.jobStatus || '').toLowerCase() !== 'archived' || Boolean(sumIssuedInvoicePretax(other.job.invoices));
      }
      return (other.job.invoices ?? []).some((inv) => {
        const issued = ms(inv.issuedDate);
        return Number.isFinite(issued) && issued < anchor && sumIssuedInvoicePretax([inv]) != null;
      });
    });
    if (existing) {
      ex('existing_client');
      continue;
    }

    if (firstBookedByClient.some((row) => sharesKey(keys, row.keys))) {
      ex('repeat_job');
      continue;
    }

    const priced = bookedValue(job);
    if (!priced) {
      ex('no_value');
      continue;
    }
    firstBookedByClient.push({ keys, anchor });

    const pick = before.find((s) => s.lead && hasStoredClickId(s.lead)) ?? before[0];
    const lead = pick.lead ?? before.find((s) => s.lead)?.lead ?? null;
    const phone = (job.phones ?? []).map(normalizePhone).find(Boolean) ?? null;
    const email = (job.emails ?? []).map(normalizeEmail).find(Boolean) ?? null;
    candidates.push({
      jobberJobId: job.id,
      invoiceIds: [],
      conversionAt: new Date(at).toISOString(),
      valueUsd: priced.valueUsd,
      valueSource: priced.valueSource,
      clientName: job.clientName ?? null,
      gclid: lead?.gclid ?? null,
      gbraid: lead?.gbraid ?? null,
      wbraid: lead?.wbraid ?? null,
      email: lead?.email || email,
      phone: lead?.phone || phone,
      signal: pick.kind,
      campaign: lead?.utm_campaign ?? null,
      keyword: lead?.utm_term ?? null,
    });
  }
  return { candidates, excluded };
}
