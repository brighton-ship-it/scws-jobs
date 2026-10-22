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
import { conversionActionId, conversionLanded, ingestRequestId, type DmStatusSummary } from './data-manager.ts';

export type OfflineUploadMode = 'dry_run' | 'live';

/** GA4 `book_job` import. Must stay a different action from the won-job upload. */
export const GA4_BOOK_JOB_CONVERSION_ACTION_ID = '7735430525';

/** Fake click id from the PR 30 smoke test. Google rejected it as INVALID_GCLID. */
export const TEST_GCLID = 'smoke_test_pr30_do_not_call';

/** Midnight Pacific on this day. Sep 1–Oct 2026 is PDT (UTC-7). */
export const BACKFILL_EARLIEST_DAY = '2026-09-01';

export function isTestGclid(gclid: string | null | undefined): boolean {
  return (gclid ?? '').trim() === TEST_GCLID;
}

export function isGa4BookJobAction(resource: string | null | undefined): boolean {
  if (!resource?.trim()) return false;
  try {
    return conversionActionId(resource) === GA4_BOOK_JOB_CONVERSION_ACTION_ID;
  } catch {
    return false;
  }
}

export const ENV_BACKFILL_MAX_ATTEMPTS = 3;

/**
 * BACKFILL_SINCE env -> the day to backfill, or null if unset, invalid, done for that day,
 * or already attempted ENV_BACKFILL_MAX_ATTEMPTS nights. Legacy markers ({since} only) count as done.
 */
export function envBackfillDay(raw: string | null | undefined, consumed: unknown): string | null {
  const day = (raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < BACKFILL_EARLIEST_DAY) return null;
  const m = consumed && typeof consumed === 'object' ? (consumed as { since?: unknown; done?: unknown; attempts?: unknown }) : null;
  if (!m || m.since !== day) return day;
  if (m.done === undefined || m.done === true) return null;
  const attempts = typeof m.attempts === 'number' ? m.attempts : 0;
  return attempts >= ENV_BACKFILL_MAX_ATTEMPTS ? null : day;
}

/** Next marker after a run: done when the re-sent rows had no errors; attempts counted per day. */
export function nextEnvBackfillMarker(
  prior: unknown,
  day: string,
  resendErrors: number,
  resend: number,
  nowIso: string
): { since: string; attempts: number; done: boolean; resend: number; resend_errors: number; at: string } {
  const p = prior && typeof prior === 'object' ? (prior as { since?: unknown; attempts?: unknown }) : null;
  const before = p && p.since === day && typeof p.attempts === 'number' ? p.attempts : 0;
  return { since: day, attempts: before + 1, done: resendErrors === 0, resend, resend_errors: resendErrors, at: nowIso };
}

/** Rows that must go out under `<id>-r2`: this run's re-sends plus any row already sent (or tried) as -r2. */
export function r2OrderIds(
  existing: Array<{ jobber_job_id: string; payload?: unknown }>,
  resendIds: ReadonlySet<string> | undefined
): Set<string> {
  const out = new Set<string>(resendIds ?? []);
  for (const r of existing) {
    const v = r.payload && typeof r.payload === 'object' ? (r.payload as { sent_order_id?: unknown }).sent_order_id : null;
    if (typeof v === 'string' && v === resendOrderId(r.jobber_job_id)) out.add(r.jobber_job_id);
  }
  return out;
}

export function backfillFloorIso(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('backfillSince must be YYYY-MM-DD');
  if (day < BACKFILL_EARLIEST_DAY) throw new Error('backfillSince cannot be before 2026-09-01');
  return `${day}T07:00:00.000Z`;
}

export function requestIdFromRow(row: { payload?: unknown; google_response?: unknown }): string | null {
  const payload = row.payload && typeof row.payload === 'object' ? (row.payload as { dm_request_id?: unknown }) : null;
  if (typeof payload?.dm_request_id === 'string' && payload.dm_request_id.trim()) return payload.dm_request_id.trim();
  return ingestRequestId(row.google_response);
}

/** What to write after Data Manager finishes a request. Does not call Google. */
export function statusUpdate(input: {
  payload: unknown;
  gclid: string | null;
  summary: DmStatusSummary;
}): { payload: Record<string, unknown>; status?: 'error'; error: string | null | undefined } {
  const base =
    input.payload && typeof input.payload === 'object' ? { ...(input.payload as Record<string, unknown>) } : {};
  const payload: Record<string, unknown> = {
    ...base,
    dm_request_id: input.summary.requestId ?? base.dm_request_id ?? null,
    dm_status: input.summary.status,
    dm_errors: input.summary.errors,
    dm_warnings: input.summary.warnings,
  };
  const invalidGclid = input.summary.errors.some((row) => row.reason === 'PROCESSING_ERROR_REASON_INVALID_GCLID');
  if (isTestGclid(input.gclid) && (invalidGclid || input.summary.status === 'FAILED')) {
    return { payload, status: 'error', error: 'PROCESSING_ERROR_REASON_INVALID_GCLID' };
  }
  if (input.summary.status === 'FAILED') {
    const why = input.summary.errors.map((row) => row.reason).join(',') || 'FAILED';
    return { payload, status: 'error', error: why.slice(0, 500) };
  }
  if (input.summary.status === 'SUCCESS') return { payload, error: null };
  return { payload, error: undefined };
}

export function needsStatusPoll(row: { payload?: unknown; google_response?: unknown }): boolean {
  if (!requestIdFromRow(row)) return false;
  const payload = row.payload && typeof row.payload === 'object' ? (row.payload as { dm_status?: unknown }) : null;
  const status = payload?.dm_status;
  return status == null || status === 'PROCESSING' || status === 'UNKNOWN';
}

/**
 * Uploaded rows a backfill may send again. Same Jobber job id, so Google dedupes
 * inside the won-job action. The GA4 book_job action is a different conversion
 * and is not a reason to skip: it is secondary, and this upload is the primary count.
 */
/** Distinct Data Manager transactionId for a backfill re-send of a job that never landed. */
export function resendOrderId(jobberJobId: string): string {
  return `${jobberJobId}-r2`;
}

export function uploadedIdsToResend(
  existing: Array<{ jobber_job_id: string; status: string; gclid?: string | null; payload?: unknown }>,
  candidateIds: Iterable<string>
): Set<string> {
  const byId = new Map(existing.map((row) => [row.jobber_job_id, row]));
  const out = new Set<string>();
  for (const id of candidateIds) {
    const row = byId.get(id);
    if (!row || row.status !== 'uploaded') continue;
    if (isTestGclid(row.gclid)) continue;
    if (conversionLanded(row.payload)) continue;
    out.add(id);
  }
  return out;
}

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
  /** Ads call that brought the job in (E.164 caller + UTC start), for call-conversion import. */
  callerPhone?: string | null;
  callStartedAt?: string | null;
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
  /** Uploaded job ids a one-shot backfill is allowed to send again. */
  resendUploadedIds?: ReadonlySet<string>;
}): { rows: OfflinePlanRow[]; toUpload: ClickConversion[] } {
  const existing = new Map(input.existing.map((row) => [row.jobber_job_id, row.status]));
  const rows: OfflinePlanRow[] = [];
  const toUpload: ClickConversion[] = [];
  const seen = new Set<string>();
  const blockedAction = isGa4BookJobAction(input.conversionAction);

  for (const candidate of input.candidates) {
    if (seen.has(candidate.jobberJobId)) continue;
    seen.add(candidate.jobberJobId);
    const status = existing.get(candidate.jobberJobId);
    const resend = input.resendUploadedIds?.has(candidate.jobberJobId) === true;
    if (status === 'uploaded' && !resend) continue;

    if (isTestGclid(candidate.gclid)) {
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
        error: 'test_row',
      });
      continue;
    }

    const action = input.conversionAction || 'customers/0/conversionActions/0';
    const payload = buildClickConversion(action, {
      ...candidate,
      eventSource: candidate.signal === 'ads_call' ? 'PHONE' : 'WEB',
    });
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

    if (blockedAction) {
      rows.push(
        rowFrom(
          candidate,
          'error',
          input.mode,
          payload,
          `won-job upload must not use the GA4 book_job action ${GA4_BOOK_JOB_CONVERSION_ACTION_ID}`
        )
      );
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
  resendUploadedIds?: ReadonlySet<string>;
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

  const failures = parsePartialFailure(uploadResult.body);
  // Index into plan.toUpload; 'uploaded' rows in plan.rows are in the same order.
  let uploadIndex = 0;

  for (const row of plan.rows) {
    let saved: OfflinePlanRow;
    if (row.status !== 'uploaded') {
      saved = row;
    } else {
      const index = uploadIndex++;
      let failure: string | null = null;
      if (!uploadResult.ok) failure = uploadErrorMessage(uploadResult.status, uploadResult.body);
      else if (failures.all) failure = failures.all;
      else if (failures.byIndex.has(index)) failure = failures.byIndex.get(index)!;
      saved = failure
        ? { ...row, status: 'error' as const, error: failure, google_response: uploadResult.body }
        : { ...row, google_response: uploadResult.body };
    }
    await input.save(saved);
    if (saved.status === 'uploaded') result.uploaded += 1;
    else if (saved.status === 'error') result.errors.push(`${saved.jobber_job_id}: ${saved.error}`);
    else if (saved.status === 'skipped') result.skipped += 1;
  }
  return result;
}

/**
 * Reads Google Ads `partialFailureError` (REST JSON) into per-conversion messages keyed by
 * the conversion's index in the request. `all` is set when a partial failure exists but no
 * row index can be read from it, so every row is treated as failed (and stays retryable).
 */
export function parsePartialFailure(body: unknown): { byIndex: Map<number, string>; all: string | null } {
  const byIndex = new Map<number, string>();
  if (!body || typeof body !== 'object') return { byIndex, all: null };
  const pfe = (body as Record<string, unknown>).partialFailureError as
    | { code?: number; message?: string; details?: unknown[] }
    | null
    | undefined;
  if (!pfe || typeof pfe !== 'object') return { byIndex, all: null };
  if (!pfe.code && !pfe.message && !(pfe.details && pfe.details.length)) return { byIndex, all: null };

  const add = (index: number, message: string) => {
    const prev = byIndex.get(index);
    byIndex.set(index, prev ? `${prev}; ${message}` : message);
  };
  for (const detail of pfe.details ?? []) {
    const errors = (detail as { errors?: unknown[] })?.errors ?? [];
    for (const err of errors) {
      const e = err as {
        message?: string;
        errorCode?: Record<string, unknown>;
        location?: { fieldPathElements?: Array<{ fieldName?: string; index?: number }> };
      };
      const el = e.location?.fieldPathElements?.find(
        (f) => (f.fieldName === 'conversions' || f.fieldName === 'conversion_adjustments') && typeof f.index === 'number'
      );
      if (!el) continue;
      const code = e.errorCode ? Object.values(e.errorCode).join(',') : '';
      add(el.index as number, [code, e.message].filter(Boolean).join(': ') || 'partial failure');
    }
  }
  if (byIndex.size === 0 && pfe.message) {
    // Fallback: "... at conversions[3].gclid, ..." in the top-level message.
    for (const part of pfe.message.split(/,\s*(?=[^,]*conversions\[)/)) {
      const m = /conversions\[(\d+)\]/.exec(part);
      if (m) add(Number(m[1]), part.trim());
    }
  }
  if (byIndex.size === 0) return { byIndex, all: pfe.message || `partial failure (code ${pfe.code ?? '?'})` };
  return { byIndex, all: null };
}

/** Whole-request failure text, including Google's error status/message when present. */
export function uploadErrorMessage(status: number, body: unknown): string {
  const err = (body as { error?: { status?: string; message?: string } } | null)?.error;
  const detail = [err?.status, err?.message].filter(Boolean).join(': ');
  return (`Google upload HTTP ${status}` + (detail ? ` ${detail}` : '')).slice(0, 500);
}
