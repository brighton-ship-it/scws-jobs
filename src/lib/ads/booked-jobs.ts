/**
 * Offline conversion candidates at BOOKING time (job created in Jobber), for
 * NEW customers only. Replaces the invoice/paid trigger.
 *
 * Rules:
 *  - booked at = job.createdAt (a booked job / accepted quote creates the job).
 *  - floor: nothing before 2026-09-18 (tracking go-live, 00:00 PT).
 *  - the ad signal (ads call, click-id lead, google_ads lead) must precede the job.
 *  - repeat clients count when an ad signal falls after their most recent
 *    earlier job/issued invoice (ad-sourced repeat). Organic repeats skipped.
 *  - only the client's first booked job after the signal counts.
 *  - order_id = Jobber job id. Value = quote subtotal, else issued invoice
 *    pre-tax subtotal, else job total.
 */

import { hasStoredClickId, normalizeEmail, normalizePhone } from './book-job.ts';
import { sumIssuedInvoicePretax, type InvoiceAmountInput } from './invoice-value.ts';
import { stageValues, type StageValues } from './conversion-stages.ts';
import type { AdsPhoneHit, AttributedLead, OfflineCandidate, OfflineSignal } from './offline-import.ts';

export const BOOKED_FLOOR_ISO = '2026-09-18T07:00:00.000Z';

export interface ClientQuoteInput {
  id: string;
  status?: string | null;
  createdAt?: string | null;
  subtotal?: number | null;
}

export interface BookedJobInput {
  id: string;
  createdAt?: string | null;
  jobStatus?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  phones?: Array<string | null | undefined>;
  emails?: Array<string | null | undefined>;
  quoteSubtotal?: number | null;
  jobTotal?: number | null;
  invoices?: InvoiceAmountInput[] | null;
  /** All of the client's quotes (any status). Used for the approved-quote stage. */
  clientQuotes?: ClientQuoteInput[] | null;
}

export type ValueSource = 'quote_subtotal' | 'invoice_pretax' | 'job_total' | 'approved_quote';

export interface BookedCandidate extends OfflineCandidate {
  clientName: string | null;
  /** THIS job's own issued-invoice pre-tax total (not the client's other jobs). Call rows only. */
  ownInvoiceUsd?: number | null;
  /** THIS job's own quote subtotal (the quote that became this job, i.e. approved). Call rows only. */
  ownQuoteUsd?: number | null;
  stages: StageValues;
  valueSource: ValueSource;
}

export type ExclusionReason =
  | 'before_floor'
  | 'no_ads_signal'
  | 'signal_after_job'
  | 'existing_client'
  | 'repeat_job'
  | 'no_value';

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
  call?: AdsCallHit;
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
    if (Number.isFinite(at)) out.push({ at, kind: 'ads_call', lead: null, call });
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
      excluded.push({ jobId: job.id, clientName: job.clientName ?? null, bookedAt: job.createdAt ?? null, reason });
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
    if (firstBookedByClient.some((row) => sharesKey(keys, row.keys))) {
      ex('repeat_job');
      continue;
    }

    // Repeat customers count when an ad touch drove this job: the anchor is the
    // first ad signal after the client's most recent earlier job/issued invoice.
    // Organic repeats (no ad signal since their last job) stay excluded.
    let lastPrior = Number.NEGATIVE_INFINITY;
    for (const other of jobs) {
      if (other.job.id === job.id || !sharesKey(keys, other.keys)) continue;
      if (Number.isFinite(other.at) && other.at < at) lastPrior = Math.max(lastPrior, other.at);
      for (const inv of other.job.invoices ?? []) {
        const issued = ms(inv.issuedDate);
        if (Number.isFinite(issued) && issued < at && sumIssuedInvoicePretax([inv]) != null)
          lastPrior = Math.max(lastPrior, issued);
      }
    }
    const fresh = before.filter((s) => s.at > lastPrior);
    if (!fresh.length) {
      ex('existing_client');
      continue;
    }
    const anchor = fresh[0].at;

    const priced = bookedValue(job);
    if (!priced) {
      ex('no_value');
      continue;
    }
    firstBookedByClient.push({ keys, anchor });

    // Stages 2 and 3 look at the whole client, not just this job: the big
    // quote is usually a separate quote/job created after the service call.
    const clientJobs = jobs.filter((o) => o.job.id === job.id || sharesKey(keys, o.keys)).map((o) => o.job);
    const stages = stageValues({
      bookingValue: priced.valueUsd,
      anchorMs: anchor,
      quotes: job.clientQuotes ?? [],
      invoices: clientJobs.flatMap((j) => j.invoices ?? []),
    });

    const pick = fresh.find((s) => s.lead && hasStoredClickId(s.lead)) ?? fresh[0];
    const lead = pick.lead ?? fresh.find((s) => s.lead)?.lead ?? null;
    const phone = (job.phones ?? []).map(normalizePhone).find(Boolean) ?? null;
    const email = (job.emails ?? []).map(normalizeEmail).find(Boolean) ?? null;
    candidates.push({
      jobberJobId: job.id,
      invoiceIds: [],
      conversionAt: new Date(at).toISOString(),
      valueUsd: priced.valueUsd,
      valueSource: priced.valueSource,
      stages,
      ownInvoiceUsd: sumIssuedInvoicePretax(job.invoices) ?? null,
      ownQuoteUsd: positive(job.quoteSubtotal),
      clientName: job.clientName ?? null,
      gclid: lead?.gclid ?? null,
      gbraid: lead?.gbraid ?? null,
      wbraid: lead?.wbraid ?? null,
      email: lead?.email || email,
      phone: lead?.phone || phone,
      signal: pick.kind,
      campaign: lead?.utm_campaign ?? null,
      keyword: lead?.utm_term ?? null,
      callerPhone: pick.kind === 'ads_call' ? normalizePhone(pick.call?.phone) ?? null : null,
      callStartedAt: pick.kind === 'ads_call' && pick.call?.startedAt ? new Date(pick.at).toISOString() : null,
    });
  }
  return { candidates, excluded };
}
