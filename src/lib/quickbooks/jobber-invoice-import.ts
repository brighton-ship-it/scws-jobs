/**
 * Rebuild QuickBooks invoices the way Jobber's sync posted them.
 *
 * Compared with QBO invoice 5824 / 5825 (read 2026-11-19):
 * - DocNumber is the Jobber invoice number
 * - CustomerRef is the QBO customer whose DisplayName equals the Jobber client name
 * - Each line's ItemRef is the QBO item whose Name equals the Jobber line name
 *   (those items post to the income account already on the item, 4010 Sales for 1MS and MISC)
 * - TaxCodeRef is TAX or NON. The header TxnTaxCodeRef is a TaxCode id
 *   (San Diego County 3, Menifee 30). Ids are not looked up by display name.
 * - ShipAddr and ShipFromAddr are the Jobber property (jobsite), structured the
 *   way synced invoices 5824 and 34160 (#5333) stored them: Line1, City,
 *   Country "United States", CountrySubDivisionCode "CA", PostalCode, and
 *   FreeFormAddress false. Automated Sales Tax uses that address. A header
 *   tax code alone is ignored and QBO falls back to the Anza shop address.
 *   BillAddr is left unset so the customer billing address is not replaced.
 * - TxnDate is the issue timestamp's America/Los_Angeles date. DueDate is the due date
 * - CustomerMemo is the Jobber client message, cut at 1,000 characters. The preview
 *   reports the original length.
 * - PrivateNote is `[batch:<batchId>]` on create when a batch id is set. The tag is
 *   not added twice. It stays within 4,000 characters.
 * - A missing property street, city, or postal code blocks that invoice. QuickBooks
 *   would otherwise tax the Anza shop. Two different properties on one invoice
 *   block it instead of picking the first.
 * - A Jobber discount is a negative line so the total is not the pre-discount sum.
 * - EmailStatus is never set
 *
 * ServiceDate is not copied: the invoice line we can read does not carry the visit date.
 * A deposit that already booked the payout to 4010 Sales is rewritten with
 * qbo_relink_deposit, not by linking a second payment onto that income.
 */
import { recordQboAudit, runQboPlan, writeRealmQuery, type QboAuditEntry, type QboWriteDeps } from './durable-write.ts';
import { isQboRateLimit, withQboBackoff } from './qbo-backoff.ts';
import { TAX_RATE_IDS_BY_TAX_CODE, countyNameForCity, normalizePlace, taxCodeIdForCity, taxCodeMissingReason, type CountyName } from './tax-codes.ts';
import { describeQboWriteGate } from './write-gate.ts';
import { buildDeposit, parseBatchId, privateNoteWithBatch, type QboPlan } from './write-payloads.ts';

export const QBO_MEMO_LIMIT = 1000;

export type JobberPaymentForQbo = {
  id?: string | null;
  amount: number;
  entryDate?: string | null;
  adjustmentType?: string | null;
};

/** Jobber property address. ShipAddr and ShipFromAddr are built from this. */
export type JobberPropertyAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
};

export type InvoiceTaxReport = {
  requestedTxnTaxCodeId: string | null;
  savedTxnTaxCodeId: string | null;
  taxLines: unknown[] | null;
  county: CountyName | null;
  expectedCountyRateId: string | null;
  savedCountyRateId: string | null;
  jobberTax: number | null;
  savedTotalTax: number | null;
  taxMismatch: boolean;
  taxMismatchReasons: string[];
  /** True when the county rate id could not be resolved, so nothing may be posted. */
  countyRateUnresolved: boolean;
};

/** Automated Sales Tax county rates. TaxRate.Name is a hash, so these ids are fixed. */
export const SAN_DIEGO_COUNTY_RATE_ID = '4';
export const RIVERSIDE_COUNTY_RATE_ID = '25';
export const SAN_BERNARDINO_COUNTY_RATE_ID = '26';
/** TaxCode whose rate list must include the San Diego county rate when QuickBooks returns it. */
export const SAN_DIEGO_COUNTY_TAX_CODE_ID = '3';
/** TaxCode whose rate list must include the Riverside county rate when QuickBooks returns it. */
export const RIVERSIDE_COUNTY_TAX_CODE_ID = '23';
/** TaxCode whose rate list must include the San Bernardino county rate when QuickBooks returns it. */
export const SAN_BERNARDINO_COUNTY_TAX_CODE_ID = '31';

export type CountyRateIds = {
  sanDiego: string;
  riverside: string;
  sanBernardino: string;
  /** Set when a TaxCode rate list was returned and did not contain the fixed county id. */
  unresolvedReason: string | null;
};

export type JobberInvoiceForQbo = {
  invoiceNumber: string;
  issuedDate: string;
  dueDate: string | null;
  message: string | null;
  clientName: string;
  city: string | null;
  address?: JobberPropertyAddress | null;
  addressConflict?: string | null;
  lines: Array<{ name: string; description: string | null; quantity: number; unitPrice: number; taxable: boolean }>;
  total: number;
  taxAmount: number;
  paymentsTotal: number;
  discountAmount?: number;
  payments?: JobberPaymentForQbo[];
};

export type ImportStatus = 'create' | 'skip' | 'blocked';

export type ImportPaymentLine = {
  amount: number;
  applied: number;
  txnDate: string;
  ref: string;
  source: 'jobber-payment' | 'invoice-total';
};

export type MemoReport = { length: number; limit: number; truncated: boolean; value: string | null };

export type ImportInvoicePlan = {
  invoiceNumber: string;
  status: ImportStatus;
  reason: string | null;
  customerName: string;
  customerId: string | null;
  city: string | null;
  total: number;
  taxAmount: number;
  paymentsTotal: number;
  discountAmount: number;
  negativeTaxableLines: number;
  memo: MemoReport | null;
  customerCreate: { displayName: string } | null;
  body: Record<string, unknown> | null;
  payment: ImportPaymentLine | null;
  paymentLines: ImportPaymentLine[];
  tax: InvoiceTaxReport;
  /** True when this create asks QuickBooks to keep the tax code instead of letting AST geocode it. */
  holdTaxCode?: boolean;
};

const DEPOSIT_WARNING =
  'payments: "deposit" links onto a deposit that may already credit 4010 Sales. That records the invoice income a second time. Use qbo_relink_deposit to replace that sales line, or payments: "payout" to make a new deposit with a fee line.';

export function pacificDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Bad date: ${iso}`);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export const IMPORT_CHUNK_DEFAULT = 8;
export const IMPORT_CHUNK_MAX = 10;

export function importChunkLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return IMPORT_CHUNK_DEFAULT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer.');
  return Math.min(limit, IMPORT_CHUNK_MAX);
}

/** Inclusive cursor. The next call passes nextCursor back as cursor. */
export function sliceInvoiceChunk(numbers: string[], cursor: unknown, limit: number): { chunk: string[]; nextCursor: string | null } {
  let start = 0;
  if (cursor !== undefined && cursor !== null && String(cursor).trim()) {
    const token = String(cursor).trim();
    const exact = numbers.indexOf(token);
    if (exact >= 0) start = exact;
    else {
      const asNumber = Number(token);
      start = numbers.findIndex((number) => Number(number) >= asNumber);
      if (start < 0) start = numbers.length;
    }
  }
  const chunk = numbers.slice(start, start + limit);
  return { chunk, nextCursor: numbers[start + limit] || null };
}

export function invoiceNumbersFromArgs(args: Record<string, unknown>): string[] {
  const numbers: string[] = [];
  if (Array.isArray(args.invoiceNumbers)) {
    for (const value of args.invoiceNumbers) {
      const text = String(value).trim();
      if (!/^\d{1,10}$/.test(text)) throw new Error(`Invoice number ${text} is not numeric.`);
      numbers.push(String(Number(text)));
    }
  }
  if (args.fromInvoice !== undefined || args.toInvoice !== undefined) {
    const from = Number(args.fromInvoice);
    const to = Number(args.toInvoice);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to < from) {
      throw new Error('fromInvoice and toInvoice must be a positive inclusive range.');
    }
    if (to - from + 1 > 500) throw new Error('Range is too wide. Pass at most 500 invoice numbers; each call returns nextCursor.');
    for (let n = from; n <= to; n += 1) numbers.push(String(n));
  }
  const unique = [...new Set(numbers)];
  if (!unique.length) throw new Error('Pass invoiceNumbers or fromInvoice and toInvoice.');
  return unique;
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

export function memoReport(message: string | null | undefined): MemoReport {
  const text = (message || '').trim();
  return {
    length: text.length,
    limit: QBO_MEMO_LIMIT,
    truncated: text.length > QBO_MEMO_LIMIT,
    value: text ? text.slice(0, QBO_MEMO_LIMIT) : null,
  };
}

export function paymentTxnDate(entryDate: string | null | undefined, fallback: string): string {
  const text = (entryDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (!text) return fallback;
  return pacificDate(text);
}

function collectedPayment(record: JobberPaymentForQbo): boolean {
  const kind = (record.adjustmentType || 'PAYMENT').toUpperCase();
  if (kind === 'REFUND' || kind === 'BAD_DEBT' || kind === 'FAILED_ACH_PAYMENT') return false;
  return record.amount > 0 && (kind === 'PAYMENT' || kind === 'DEPOSIT' || kind === '');
}

/** Payment date and amount come from the Jobber payment record when one exists. */
export function jobberPaymentLines(invoice: JobberInvoiceForQbo): ImportPaymentLine[] {
  const invoiceDate = pacificDate(invoice.issuedDate);
  const records = (invoice.payments || []).filter(collectedPayment);
  if (!records.length) {
    if (!(invoice.paymentsTotal > 0)) return [];
    const amount = money(Math.min(invoice.paymentsTotal, invoice.total));
    return [{ amount, applied: amount, txnDate: invoiceDate, ref: invoice.invoiceNumber, source: 'invoice-total' }];
  }
  let remaining = money(invoice.total);
  return records
    .map((record) => {
      const amount = money(record.amount);
      const applied = money(Math.min(amount, Math.max(remaining, 0)));
      remaining = money(Math.max(0, remaining - applied));
      return {
        amount,
        applied,
        txnDate: paymentTxnDate(record.entryDate, invoiceDate),
        ref: invoice.invoiceNumber,
        source: 'jobber-payment' as const,
      };
    })
    .filter((line) => line.amount > 0);
}

function clip(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function subdivision(value: string | null): string | null {
  const text = clip(value, 255);
  if (!text) return null;
  const key = text.toLowerCase().replace(/\./g, '');
  if (key === 'ca' || key === 'california' || key === 'calif') return 'CA';
  if (/^[a-z]{2}$/i.test(text)) return text.toUpperCase();
  return text;
}

function countryName(value: string | null): string {
  const text = clip(value, 255);
  const key = (text || '').toLowerCase().replace(/\./g, '');
  if (!key || key === 'us' || key === 'usa' || key === 'united states' || key === 'united states of america') {
    return 'United States';
  }
  return text || 'United States';
}

/**
 * Structured ship address from a saved Jobber sync invoice (5824, 34160 / #5333).
 * Same fields on ShipAddr and ShipFromAddr, FreeFormAddress false, no Id.
 */
export function qboShipAddress(address: JobberPropertyAddress | null | undefined): Record<string, string> | null {
  if (!address) return null;
  const line1 = clip(address.line1, 500);
  const line2 = clip(address.line2, 500);
  const city = clip(address.city, 255);
  const postalCode = clip(address.postalCode, 30);
  const province = subdivision(address.province);
  if (!line1 && !line2 && !city && !postalCode) return null;
  const ship: Record<string, string> = { Country: countryName(address.country) };
  if (line1) ship.Line1 = line1;
  if (line2) ship.Line2 = line2;
  if (city) ship.City = city;
  if (province) ship.CountrySubDivisionCode = province;
  if (postalCode) ship.PostalCode = postalCode;
  return ship;
}

export function emptyTaxReport(requestedTxnTaxCodeId: string | null): InvoiceTaxReport {
  return {
    requestedTxnTaxCodeId,
    savedTxnTaxCodeId: null,
    taxLines: null,
    county: null,
    expectedCountyRateId: null,
    savedCountyRateId: null,
    jobberTax: null,
    savedTotalTax: null,
    taxMismatch: false,
    taxMismatchReasons: [],
    countyRateUnresolved: false,
  };
}

export function fixedCountyRateIds(): CountyRateIds {
  return { sanDiego: SAN_DIEGO_COUNTY_RATE_ID, riverside: RIVERSIDE_COUNTY_RATE_ID, sanBernardino: SAN_BERNARDINO_COUNTY_RATE_ID, unresolvedReason: null };
}

export function countyRateIdFor(county: CountyName, ids: CountyRateIds = fixedCountyRateIds()): string | null {
  if (ids.unresolvedReason) return null;
  if (county === 'San Diego') return ids.sanDiego;
  if (county === 'San Bernardino') return ids.sanBernardino;
  return ids.riverside;
}

const COUNTY_NAMES: CountyName[] = ['San Diego', 'Riverside', 'San Bernardino'];

/** The county rate ids that must be absent for a jobsite in this county. */
function otherCountyRates(county: CountyName | null, ids: CountyRateIds): Array<{ county: CountyName; id: string }> {
  if (!county || ids.unresolvedReason) return [];
  return COUNTY_NAMES.filter((name) => name !== county)
    .map((name) => ({ county: name, id: countyRateIdFor(name, ids) || '' }))
    .filter((other) => other.id);
}

/**
 * TaxRate names are 64-character hashes, so the county ids stay 4, 25 and 26.
 * When TaxCode 3 and TaxCode 23 both include a rate list, those lists must contain 4 and 25.
 * When TaxCode 31 includes a rate list, it must contain 26.
 * A missing list is not a contradiction; the fixed ids are used.
 */
export function verifyCountyRateIds(taxCodes: Array<{ id: string; rateIds: string[] | null }>): CountyRateIds {
  const fixed = fixedCountyRateIds();
  const sanDiego = taxCodes.find((code) => code.id === SAN_DIEGO_COUNTY_TAX_CODE_ID);
  const riverside = taxCodes.find((code) => code.id === RIVERSIDE_COUNTY_TAX_CODE_ID);
  const sanBernardino = taxCodes.find((code) => code.id === SAN_BERNARDINO_COUNTY_TAX_CODE_ID);
  const unresolved = (reason: string): CountyRateIds => ({ sanDiego: '', riverside: '', sanBernardino: '', unresolvedReason: reason });
  if (sanBernardino?.rateIds && !sanBernardino.rateIds.includes(fixed.sanBernardino)) {
    return unresolved('TaxCode 31 does not include San Bernardino County rate 26.');
  }
  if (!sanDiego?.rateIds || !riverside?.rateIds) return fixed;
  if (!sanDiego.rateIds.includes(fixed.sanDiego)) return unresolved('TaxCode 3 does not include San Diego County rate 4.');
  if (!riverside.rateIds.includes(fixed.riverside)) return unresolved('TaxCode 23 does not include Riverside County rate 25.');
  return fixed;
}

export function missingJobsiteAddressReason(address: JobberPropertyAddress | null | undefined): string | null {
  const missing: string[] = [];
  if (!address?.line1?.trim()) missing.push('street');
  if (!address?.city?.trim()) missing.push('city');
  if (!address?.postalCode?.trim()) missing.push('postal code');
  if (!missing.length) return null;
  const what = address ? `is missing ${missing.join(', ')}` : 'is missing';
  return `Jobber property address ${what}, so QuickBooks would tax the Anza shop instead of the jobsite.`;
}

function placeKey(address: JobberPropertyAddress): string {
  const street = (address.line1 || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const city = (address.city || '').trim().toLowerCase();
  const zip = (address.postalCode || '').trim().slice(0, 5);
  return `${street}|${city}|${zip}`;
}

/** One jobsite. Different streets, cities, or ZIPs are a conflict instead of the first address. */
export function resolveJobProperties(addresses: Array<JobberPropertyAddress | null | undefined>): { address: JobberPropertyAddress | null; conflict: string | null } {
  const present = addresses.filter((address): address is JobberPropertyAddress => Boolean(address && (address.line1 || address.city || address.postalCode)));
  if (!present.length) return { address: null, conflict: null };
  const keys = new Set(present.map(placeKey));
  if (keys.size === 1) return { address: present[0], conflict: null };
  const listed = present.map((address) => [address.line1, address.city, address.postalCode].filter(Boolean).join(', ')).join(' vs ');
  return {
    address: null,
    conflict: `Jobber jobs on this invoice use different property addresses (${listed}). Refusing to pick one, because QuickBooks would tax the wrong county.`,
  };
}

function savedRateIds(lines: unknown[] | null): string[] {
  if (!lines) return [];
  const ids: string[] = [];
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    const detail = (line as { TaxLineDetail?: { TaxRateRef?: { value?: unknown } } }).TaxLineDetail;
    const id = detail?.TaxRateRef?.value;
    if (id != null && String(id).trim()) ids.push(String(id).trim());
  }
  return ids;
}

function taxReviewStatusOf(qbo: unknown): string | null {
  const entity = qbo && typeof qbo === 'object' ? (qbo as Record<string, unknown>) : null;
  const invoice = entity && entity.Invoice && typeof entity.Invoice === 'object' ? (entity.Invoice as Record<string, unknown>) : entity;
  const detail = invoice?.TxnTaxDetail as { TaxReviewStatus?: unknown } | undefined;
  return typeof detail?.TaxReviewStatus === 'string' && detail.TaxReviewStatus ? detail.TaxReviewStatus : null;
}

function savedTxnTax(qbo: unknown): { code: string | null; total: number | null; lines: unknown[] | null } {
  const entity = qbo && typeof qbo === 'object' ? (qbo as Record<string, unknown>) : null;
  const invoice = entity && entity.Invoice && typeof entity.Invoice === 'object' ? (entity.Invoice as Record<string, unknown>) : entity;
  const detail = invoice?.TxnTaxDetail as { TxnTaxCodeRef?: { value?: unknown }; TotalTax?: unknown; TaxLine?: unknown } | undefined;
  const codeRaw = detail?.TxnTaxCodeRef?.value;
  const code = codeRaw != null && String(codeRaw).trim() ? String(codeRaw).trim() : null;
  const total = detail?.TotalTax == null || detail.TotalTax === '' ? null : Number(detail.TotalTax);
  return {
    code,
    total: total != null && Number.isFinite(total) ? total : null,
    lines: Array.isArray(detail?.TaxLine) ? detail.TaxLine : null,
  };
}

function countyBlockReason(city: string | null, ids?: CountyRateIds): string | null {
  if (ids?.unresolvedReason) return ids.unresolvedReason;
  if (!countyNameForCity(city)) {
    return `No county rate for jobsite city ${city ? `"${city}"` : '(missing)'}. San Diego County is rate 4, Riverside County is rate 25 and San Bernardino County is rate 26.`;
  }
  return null;
}

function taxWithinCent(saved: number | null, expected: number): boolean {
  if (saved == null) return false;
  return Math.abs(saved - expected) <= 0.01 + 1e-9;
}

/** A mailing city the caller has verified with CDTFA. A plain taxCodeByCity override does not hold. */
export function shouldHoldAutomatedSalesTax(city: string | null | undefined, cdtfaVerifiedCities: readonly string[]): boolean {
  if (!city) return false;
  const key = normalizePlace(city);
  return cdtfaVerifiedCities.some((name) => normalizePlace(name) === key);
}

export function assessSavedTax(input: {
  requestedTxnTaxCodeId: string | null;
  city: string | null;
  jobberTax: number;
  qbo: unknown;
  countyRates?: CountyRateIds;
  /** When set, the saved code, its exact rate set, and the override flag are checked too. */
  holdTaxCode?: boolean;
}): InvoiceTaxReport {
  const ids = input.countyRates || fixedCountyRateIds();
  const county = countyNameForCity(input.city);
  const others = otherCountyRates(county, ids);
  const expectedCountyRateId = county && !ids.unresolvedReason ? countyRateIdFor(county, ids) : null;
  const base: InvoiceTaxReport = {
    ...emptyTaxReport(input.requestedTxnTaxCodeId),
    county,
    expectedCountyRateId,
    jobberTax: money(input.jobberTax),
    countyRateUnresolved: Boolean(ids.unresolvedReason),
  };
  if (!input.qbo) return base;
  const saved = savedTxnTax(input.qbo);
  const savedIds = savedRateIds(saved.lines);
  const wrongCounty = others.filter((other) => savedIds.includes(other.id));
  const savedCounty = expectedCountyRateId && savedIds.includes(expectedCountyRateId)
    ? expectedCountyRateId
    : wrongCounty[0]?.id ?? null;
  const reasons: string[] = [];
  if (ids.unresolvedReason) reasons.push(ids.unresolvedReason);
  else if (!county) reasons.push(`No county for jobsite city ${input.city ? `"${input.city}"` : '(missing)'}.`);
  else if (expectedCountyRateId && !savedIds.includes(expectedCountyRateId)) {
    reasons.push(`Saved tax lines do not include ${county} County rate ${expectedCountyRateId}.`);
  }
  for (const other of wrongCounty) {
    reasons.push(`Saved tax lines include ${other.county} County rate ${other.id}.`);
  }
  if (!taxWithinCent(saved.total, money(input.jobberTax))) {
    reasons.push(`Saved tax ${saved.total ?? 'missing'} does not match Jobber tax ${money(input.jobberTax)} within $0.01.`);
  }
  if (input.holdTaxCode && input.qbo) {
    if (saved.code !== input.requestedTxnTaxCodeId) {
      reasons.push(`Requested TxnTaxCodeRef ${input.requestedTxnTaxCodeId ?? 'none'}, QuickBooks saved ${saved.code ?? 'none'}.`);
    }
    const expectedRates = input.requestedTxnTaxCodeId ? TAX_RATE_IDS_BY_TAX_CODE[input.requestedTxnTaxCodeId] : undefined;
    if (expectedRates) {
      const savedIds = [...new Set(savedRateIds(saved.lines))];
      const extra = savedIds.filter((id) => !expectedRates.includes(id));
      const missing = expectedRates.filter((id) => !savedIds.includes(id));
      if (extra.length || missing.length) {
        reasons.push(`Saved tax rates ${savedIds.join(', ') || 'none'}, expected only ${expectedRates.join(', ')}.`);
      }
    }
    const review = taxReviewStatusOf(input.qbo);
    if (review === 'AST_TAX_OVERRIDE') reasons.push('TaxReviewStatus is AST_TAX_OVERRIDE.');
  }
  return {
    ...base,
    savedTxnTaxCodeId: saved.code,
    taxLines: saved.lines,
    savedCountyRateId: savedCounty,
    savedTotalTax: saved.total,
    taxMismatch: reasons.length > 0,
    taxMismatchReasons: reasons,
    countyRateUnresolved: Boolean(ids.unresolvedReason),
  };
}

export function buildJobberSyncedInvoice(
  invoice: JobberInvoiceForQbo,
  customerId: string,
  itemsByName: Record<string, string>,
  txnTaxCodeId: string,
  options: { taxOverride?: boolean; discountItemId?: string | null; batchId?: string | null; holdTaxCode?: boolean } = {}
): { body: Record<string, unknown> | null; missingItems: string[]; negativeTaxableLines: number; discountAmount: number; memo: MemoReport; error?: string } {
  const memo = memoReport(invoice.message);
  const missing = [...new Set(invoice.lines.map((line) => line.name).filter((name) => name && !itemsByName[name]))];
  if (missing.length || !invoice.lines.length) {
    return { body: null, missingItems: missing.length ? missing : ['(no lines)'], negativeTaxableLines: 0, discountAmount: 0, memo };
  }
  let negativeTaxableLines = 0;
  const lineAmounts: number[] = [];
  const lines = invoice.lines.map((line) => {
    const amount = money(line.quantity * line.unitPrice);
    lineAmounts.push(amount);
    const taxable = line.taxable && amount >= 0;
    if (line.taxable && amount < 0) negativeTaxableLines += 1;
    return {
      Amount: amount,
      DetailType: 'SalesItemLineDetail',
      ...(line.description ? { Description: line.description } : {}),
      SalesItemLineDetail: {
        ItemRef: { value: itemsByName[line.name] },
        Qty: line.quantity,
        UnitPrice: money(line.unitPrice),
        TaxCodeRef: { value: taxable ? 'TAX' : 'NON' },
      },
    };
  });
  const statedDiscount = money(Math.max(0, invoice.discountAmount || 0));
  const negativeAlready = money(lineAmounts.filter((amount) => amount < 0).reduce((sum, amount) => sum + amount, 0));
  const discountAmount = statedDiscount > 0 && Math.abs(negativeAlready + statedDiscount) > 0.009 ? statedDiscount : 0;
  if (discountAmount > 0) {
    const discountKey = Object.keys(itemsByName).find((name) => name.trim().toLowerCase() === 'discount');
    const discountItem = options.discountItemId || (discountKey ? itemsByName[discountKey] : '') || itemsByName[invoice.lines.find((line) => line.quantity * line.unitPrice > 0)?.name || ''] || '';
    if (!discountItem) {
      return { body: null, missingItems: ['Discount'], negativeTaxableLines, discountAmount, memo };
    }
    if (money(lineAmounts.reduce((sum, amount) => sum + amount, 0) - discountAmount) < 0) {
      return { body: null, missingItems: [], negativeTaxableLines, discountAmount, memo, error: 'Discount is larger than the line total.' };
    }
    lines.push({
      Amount: money(-discountAmount),
      DetailType: 'SalesItemLineDetail',
      Description: 'Jobber discount',
      SalesItemLineDetail: {
        ItemRef: { value: discountItem },
        Qty: 1,
        UnitPrice: money(-discountAmount),
        TaxCodeRef: { value: 'NON' },
      },
    });
  }
  const txnDate = pacificDate(invoice.issuedDate);
  const due = invoice.dueDate ? pacificDate(invoice.dueDate) : txnDate;
  const taxDetail: Record<string, unknown> = { TxnTaxCodeRef: { value: txnTaxCodeId } };
  if (options.holdTaxCode) taxDetail.UseAutomatedSalesTax = false;
  if (options.taxOverride) taxDetail.TotalTax = money(invoice.taxAmount);
  const body: Record<string, unknown> = {
    DocNumber: invoice.invoiceNumber,
    ...(customerId ? { CustomerRef: { value: customerId } } : {}),
    TxnDate: txnDate,
    DueDate: due,
    Line: lines,
    TxnTaxDetail: taxDetail,
  };
  if (memo.value) body.CustomerMemo = { value: memo.value };
  const ship = qboShipAddress(invoice.address);
  if (ship) {
    body.ShipAddr = ship;
    body.ShipFromAddr = { ...ship };
    body.FreeFormAddress = false;
  }
  const privateNote = privateNoteWithBatch(undefined, options.batchId);
  if (privateNote) body.PrivateNote = privateNote;
  return { body, missingItems: [], negativeTaxableLines, discountAmount, memo };
}

export function classifyJobberInvoice(
  invoice: JobberInvoiceForQbo,
  existingDocNumbers: Set<string>,
  customerId: string | null,
  itemsByName: Record<string, string>,
  txnTaxCodeId: string | null,
  taxReason?: string,
  options: { taxOverride?: boolean; discountItemId?: string | null; createCustomer?: boolean; batchId?: string | null; countyRates?: CountyRateIds; holdTaxCode?: boolean } = {}
): ImportInvoicePlan {
  const paymentLines = jobberPaymentLines(invoice);
  const base = {
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.clientName,
    customerId,
    city: invoice.city,
    total: invoice.total,
    taxAmount: invoice.taxAmount,
    paymentsTotal: invoice.paymentsTotal,
    discountAmount: money(Math.max(0, invoice.discountAmount || 0)),
    negativeTaxableLines: 0,
    memo: memoReport(invoice.message),
    customerCreate: null as { displayName: string } | null,
    payment: paymentLines[0] || null,
    paymentLines,
    tax: assessSavedTax({
      requestedTxnTaxCodeId: txnTaxCodeId,
      city: invoice.city,
      jobberTax: invoice.taxAmount,
      qbo: null,
      countyRates: options.countyRates,
    }),
  };
  if (existingDocNumbers.has(invoice.invoiceNumber)) {
    return { ...base, status: 'skip', reason: 'DocNumber already exists in QuickBooks', body: null };
  }
  const createCustomer = Boolean(options.createCustomer && !customerId && invoice.clientName.trim());
  if (!customerId && !createCustomer) {
    return { ...base, status: 'blocked', reason: `No QuickBooks customer with DisplayName "${invoice.clientName}"`, body: null };
  }
  const addressReason = invoice.addressConflict || missingJobsiteAddressReason(invoice.address);
  if (!txnTaxCodeId || addressReason) {
    const taxText = txnTaxCodeId ? null : taxReason || taxCodeMissingReason(invoice.city);
    const reason = [addressReason, taxText].filter(Boolean).join(' ');
    return { ...base, status: 'blocked', reason, body: null };
  }
  const countyBlocked = countyBlockReason(invoice.city, options.countyRates);
  if (countyBlocked) {
    return {
      ...base,
      status: 'blocked',
      reason: countyBlocked,
      body: null,
      tax: { ...base.tax, countyRateUnresolved: true, taxMismatchReasons: [countyBlocked] },
    };
  }
  const built = buildJobberSyncedInvoice(invoice, customerId || '', itemsByName, txnTaxCodeId, options);
  if (built.error) {
    return { ...base, status: 'blocked', reason: built.error, body: null, negativeTaxableLines: built.negativeTaxableLines, discountAmount: built.discountAmount, memo: built.memo };
  }
  if (!built.body) {
    return { ...base, status: 'blocked', reason: `Missing QuickBooks items: ${built.missingItems.join(', ')}`, body: null, negativeTaxableLines: built.negativeTaxableLines, memo: built.memo };
  }
  return {
    ...base,
    status: 'create',
    reason: null,
    body: built.body,
    negativeTaxableLines: built.negativeTaxableLines,
    discountAmount: built.discountAmount,
    memo: built.memo,
    customerCreate: createCustomer ? { displayName: invoice.clientName.trim() } : null,
    holdTaxCode: options.holdTaxCode === true,
  };
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

function rowsOf(json: any, key: string): Record<string, unknown>[] {
  const rows = json?.QueryResponse?.[key];
  return Array.isArray(rows) ? rows : [];
}

function blockedPlan(number: string, reason: string): ImportInvoicePlan {
  return {
    invoiceNumber: number,
    status: 'blocked',
    reason,
    customerName: '',
    customerId: null,
    city: null,
    total: 0,
    taxAmount: 0,
    paymentsTotal: 0,
    discountAmount: 0,
    negativeTaxableLines: 0,
    memo: null,
    customerCreate: null,
    body: null,
    payment: null,
    paymentLines: [],
    tax: emptyTaxReport(null),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function flagOn(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

function nonNegativeMoney(value: unknown, field: string): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be 0 or greater.`);
  return money(n);
}

export async function runJobberInvoiceImport(
  args: Record<string, unknown>,
  deps: QboWriteDeps & {
    loadJobberInvoices?: (numbers: string[]) => Promise<JobberInvoiceForQbo[]>;
    qboQuery?: (query: string) => Promise<unknown>;
    rateLimitAttempts?: number;
  } = {}
): Promise<Record<string, unknown>> {
  const numbers = invoiceNumbersFromArgs(args);
  const confirm = flagOn(args.confirm);
  const batchId = parseBatchId(args.batchId, confirm);
  const payments = args.payments === undefined || args.payments === '' ? 'none' : String(args.payments);
  if (payments !== 'none' && payments !== 'undeposited' && payments !== 'deposit' && payments !== 'payout') {
    throw new Error('payments must be none, undeposited, deposit, or payout.');
  }
  const depositId = args.depositId === undefined || args.depositId === '' ? null : String(args.depositId).trim();
  if (payments === 'deposit' && !depositId) throw new Error('depositId is required when payments is deposit.');
  const depositToAccountId = args.depositToAccountId === undefined || args.depositToAccountId === '' ? null : String(args.depositToAccountId).trim();
  const feeAmount = nonNegativeMoney(args.feeAmount, 'feeAmount');
  const feeAccountId = args.feeAccountId === undefined || args.feeAccountId === '' ? null : String(args.feeAccountId).trim();
  if (payments === 'payout' && !depositToAccountId) throw new Error('depositToAccountId is required when payments is payout.');
  if (feeAmount > 0 && !feeAccountId) throw new Error('feeAccountId is required when feeAmount is set.');
  const payoutDate = typeof args.payoutDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.payoutDate.trim()) ? args.payoutDate.trim() : null;
  const createCustomers = flagOn(args.createCustomers);
  const taxOverride = flagOn(args.taxOverride);
  const customerIds = idMap(args.customerIds);
  const itemIds = idMap(args.itemIds);
  const discountItemId = typeof args.discountItemId === 'string' && args.discountItemId.trim() ? args.discountItemId.trim() : null;
  const limit = importChunkLimit(args.limit);
  const { chunk, nextCursor } = sliceInvoiceChunk(numbers, args.cursor, limit);
  const query = deps.qboQuery || ((sql: string) => writeRealmQuery(sql, deps));
  let rateLimitRetries = 0;
  const qbo = (sql: string) => withQboBackoff(() => query(sql), {
    attempts: deps.rateLimitAttempts,
    sleep: deps.sleep,
    onRetry: () => { rateLimitRetries += 1; },
  });
  const load = deps.loadJobberInvoices || ((nums: string[]) => loadJobberInvoices(nums, deps));
  const invoices = await load(chunk);
  const byNumber = new Map(invoices.map((invoice) => [invoice.invoiceNumber, invoice]));
  const cityOverrides = cityOverrideMap(args.taxCodeByCity);
  const cdtfaCities = stringList(args.cdtfaVerifiedCities);
  const overrideId = typeof args.txnTaxCodeId === 'string' && args.txnTaxCodeId.trim() ? args.txnTaxCodeId.trim() : null;
  const overrideExists = overrideId ? await taxCodeIdExists(overrideId, qbo) : false;
  const customerTax = new Map<string, string | null>();
  let discountLookup: string | null | undefined;
  const countyRates = await loadCountyRateIds(qbo);
  const plans: ImportInvoicePlan[] = [];
  for (const number of chunk) {
    try {
      const invoice = byNumber.get(number);
      if (!invoice) {
        plans.push(blockedPlan(number, 'Jobber invoice was not found'));
        continue;
      }
      const existing = rowsOf(await qbo(`select Id, DocNumber from Invoice where DocNumber = ${sqlString(number)}`), 'Invoice');
      const explicitCustomer = customerIds[invoice.clientName] || null;
      let customerId = explicitCustomer;
      let ambiguousCustomer = false;
      if (!explicitCustomer) {
        const customers = rowsOf(await qbo(`select Id, DisplayName from Customer where DisplayName = ${sqlString(invoice.clientName)}`), 'Customer');
        if (customers.length > 1) ambiguousCustomer = true;
        else if (customers[0]?.Id != null) customerId = String(customers[0].Id);
      }
      const items: Record<string, string> = { ...itemIds };
      const ambiguousItems: string[] = [];
      for (const name of [...new Set(invoice.lines.map((line) => line.name).filter(Boolean))]) {
        if (items[name]) continue;
        const found = rowsOf(await qbo(`select Id, Name from Item where Name = ${sqlString(name)}`), 'Item');
        if (found.length > 1) ambiguousItems.push(name);
        else if (found[0]?.Id != null) items[name] = String(found[0].Id);
      }
      if (!discountItemId && (invoice.discountAmount || 0) > 0 && !Object.keys(items).some((name) => name.trim().toLowerCase() === 'discount')) {
        if (discountLookup === undefined) discountLookup = await findDiscountItem(qbo);
        if (discountLookup) items.Discount = discountLookup;
      }
      const tax = await taxForInvoice(invoice, customerId, overrideId, overrideExists, cityOverrides, customerTax, qbo);
      const holdTaxCode = shouldHoldAutomatedSalesTax(invoice.city, cdtfaCities);
      let plan = classifyJobberInvoice(
        invoice,
        new Set(existing.map((row) => String(row.DocNumber))),
        customerId,
        items,
        tax.id,
        tax.reason,
        { taxOverride, discountItemId, createCustomer: createCustomers && !customerId && !ambiguousCustomer, batchId, countyRates, holdTaxCode }
      );
      if (ambiguousCustomer) {
        plan = { ...plan, status: 'blocked', reason: `More than one QuickBooks customer is named "${invoice.clientName}". Pass customerIds.`, body: null, customerCreate: null };
      } else if (ambiguousItems.length) {
        plan = { ...plan, status: 'blocked', reason: `More than one QuickBooks item matches: ${ambiguousItems.join(', ')}. Pass itemIds.`, body: null };
      }
      plans.push(plan);
    } catch (error) {
      if (!isQboRateLimit(error)) throw error;
      plans.push(blockedPlan(number, error instanceof Error ? error.message : 'QuickBooks rate limit.'));
    }
  }
  const creates = plans.filter((row) => row.status === 'create');
  const paymentTotal = money(creates.reduce((sum, row) => sum + row.paymentLines.reduce((inner, line) => inner + line.amount, 0), 0));
  const summary = {
    batchId,
    count: plans.length,
    create: creates.length,
    skip: plans.filter((row) => row.status === 'skip').length,
    blocked: plans.filter((row) => row.status === 'blocked').length,
    invoiceTotal: money(creates.reduce((sum, row) => sum + row.total, 0)),
    taxTotal: money(creates.reduce((sum, row) => sum + row.taxAmount, 0)),
    paymentTotal,
    memosTruncated: plans.filter((row) => row.memo?.truncated).length,
    rateLimitRetries,
    payments,
    depositId,
    warning: payments === 'deposit' ? DEPOSIT_WARNING : null,
    payout: payments === 'payout' ? {
      depositToAccountId,
      feeAmount,
      feeAccountId,
      gross: paymentTotal,
      net: money(paymentTotal - feeAmount),
      paymentCount: creates.reduce((count, row) => count + row.paymentLines.length, 0),
    } : null,
    cursor: args.cursor ? String(args.cursor) : null,
    nextCursor,
    done: nextCursor == null,
    limit,
  };
  const taxMismatch = () => plans.some((row) => row.tax.taxMismatch);
  const countyRateUnresolved = plans.some((row) => row.tax.countyRateUnresolved);
  if (countyRateUnresolved) {
    return {
      ok: false,
      dryRun: true,
      wrote: false,
      ...summary,
      taxMismatch: taxMismatch(),
      countyRateUnresolved: true,
      error: 'County tax rate could not be resolved. Nothing was posted.',
      invoices: plans,
    };
  }
  if (!confirm) {
    return { ok: true, dryRun: true, wrote: false, ...summary, taxMismatch: taxMismatch(), countyRateUnresolved: false, invoices: plans };
  }
  const gate = describeQboWriteGate(deps.env || process.env);
  if (!gate.enabled) {
    return { ok: false, dryRun: true, wrote: false, refused: true, error: gate.blockedReason, ...summary, taxMismatch: taxMismatch(), countyRateUnresolved: false, invoices: plans };
  }
  const posted: Record<string, unknown>[] = [];
  const createdCustomers = new Map<string, string>();
  const payoutPayments: { id: string; amount: number; txnDate: string }[] = [];
  let stoppedForTax = false;
  for (const row of creates) {
    const entry: Record<string, unknown> = { invoiceNumber: row.invoiceNumber, tax: row.tax };
    let customerId = row.customerId;
    if (!customerId && row.customerCreate) {
      customerId = createdCustomers.get(row.customerCreate.displayName) || null;
      if (!customerId) {
        const customerResult = await runQboPlan(
          { tool: 'qbo_import_jobber_invoices', entity: 'Customer', action: 'create', path: '/customer', body: { DisplayName: row.customerCreate.displayName } },
          { confirm: true, batchId, requestId: requestKey(batchId!, row.customerCreate.displayName, 'cus') },
          deps
        );
        entry.customer = { wrote: customerResult.wrote, id: customerResult.ids.id, error: customerResult.error || null };
        if (!customerResult.wrote || !customerResult.ids.id) {
          entry.invoice = { wrote: false, id: null, error: 'Customer was not created.' };
          posted.push(entry);
          continue;
        }
        customerId = customerResult.ids.id;
        createdCustomers.set(row.customerCreate.displayName, customerId);
      }
    }
    const invoiceBody = { ...(row.body || {}), ...(customerId ? { CustomerRef: { value: customerId } } : {}) };
    const invoicePlan: QboPlan = { tool: 'qbo_import_jobber_invoices', entity: 'Invoice', action: 'create', path: '/invoice', body: invoiceBody };
    const invoiceResult = await runQboPlan(invoicePlan, { confirm: true, batchId, requestId: requestKey(batchId!, row.invoiceNumber, 'inv') }, deps);
    if (invoiceResult.wrote) {
      row.tax = assessSavedTax({
        requestedTxnTaxCodeId: row.tax.requestedTxnTaxCodeId,
        city: row.city,
        jobberTax: row.taxAmount,
        qbo: invoiceResult.qbo,
        countyRates,
        holdTaxCode: row.holdTaxCode,
      });
    }
    entry.tax = row.tax;
    entry.invoice = { wrote: invoiceResult.wrote, id: invoiceResult.ids.id, error: invoiceResult.error || null };
    if (invoiceResult.wrote && row.tax.taxMismatch) {
      stoppedForTax = true;
      entry.stopped = 'tax_mismatch';
      try {
        await recordQboAudit(taxMismatchAudit(row, invoiceResult.ids.id || null, batchId, gate, deps), deps);
      } catch (error) {
        entry.auditError = error instanceof Error ? error.message : String(error);
      }
      posted.push(entry);
      break;
    }
    const made: Record<string, unknown>[] = [];
    if (invoiceResult.wrote && payments !== 'none' && invoiceResult.ids.id && customerId) {
      for (let index = 0; index < row.paymentLines.length; index += 1) {
        const line = row.paymentLines[index];
        const paymentBody: Record<string, unknown> = {
          CustomerRef: { value: customerId },
          TotalAmt: line.amount,
          TxnDate: line.txnDate,
          PaymentRefNum: String(line.ref).slice(0, 21),
        };
        if (line.applied > 0) {
          paymentBody.Line = [{ Amount: line.applied, LinkedTxn: [{ TxnId: invoiceResult.ids.id, TxnType: 'Invoice' }] }];
        }
        const paymentPlan: QboPlan = { tool: 'qbo_import_jobber_invoices', entity: 'Payment', action: 'create', path: '/payment', body: paymentBody };
        const paymentResult = await runQboPlan(paymentPlan, { confirm: true, batchId, requestId: requestKey(batchId!, row.invoiceNumber, index === 0 ? 'pay' : `pay${index + 1}`) }, deps);
        made.push({ wrote: paymentResult.wrote, id: paymentResult.ids.id, amount: line.amount, txnDate: line.txnDate, error: paymentResult.error || null });
        if (payments === 'deposit' && paymentResult.wrote && paymentResult.ids.id && depositId) {
          const link: QboPlan = {
            tool: 'qbo_import_jobber_invoices',
            entity: 'Deposit',
            action: 'update',
            path: '/deposit',
            body: { Id: depositId },
            read: { path: `/deposit/${depositId}`, apply: 'linkPayment' },
            changes: { paymentId: paymentResult.ids.id, amount: line.amount },
          };
          const linkResult = await runQboPlan(link, { confirm: true, batchId, requestId: requestKey(batchId!, row.invoiceNumber, index === 0 ? 'dep' : `dep${index + 1}`) }, deps);
          made[made.length - 1].deposit = { wrote: linkResult.wrote, id: linkResult.ids.id, error: linkResult.error || null };
        }
        if (payments === 'payout' && paymentResult.wrote && paymentResult.ids.id) {
          payoutPayments.push({ id: paymentResult.ids.id, amount: line.amount, txnDate: line.txnDate });
        }
      }
    }
    if (made.length) entry.payments = made;
    posted.push(entry);
  }
  if (!stoppedForTax && payments === 'payout' && payoutPayments.length && depositToAccountId) {
    const txnDate = payoutDate || payoutPayments.map((row) => row.txnDate).sort().at(-1);
    const depositPlan = buildDeposit({
      depositToAccountId,
      ...(txnDate ? { txnDate } : {}),
      privateNote: batchId ? `Jobber payout ${batchId}` : 'Jobber payout',
      lines: [
        ...payoutPayments.map((row) => ({ amount: row.amount, paymentId: row.id })),
        ...(feeAmount > 0 && feeAccountId ? [{ amount: -feeAmount, accountId: feeAccountId, description: 'Jobber fee' }] : []),
      ],
    });
    const payoutResult = await runQboPlan(
      { ...depositPlan, tool: 'qbo_import_jobber_invoices' },
      { confirm: true, batchId, requestId: requestKey(batchId!, 'payout', 'out') },
      deps
    );
    posted.push({ payout: { wrote: payoutResult.wrote, id: payoutResult.ids.id, error: payoutResult.error || null, net: money(paymentTotal - feeAmount) } });
  }
  return {
    ok: !stoppedForTax && posted.every((row) => {
      if (row.payout) return (row.payout as { wrote: boolean }).wrote;
      if (row.invoice) return (row.invoice as { wrote: boolean }).wrote;
      return true;
    }) && plans.every((row) => row.status !== 'blocked'),
    dryRun: false,
    wrote: posted.some((row) => (row.invoice as { wrote?: boolean } | undefined)?.wrote),
    ...summary,
    taxMismatch: taxMismatch(),
    countyRateUnresolved: false,
    stoppedForTax,
    invoices: plans,
    posted,
  };
}

function idMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, id] of Object.entries(value as Record<string, unknown>)) {
    if (typeof id === 'string' && id.trim() && key.trim()) out[key.trim()] = id.trim();
  }
  return out;
}

function cityOverrideMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, id] of Object.entries(value as Record<string, unknown>)) {
    if (typeof id === 'string' && id.trim()) out[key] = id.trim();
  }
  return out;
}

async function taxCodeIdExists(id: string, query: (sql: string) => Promise<unknown>): Promise<boolean> {
  if (!/^\d{1,10}$/.test(id)) return false;
  try {
    const found = rowsOf(await query(`select Id from TaxCode where Id = '${id}'`), 'TaxCode');
    return found.some((row) => String(row.Id) === id);
  } catch (error) {
    if (isQboRateLimit(error)) throw error;
    return false;
  }
}

async function taxForInvoice(
  invoice: JobberInvoiceForQbo,
  customerId: string | null,
  overrideId: string | null,
  overrideExists: boolean,
  cityOverrides: Record<string, string>,
  customerTax: Map<string, string | null>,
  query: (sql: string) => Promise<unknown>
): Promise<{ id: string | null; reason: string }> {
  if (overrideId) {
    return overrideExists
      ? { id: overrideId, reason: '' }
      : { id: null, reason: `txnTaxCodeId ${overrideId} is not a QuickBooks TaxCode id.` };
  }
  const fromCity = taxCodeIdForCity(invoice.city, cityOverrides);
  if (fromCity) return { id: fromCity, reason: '' };
  if (customerId) {
    if (!customerTax.has(customerId)) customerTax.set(customerId, await taxCodeFromCustomer(customerId, query));
    const prior = customerTax.get(customerId);
    if (prior) return { id: prior, reason: '' };
  }
  return { id: null, reason: taxCodeMissingReason(invoice.city) };
}

async function taxCodeFromCustomer(customerId: string, query: (sql: string) => Promise<unknown>): Promise<string | null> {
  try {
    const invoices = rowsOf(
      await query(`select TxnTaxDetail, Line from Invoice where CustomerRef = '${customerId}' MAXRESULTS 5`),
      'Invoice'
    );
    for (const row of invoices) {
      const detail = row.TxnTaxDetail as { TxnTaxCodeRef?: { value?: string } } | undefined;
      const id = detail?.TxnTaxCodeRef?.value;
      if (id) return String(id);
    }
  } catch (error) {
    if (isQboRateLimit(error)) throw error;
    return null;
  }
  return null;
}

function addressText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function propertyAddress(raw: Record<string, unknown> | null | undefined): JobberPropertyAddress | null {
  if (!raw) return null;
  const address: JobberPropertyAddress = {
    line1: addressText(raw.street1) || addressText(raw.street),
    line2: addressText(raw.street2),
    city: addressText(raw.city),
    province: addressText(raw.province),
    postalCode: addressText(raw.postalCode),
    country: addressText(raw.country),
  };
  if (!address.line1 && !address.line2 && !address.city && !address.postalCode) return null;
  return address;
}

function jobProperty(node: Record<string, any>): { city: string | null; address: JobberPropertyAddress | null; addressConflict: string | null } {
  const jobs = node.jobs?.nodes || [];
  const addresses = jobs.map((job: { property?: { address?: Record<string, unknown> } }) => propertyAddress(job?.property?.address));
  const resolved = resolveJobProperties(addresses);
  return { city: resolved.address?.city || null, address: resolved.address, addressConflict: resolved.conflict };
}

function rateIdsFromTaxCode(row: Record<string, unknown>): string[] | null {
  const list = row.SalesTaxRateList as { TaxRateDetail?: unknown } | undefined;
  if (!list || !Array.isArray(list.TaxRateDetail)) return null;
  return list.TaxRateDetail.map((detail) => {
    if (!detail || typeof detail !== 'object') return '';
    const id = (detail as { TaxRateRef?: { value?: unknown } }).TaxRateRef?.value;
    return id == null ? '' : String(id).trim();
  }).filter(Boolean);
}

async function loadCountyRateIds(query: (sql: string) => Promise<unknown>): Promise<CountyRateIds> {
  try {
    const rows = rowsOf(
      await query(`select Id, SalesTaxRateList from TaxCode where Id in ('${SAN_DIEGO_COUNTY_TAX_CODE_ID}', '${RIVERSIDE_COUNTY_TAX_CODE_ID}', '${SAN_BERNARDINO_COUNTY_TAX_CODE_ID}')`),
      'TaxCode'
    );
    return verifyCountyRateIds(rows.map((row) => ({ id: row.Id == null ? '' : String(row.Id), rateIds: rateIdsFromTaxCode(row) })));
  } catch (error) {
    if (isQboRateLimit(error)) throw error;
    return fixedCountyRateIds();
  }
}

function taxMismatchAudit(
  row: ImportInvoicePlan,
  qboId: string | null,
  batchId: string | null,
  gate: { realmId: string | null; environment: QboAuditEntry['environment'] },
  deps: QboWriteDeps
): QboAuditEntry {
  const reason = row.tax.taxMismatchReasons.join(' ');
  return {
    actor: deps.actor?.trim() || 'unknown',
    tool: 'qbo_import_jobber_invoices',
    requestId: requestKey(batchId || 'batch', row.invoiceNumber, 'tax'),
    dryRun: false,
    confirmed: true,
    ok: false,
    refused: false,
    status: 'tax_mismatch',
    realmId: gate.realmId,
    environment: gate.environment,
    entity: 'Invoice',
    payload: row.tax,
    qboResponse: null,
    qboIds: { id: qboId, syncToken: null, docNumber: row.invoiceNumber },
    error: reason,
    reason,
    batchId,
    action: 'create',
    created: false,
  };
}

function requestKey(batchId: string, invoiceNumber: string, kind: string): string {
  const raw = `${kind}-${batchId}-${invoiceNumber}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50);
  return raw.length >= 8 ? raw : `${raw}00000000`.slice(0, 8);
}

async function loadJobberInvoices(numbers: string[], deps: QboWriteDeps): Promise<JobberInvoiceForQbo[]> {
  const { jobberGraphql, assertNoJobberErrors } = await import('../jobber/client.ts');
  const out: JobberInvoiceForQbo[] = [];
  for (const number of numbers) {
    // Same Address fields as list_tasks in src/lib/jobber/mcp-tasks.ts, including street and country.
    const res = await jobberGraphql(
      `query ImportInvoice($searchTerm: String!) {
        invoices(first: 5, searchTerm: $searchTerm) {
          nodes {
            invoiceNumber issuedDate dueDate message
            amounts { subtotal discountAmount total taxAmount paymentsTotal }
            paymentRecords(first: 20) { nodes { id amount entryDate adjustmentType } }
            client { name }
            jobs(first: 3) { nodes { property { address { street street1 street2 city province postalCode country } } } }
            lineItems(first: 40) { nodes { name description quantity unitPrice taxable } }
          }
        }
      }`,
      { searchTerm: number },
      { env: deps.env, fetchImpl: deps.fetchImpl }
    );
    assertNoJobberErrors(res, 'qbo_import_jobber_invoices');
    const nodes = (res.data?.invoices?.nodes || []) as Record<string, any>[];
    const match = nodes.find((node) => String(node.invoiceNumber) === number);
    if (!match) continue;
    const property = jobProperty(match);
    out.push({
      invoiceNumber: number,
      issuedDate: String(match.issuedDate),
      dueDate: match.dueDate ? String(match.dueDate) : null,
      message: match.message ? String(match.message) : null,
      clientName: String(match.client?.name || ''),
      city: property.city,
      address: property.address,
      addressConflict: property.addressConflict,
      total: Number(match.amounts?.total || 0),
      taxAmount: Number(match.amounts?.taxAmount || 0),
      paymentsTotal: Number(match.amounts?.paymentsTotal || 0),
      discountAmount: Number(match.amounts?.discountAmount || 0),
      payments: (match.paymentRecords?.nodes || []).map((record: Record<string, unknown>) => ({
        id: record.id ? String(record.id) : null,
        amount: Number(record.amount || 0),
        entryDate: record.entryDate ? String(record.entryDate) : null,
        adjustmentType: record.adjustmentType ? String(record.adjustmentType) : null,
      })),
      lines: (match.lineItems?.nodes || []).map((line: Record<string, unknown>) => ({
        name: String(line.name || ''),
        description: line.description ? String(line.description) : null,
        quantity: Number(line.quantity || 0),
        unitPrice: Number(line.unitPrice || 0),
        taxable: line.taxable === true,
      })),
    });
  }
  return out;
}

/** The one active QuickBooks item named "discount" in any case (QBO's Name filter ignores case), or null. */
export async function findDiscountItem(qbo: (sql: string) => Promise<unknown>): Promise<string | null> {
  const found = rowsOf(await qbo(`select Id, Name, Active from Item where Name = 'Discount'`), 'Item')
    .filter((row) => typeof row.Name === 'string' && row.Name.trim().toLowerCase() === 'discount' && row.Active !== false);
  return found.length === 1 && found[0].Id != null ? String(found[0].Id) : null;
}
