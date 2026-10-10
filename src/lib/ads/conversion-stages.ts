/**
 * 3-stage value model for the booked-job offline conversion.
 *
 *  stage 1 booking:  value at booking (quote subtotal, e.g. $200 service call).
 *                    Sent as the original click conversion (order_id = job id).
 *  stage 2 approved: sum of the client's approved/converted quote subtotals
 *                    created on/after the first ad signal. Pre-tax.
 *  stage 3 invoiced: sum of the client's issued invoice subtotals dated on/after
 *                    the first ad signal. Pre-tax.
 *
 * Later stages only ever restate UPWARD (RESTATEMENT via
 * ConversionAdjustmentUploadService). A stage that is not higher than the value
 * already sent is skipped; we never reduce.
 */

import { invoicePretaxUsd, type InvoiceAmountInput } from './invoice-value.ts';
import { formatAdsDateTime } from './offline-conversion.ts';

export interface StageValues {
  booking: number;
  approved: number | null;
  invoiced: number | null;
}

export interface QuoteLike {
  id: string;
  status?: string | null;
  createdAt?: string | null;
  subtotal?: number | null;
}

const APPROVED = new Set(['approved', 'converted']);
const round = (n: number) => Math.round(n * 100) / 100;

export function stageValues(input: {
  bookingValue: number;
  anchorMs: number;
  quotes: QuoteLike[];
  invoices: InvoiceAmountInput[];
}): StageValues {
  const booking = round(input.bookingValue);

  let approvedSum = 0;
  const seenQuotes = new Set<string>();
  for (const q of input.quotes) {
    if (seenQuotes.has(q.id)) continue;
    seenQuotes.add(q.id);
    if (!APPROVED.has((q.status || '').trim().toLowerCase())) continue;
    const created = Date.parse(q.createdAt || '');
    if (!Number.isFinite(created) || created < input.anchorMs) continue;
    if (typeof q.subtotal === 'number' && Number.isFinite(q.subtotal) && q.subtotal > 0) approvedSum += q.subtotal;
  }

  let invoiceSum = 0;
  const seenInvoices = new Set<string>();
  for (const inv of input.invoices) {
    if (inv.id) {
      if (seenInvoices.has(inv.id)) continue;
      seenInvoices.add(inv.id);
    }
    const issued = Date.parse(inv.issuedDate || '');
    if (!Number.isFinite(issued) || issued < input.anchorMs) continue;
    invoiceSum += invoicePretaxUsd(inv) ?? 0;
  }

  // Monotonic: each stage is at least the one before it.
  const approved = approvedSum > 0 ? round(Math.max(booking, approvedSum)) : null;
  const floorForInvoice = approved ?? booking;
  const invoiced = invoiceSum > 0 ? round(Math.max(floorForInvoice, invoiceSum)) : null;
  return { booking, approved, invoiced };
}

export type StageName = 'booking' | 'approved' | 'invoiced';
export const STAGE_NUMBER: Record<StageName, 1 | 2 | 3> = { booking: 1, approved: 2, invoiced: 3 };

/** What the stored row says was last sent. Legacy rows (no state) count as stage 1 at value_usd. */
export interface SentState {
  stage: 1 | 2 | 3;
  value: number;
}

export function sentStateOf(row: { value_usd?: number | string | null; payload?: unknown } | undefined): SentState | null {
  if (!row) return null;
  const payload = row.payload as { sent_stage?: unknown; sent_value?: unknown } | null | undefined;
  const stage = payload?.sent_stage;
  const value = payload?.sent_value;
  if ((stage === 1 || stage === 2 || stage === 3) && typeof value === 'number') return { stage, value };
  const legacy = Number(row.value_usd);
  return Number.isFinite(legacy) && legacy > 0 ? { stage: 1, value: legacy } : null;
}

export interface StageStep {
  stage: 2 | 3;
  name: 'approved' | 'invoiced';
  value: number;
}

/** The single next restatement to send (the highest stage that beats what was sent), or null. */
export function nextRestatement(stages: StageValues, sent: SentState): StageStep | null {
  if (stages.invoiced != null && stages.invoiced > sent.value + 0.004 && sent.stage < 3) {
    return { stage: 3, name: 'invoiced', value: stages.invoiced };
  }
  if (stages.approved != null && stages.approved > sent.value + 0.004 && sent.stage < 2) {
    return { stage: 2, name: 'approved', value: stages.approved };
  }
  return null;
}

export interface ConversionAdjustment {
  conversion_action: string;
  adjustment_type: 'RESTATEMENT';
  order_id: string;
  adjustment_date_time: string;
  restatement_value: { adjusted_value: number; currency_code: 'USD' };
  user_identifiers?: Array<{ hashed_email?: string; hashed_phone_number?: string }>;
}

export function buildRestatement(
  conversionAction: string,
  input: {
    jobberJobId: string;
    value: number;
    nowIso: string;
    hashedEmail?: string | null;
    hashedPhone?: string | null;
  }
): ConversionAdjustment {
  const ids: Array<{ hashed_email?: string; hashed_phone_number?: string }> = [];
  if (input.hashedEmail) ids.push({ hashed_email: input.hashedEmail });
  if (input.hashedPhone) ids.push({ hashed_phone_number: input.hashedPhone });
  const out: ConversionAdjustment = {
    conversion_action: conversionAction,
    adjustment_type: 'RESTATEMENT',
    order_id: input.jobberJobId,
    adjustment_date_time: formatAdsDateTime(input.nowIso),
    restatement_value: { adjusted_value: round(input.value), currency_code: 'USD' },
  };
  if (ids.length) out.user_identifiers = ids;
  return out;
}
