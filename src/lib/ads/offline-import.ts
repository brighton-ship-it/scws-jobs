/**
 * Nightly won-job upload. Dry-run is the default: rows are recorded and
 * Google Ads is not called. Live mode is ADS_OFFLINE_UPLOAD=live.
 *
 * A phone number alone is not an ads conversion. The job needs a stored click
 * id, a google_ads lead, or a matched ads call.
 */

import { buildClickConversion, type ClickConversion } from './offline-conversion.ts';
import { hasStoredClickId, normalizeEmail, normalizePhone, type WebsiteLead } from './book-job.ts';
import { invoicePretaxUsd, type InvoiceAmountInput } from './invoice-value.ts';

export type OfflineUploadMode = 'dry_run' | 'live';

export function offlineUploadMode(env: Record<string, string | undefined> = process.env): OfflineUploadMode {
  return env.ADS_OFFLINE_UPLOAD?.trim().toLowerCase() === 'live' ? 'live' : 'dry_run';
}

export type OfflineSignal = 'click_id' | 'google_ads_lead' | 'ads_call';

export interface AttributedLead extends WebsiteLead {
  lead_source?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
}

export interface AdsPhoneHit {
  phone: string | null;
  campaign?: string | null;
}

export interface WonInvoiceInput extends InvoiceAmountInput {
  id?: string | null;
  createdAt?: string | null;
  jobIds?: string[] | null;
  email?: string | null;
  phone?: string | null;
}

export interface OfflineCandidate {
  jobberJobId: string;
  invoiceIds: string[];
  conversionAt: string;
  valueUsd: number;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  email: string | null;
  phone: string | null;
  signal: OfflineSignal;
  campaign: string | null;
  keyword: string | null;
}

function stampOf(invoice: WonInvoiceInput): number {
  const raw = invoice.issuedDate || invoice.createdAt || '';
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoOf(invoice: WonInvoiceInput): string {
  const raw = invoice.issuedDate || invoice.createdAt;
  if (!raw) return new Date(0).toISOString();
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return new Date(0).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T12:00:00.000Z`;
  return new Date(parsed).toISOString();
}

function signalFor(
  lead: AttributedLead | null,
  adsCall: boolean
): OfflineSignal | null {
  if (lead && hasStoredClickId(lead)) return 'click_id';
  if ((lead?.lead_source || '').trim().toLowerCase() === 'google_ads') return 'google_ads_lead';
  if (adsCall) return 'ads_call';
  return null;
}

export function candidatesFromInvoices(input: {
  invoices: WonInvoiceInput[];
  leads: AttributedLead[];
  adsPhones?: AdsPhoneHit[];
  now?: Date;
}): OfflineCandidate[] {
  const now = input.now ?? new Date();
  const byJob = new Map<string, WonInvoiceInput[]>();
  for (const invoice of input.invoices) {
    const value = invoicePretaxUsd(invoice);
    if (value == null) continue;
    for (const jobId of invoice.jobIds ?? []) {
      if (!jobId) continue;
      const list = byJob.get(jobId) ?? [];
      list.push(invoice);
      byJob.set(jobId, list);
    }
  }

  const adsPhones = new Set(
    (input.adsPhones ?? [])
      .map((row) => normalizePhone(row.phone))
      .filter((phone): phone is string => Boolean(phone))
  );

  const candidates: OfflineCandidate[] = [];
  for (const [jobberJobId, invoices] of Array.from(byJob.entries())) {
    const sorted = [...invoices].sort((a, b) => stampOf(a) - stampOf(b));
    const latest = sorted[sorted.length - 1];
    const phone = normalizePhone(latest.phone) || sorted.map((row) => normalizePhone(row.phone)).find(Boolean) || null;
    const email = normalizeEmail(latest.email) || sorted.map((row) => normalizeEmail(row.email)).find(Boolean) || null;
    const match = matchLead(input.leads, phone, email, now);
    const adsCall = Boolean(phone && adsPhones.has(phone));
    const signal = signalFor(match, adsCall);
    if (!signal) continue;
    const valueUsd = sorted.reduce((sum, invoice) => sum + (invoicePretaxUsd(invoice) ?? 0), 0);
    if (!(valueUsd > 0)) continue;
    candidates.push({
      jobberJobId,
      invoiceIds: sorted.map((invoice) => invoice.id).filter((id): id is string => Boolean(id)),
      conversionAt: isoOf(latest),
      valueUsd: Math.round(valueUsd * 100) / 100,
      gclid: match?.gclid ?? null,
      gbraid: match?.gbraid ?? null,
      wbraid: match?.wbraid ?? null,
      email: match?.email || email,
      phone: match?.phone || phone,
      signal,
      campaign: match?.utm_campaign ?? null,
      keyword: match?.utm_term ?? null,
    });
  }
  return candidates;
}

function matchLead(
  leads: AttributedLead[],
  phone: string | null,
  email: string | null,
  now: Date
): AttributedLead | null {
  const cutoff = now.getTime() - 90 * 24 * 60 * 60 * 1000;
  const ranked = leads
    .map((lead) => ({
      lead,
      phone: normalizePhone(lead.phone),
      email: normalizeEmail(lead.email),
      created: Date.parse(lead.created_at),
    }))
    .filter((row) => Number.isFinite(row.created) && row.created >= cutoff)
    .filter((row) => (phone && row.phone === phone) || (email && row.email === email))
    .sort((a, b) => b.created - a.created);
  return ranked[0]?.lead ?? null;
}

export interface OfflineExistingRow {
  jobber_job_id: string;
  status: string;
}

export interface OfflinePlanRow {
  jobber_job_id: string;
  invoice_ids: string;
  conversion_at: string;
  value_usd: number;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  signal: OfflineSignal;
  status: 'dry_run' | 'uploaded' | 'error' | 'skipped';
  mode: OfflineUploadMode;
  payload: ClickConversion | null;
  error: string | null;
  google_response?: unknown;
}

export function planOfflineRows(input: {
  candidates: OfflineCandidate[];
  existing: OfflineExistingRow[];
  mode: OfflineUploadMode;
  conversionAction: string | null;
}): { rows: OfflinePlanRow[]; toUpload: ClickConversion[] } {
  const existing = new Map(input.existing.map((row) => [row.jobber_job_id, row.status]));
  const rows: OfflinePlanRow[] = [];
  const toUpload: ClickConversion[] = [];

  for (const candidate of input.candidates) {
    const status = existing.get(candidate.jobberJobId);
    if (status === 'uploaded') continue;

    const action = input.conversionAction || 'customers/0/conversionActions/0';
    const payload = buildClickConversion(action, candidate);
    if (!payload) {
      rows.push({
        jobber_job_id: candidate.jobberJobId,
        invoice_ids: candidate.invoiceIds.join(','),
        conversion_at: candidate.conversionAt,
        value_usd: candidate.valueUsd,
        gclid: candidate.gclid,
        gbraid: candidate.gbraid,
        wbraid: candidate.wbraid,
        signal: candidate.signal,
        status: 'skipped',
        mode: input.mode,
        payload: null,
        error: 'nothing_to_match',
      });
      continue;
    }

    if (input.mode !== 'live') {
      rows.push(rowFrom(candidate, 'dry_run', input.mode, payload, null));
      continue;
    }

    if (!input.conversionAction) {
      rows.push(rowFrom(candidate, 'error', input.mode, payload, 'GOOGLE_ADS_OFFLINE_CONVERSION_ACTION is not set'));
      continue;
    }

    rows.push(rowFrom(candidate, 'uploaded', input.mode, payload, null));
    toUpload.push(payload);
  }

  return { rows, toUpload };
}

function rowFrom(
  candidate: OfflineCandidate,
  status: OfflinePlanRow['status'],
  mode: OfflineUploadMode,
  payload: ClickConversion,
  error: string | null
): OfflinePlanRow {
  return {
    jobber_job_id: candidate.jobberJobId,
    invoice_ids: candidate.invoiceIds.join(','),
    conversion_at: candidate.conversionAt,
    value_usd: candidate.valueUsd,
    gclid: candidate.gclid,
    gbraid: candidate.gbraid,
    wbraid: candidate.wbraid,
    signal: candidate.signal,
    status,
    mode,
    payload,
    error,
  };
}

export async function runOfflineImport(input: {
  candidates: OfflineCandidate[];
  existing: OfflineExistingRow[];
  mode: OfflineUploadMode;
  conversionAction: string | null;
  save: (row: OfflinePlanRow) => Promise<void>;
  upload?: (conversions: ClickConversion[]) => Promise<{ ok: boolean; status: number; body: unknown }>;
}): Promise<{ dryRun: number; uploaded: number; skipped: number; errors: string[] }> {
  const plan = planOfflineRows(input);
  const result = { dryRun: 0, uploaded: 0, skipped: 0, errors: [] as string[] };

  if (input.mode !== 'live' || plan.toUpload.length === 0) {
    for (const row of plan.rows) {
      await input.save(row);
      if (row.status === 'dry_run') result.dryRun += 1;
      else if (row.status === 'skipped') result.skipped += 1;
      else if (row.status === 'error') result.errors.push(`${row.jobber_job_id}: ${row.error}`);
    }
    return result;
  }

  let uploadResult: { ok: boolean; status: number; body: unknown };
  try {
    if (!input.upload) throw new Error('upload function missing');
    uploadResult = await input.upload(plan.toUpload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'upload failed';
    for (const row of plan.rows) {
      const failed = row.status === 'uploaded' ? { ...row, status: 'error' as const, error: message } : row;
      await input.save(failed);
      if (failed.status === 'error') result.errors.push(`${failed.jobber_job_id}: ${failed.error}`);
    }
    return result;
  }

  const partial =
    uploadResult.body &&
    typeof uploadResult.body === 'object' &&
    'partialFailureError' in (uploadResult.body as Record<string, unknown>);
  const ok = uploadResult.ok && !partial;

  for (const row of plan.rows) {
    const saved =
      row.status === 'uploaded' && !ok
        ? {
            ...row,
            status: 'error' as const,
            error: `Google Ads upload HTTP ${uploadResult.status}`,
            google_response: uploadResult.body,
          }
        : { ...row, google_response: row.status === 'uploaded' ? uploadResult.body : undefined };
    await input.save(saved);
    if (saved.status === 'uploaded') result.uploaded += 1;
    else if (saved.status === 'error') result.errors.push(`${saved.jobber_job_id}: ${saved.error}`);
    else if (saved.status === 'skipped') result.skipped += 1;
  }
  return result;
}
