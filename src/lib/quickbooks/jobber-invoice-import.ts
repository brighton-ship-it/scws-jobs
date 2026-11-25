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
 *   A negative line Jobber taxed (a warranty credit) stays TAX when that matches
 *   Jobber within $0.01. Invoice 6030 is that case. When taxable would not match,
 *   including a negative taxable sum or a Jobber tax of $0, the line is sent NON.
 *   Invoice 5898 is a $200 untaxed line plus a taxable -$50 line and $0 tax, so
 *   the -$50 is NON. negativeLinesNonTaxable forces NON on one invoice. A discount
 *   is TAX or NON, whichever makes the tax match Jobber within $0.01. Invoice 6072
 *   ($21,742.52, $1,000 discount, tax $1,685.05) stays NON. Invoice 6007
 *   ($6,356, $500 discount, tax $453.84) is TAX; a non-taxable discount would be
 *   $492.59. If neither side is within $0.01 the invoice is refused. discountTaxable
 *   forces one side. A discount on an invoice with no tax stays NON.
 * - Before a create, each TAX line's QuickBooks item is read. An exempt tax
 *   category (EUC-99990101, seller-exempt) or an item QuickBooks will not tax
 *   blocks that invoice. The tax computed from the line flags and the tax code
 *   rate must be within $0.01 of Jobber. Confirm uses the same checks and does
 *   not create the invoice when they fail.
 * - EmailStatus is never set
 *
 * ServiceDate is not copied: the invoice line we can read does not carry the visit date.
 * A deposit that already booked the payout to 4010 Sales is rewritten with
 * qbo_relink_deposit, not by linking a second payment onto that income.
 */
import { recordQboAudit, runQboPlan, writeRealmQuery, type QboAuditEntry, type QboWriteDeps } from './durable-write.ts';
import { isQboRateLimit, withQboBackoff } from './qbo-backoff.ts';
import { KNOWN_QBO_TAX_CODE_IDS, TAX_RATE_IDS_BY_TAX_CODE, countyNameForCity, normalizePlace, taxCodeIdForCity, taxCodeMissingReason, unknownTaxCodeReason, type CountyName } from './tax-codes.ts';
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

/** QBO item for a Jobber line whose name contains "hoist", any case. */
export const HOIST_ITEM_ID = '1519';
const PARTS_ITEM_ID = '391';
/** Live QuickBooks item id. There is no item 030. */
const LABOR_ITEM_ID = '30';
export const ABSORBED_TAX_DESCRIPTION = 'Sales tax absorbed by SCWS';
export const TAXES_EXPENSE_ACCOUNT_ID = '18';

export type AbsorbTaxShortfall = {
  expectedQboTax: number;
  jobberTax: number;
  expenseAccountId: string;
  itemId: string;
};

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
  absorb?: AbsorbTaxShortfall | null;
  /** Which discount tax treatment was used, and the tax each way. Null when there is no discount. */
  discountTax?: DiscountTaxPreview | null;
  /** How negative lines Jobber marked taxable were sent. Null when there are none. */
  negativeLineTax?: NegativeLineTaxPreview | null;
  /** Sum of TAX line amounts QuickBooks will actually tax. Exempt and non-taxable items contribute 0. */
  expectedTaxableAmount?: number | null;
  /** Tax from expectedTaxableAmount and the tax code rate. Null when the rate is unknown and the base is not zero. */
  expectedTax?: number | null;
  /** One entry per Jobber line. fallbackItemUsed is true only when the id came from a fallback rule. */
  lines?: ImportLinePreview[];
};

export type DiscountTaxPreview = {
  /** Side that was posted. Null when neither side matched and the invoice is blocked. */
  taxable: boolean | null;
  taxCode: 'TAX' | 'NON' | null;
  taxIfNon: number | null;
  taxIfTaxable: number | null;
  /** True when both treatments are within $0.01 of the Jobber tax. The closer side is used, and a tie stays non-taxable. */
  bothMatch: boolean;
  forced: boolean;
};

export type NegativeLineTaxPreview = {
  /** Side sent for negative lines Jobber marked taxable. */
  taxable: boolean;
  taxCode: 'TAX' | 'NON';
  forced: boolean;
  /** Tax on the positive taxable lines plus those negative lines, before the invoice-level discount. Null when no rate was available. */
  taxIfTaxable: number | null;
  /** Tax on the positive taxable lines only. */
  taxIfNon: number | null;
};

export type ImportLinePreview = {
  name: string;
  itemId: string | null;
  fallbackItemUsed: boolean;
  /** QuickBooks TaxClassificationRef value for this line's item. Null when the item was not read or has no category. */
  itemTaxCategory: string | null;
  /** Amount of this line included in the taxable base QuickBooks will compute. 0 when the line is NON or the item will not be taxed. */
  expectedTaxableAmount: number;
};

/**
 * Tax categories QuickBooks leaves out of the taxable base even on a TAX line.
 * EUC-99990101 is the seller-exempt product. EUC-99990201 is the nontaxable service
 * paired with taxable service EUC-99990202.
 */
export const EXEMPT_TAX_CATEGORY_PREFIXES = ['EUC-99990101', 'EUC-99990201'] as const;

export type ItemTaxSnapshot = {
  id: string;
  name: string | null;
  /** Null when QuickBooks did not return the Taxable flag. */
  taxable: boolean | null;
  taxClassificationId: string | null;
  taxClassificationName: string | null;
};

const TAX_MATCH = 0.01 + 1e-9;

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

function savedInvoiceBits(qbo: unknown): { totalAmt: number | null; lines: Array<{ description: string | null; amount: number | null }> } {
  const entity = qbo && typeof qbo === 'object' ? (qbo as Record<string, unknown>) : null;
  const invoice = entity && entity.Invoice && typeof entity.Invoice === 'object' ? (entity.Invoice as Record<string, unknown>) : entity;
  const totalRaw = invoice?.TotalAmt;
  const totalAmt = totalRaw == null || totalRaw === '' || !Number.isFinite(Number(totalRaw)) ? null : money(Number(totalRaw));
  const lines = Array.isArray(invoice?.Line) ? invoice.Line as Array<Record<string, unknown>> : [];
  return {
    totalAmt,
    lines: lines.map((line) => ({
      description: typeof line.Description === 'string' ? line.Description : null,
      amount: line.Amount == null || line.Amount === '' || !Number.isFinite(Number(line.Amount)) ? null : money(Number(line.Amount)),
    })),
  };
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
  /** CDTFA tax stays on the invoice. The customer total is brought back to Jobber with a non-taxable absorbed line. */
  absorb?: { expectedQboTax: number; jobberTax: number; jobberTotal: number } | null;
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
  if (input.absorb) {
    if (!taxWithinCent(saved.total, money(input.absorb.expectedQboTax))) {
      reasons.push(`Saved tax ${saved.total ?? 'missing'} does not match expected QBO tax ${money(input.absorb.expectedQboTax)} within $0.01.`);
    }
    const savedInvoice = savedInvoiceBits(input.qbo);
    if (!taxWithinCent(savedInvoice.totalAmt, money(input.absorb.jobberTotal))) {
      reasons.push(`Saved total ${savedInvoice.totalAmt ?? 'missing'} does not match Jobber total ${money(input.absorb.jobberTotal)} within $0.01.`);
    }
    const shortfall = money(input.absorb.expectedQboTax - input.absorb.jobberTax);
    const absorbed = savedInvoice.lines.filter((line) => line.description === ABSORBED_TAX_DESCRIPTION);
    if (shortfall > 0.009) {
      const expectedAmount = money(-shortfall);
      if (absorbed.length !== 1 || !taxWithinCent(absorbed[0].amount, expectedAmount)) {
        reasons.push(`Absorbed line ${absorbed.length === 1 ? absorbed[0].amount : 'missing'} does not equal ${expectedAmount} (jobber tax minus expected QBO tax). The shortfall is ${shortfall}.`);
      }
    } else if (absorbed.length) {
      reasons.push('No tax shortfall, but a Sales tax absorbed by SCWS line was saved.');
    }
  } else if (!taxWithinCent(saved.total, money(input.jobberTax))) {
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

/** Case-insensitive itemIds entry. Does not apply fallback rules. */
export function explicitItemId(name: string, itemIds: Record<string, string> = {}): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  if (itemIds[name]?.trim()) return itemIds[name].trim();
  for (const [label, id] of Object.entries(itemIds)) {
    if (label.trim().toLowerCase() === key && String(id).trim()) return String(id).trim();
  }
  return null;
}

/** hoist → 1519, parts → 391, labor → 30. Used only after itemIds and an exact name lookup both miss. Parts wins over labor, and hoist wins over both. */
export function fallbackItemId(name: string): string | null {
  if (/\bhoist\b/i.test(name)) return HOIST_ITEM_ID;
  if (/\bparts\b/i.test(name)) return PARTS_ITEM_ID;
  if (/\blabor\b/i.test(name)) return LABOR_ITEM_ID;
  return null;
}

export function qboItemIdForLineName(name: string, itemIds: Record<string, string> = {}): string | null {
  return explicitItemId(name, itemIds) || fallbackItemId(name);
}

/**
 * Pick TAX or NON for the synthetic discount line. taxableBase is the sum of
 * lines that will be sent as TAX (negative credits only when they stay taxable).
 * rate is a decimal such as 0.0775. Neither match within $0.01 is an error.
 */
export function chooseDiscountTaxable(input: { taxableBase: number; discount: number; jobberTax: number; rate: number }): { taxable: boolean; taxIfNon: number; taxIfTaxable: number; bothMatch: boolean } | { error: string; taxIfNon: number; taxIfTaxable: number; bothMatch: false } {
  const taxIfNon = money(input.taxableBase * input.rate);
  const taxIfTaxable = money((input.taxableBase - input.discount) * input.rate);
  const nonFits = Math.abs(taxIfNon - input.jobberTax) <= 0.01 + 1e-9;
  const yesFits = Math.abs(taxIfTaxable - input.jobberTax) <= 0.01 + 1e-9;
  if (yesFits && nonFits) {
    const yesDelta = Math.abs(taxIfTaxable - input.jobberTax);
    const nonDelta = Math.abs(taxIfNon - input.jobberTax);
    return { taxable: yesDelta + 1e-9 < nonDelta, taxIfNon, taxIfTaxable, bothMatch: true };
  }
  if (yesFits) return { taxable: true, taxIfNon, taxIfTaxable, bothMatch: false };
  if (nonFits) return { taxable: false, taxIfNon, taxIfTaxable, bothMatch: false };
  return {
    error: `Neither a taxable nor a non-taxable discount matches Jobber tax ${money(input.jobberTax)} within $0.01 (non-taxable ${taxIfNon}, taxable ${taxIfTaxable}). Pass discountTaxable to choose.`,
    taxIfNon,
    taxIfTaxable,
    bothMatch: false,
  };
}

/** 0.0775 stays a decimal. 7.75 is a percent. */
export function normalizeTaxRate(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value > 1 ? money(value) / 100 : value;
}

/**
 * Whether negative lines Jobber marked taxable should be sent as TAX.
 * Same $0.01 rule as the invoice-level discount. A warranty credit on a
 * taxable invoice stays TAX when that is what matches Jobber. A negative
 * taxable sum, or any treatment that would not match, is sent NON.
 */
export function chooseNegativeLineTaxable(input: {
  positiveTaxable: number;
  negativeTaxable: number;
  discount: number;
  jobberTax: number;
  rate: number | null;
  forceNonTaxable?: boolean;
  discountTaxable?: boolean | null;
}): { taxable: boolean; forced: boolean; taxIfTaxable: number | null; taxIfNon: number | null } {
  if (input.forceNonTaxable === true) {
    return { taxable: false, forced: true, taxIfTaxable: null, taxIfNon: null };
  }
  const positive = money(input.positiveTaxable);
  const negative = money(input.negativeTaxable);
  const discount = money(Math.max(0, input.discount));
  const jobber = money(input.jobberTax);
  const rate = input.rate != null && Number.isFinite(input.rate) ? input.rate : null;
  if (rate == null) {
    const base = money(positive + negative);
    if (base < -0.009) return { taxable: false, forced: false, taxIfTaxable: null, taxIfNon: null };
    if (jobber <= 0 && base > 0.009) return { taxable: false, forced: false, taxIfTaxable: null, taxIfNon: null };
    return { taxable: true, forced: false, taxIfTaxable: null, taxIfNon: null };
  }
  const taxOn = (base: number) => money(base * rate);
  const taxIfTaxable = taxOn(money(positive + negative));
  const taxIfNon = taxOn(positive);
  const discountSides: boolean[] = input.discountTaxable === true
    ? [true]
    : input.discountTaxable === false
      ? [false]
      : discount > 0 ? [true, false] : [false];
  const fitting: Array<{ taxable: boolean; tax: number }> = [];
  for (const taxable of [true, false]) {
    for (const discountTaxable of discountSides) {
      const base = money(positive + (taxable ? negative : 0) - (discountTaxable ? discount : 0));
      const tax = taxOn(base);
      if (Math.abs(tax - jobber) <= TAX_MATCH) fitting.push({ taxable, tax });
    }
  }
  if (!fitting.length) return { taxable: false, forced: false, taxIfTaxable, taxIfNon };
  fitting.sort((a, b) => {
    const delta = Math.abs(a.tax - jobber) - Math.abs(b.tax - jobber);
    if (Math.abs(delta) > 1e-9) return delta;
    if (a.taxable !== b.taxable) return a.taxable ? -1 : 1;
    return 0;
  });
  return { taxable: fitting[0].taxable, forced: false, taxIfTaxable, taxIfNon };
}

export function isExemptTaxCategory(id: string | null | undefined, name?: string | null): boolean {
  const code = (id || '').trim().toUpperCase();
  if (EXEMPT_TAX_CATEGORY_PREFIXES.some((prefix) => code.startsWith(prefix))) return true;
  return /exempt|non-?taxable|nontaxable/i.test(name || '');
}

/** Why QuickBooks would ignore TAX on a line that uses this item. Null when the line can be taxed. */
export function taxLineItemProblem(item: ItemTaxSnapshot): string | null {
  const who = `QuickBooks item ${item.id}${item.name ? ` (${item.name})` : ''}`;
  if (isExemptTaxCategory(item.taxClassificationId, item.taxClassificationName)) {
    const id = item.taxClassificationId || 'unspecified';
    const category = item.taxClassificationName ? `${id} (${item.taxClassificationName})` : id;
    return `${who} has exempt tax category ${category}. QuickBooks will leave a TAX line that uses it out of the taxable base.`;
  }
  if (item.taxable === false) {
    return `${who} is non-taxable. QuickBooks will not tax a line that uses it.`;
  }
  return null;
}

export type PlannedTaxCheck = {
  lines: ImportLinePreview[];
  expectedTaxableAmount: number;
  expectedTax: number | null;
  reason: string | null;
};

/** Tax QuickBooks will compute from the lines we would send, after exempt and non-taxable items are left out. */
export function assessImportTax(input: {
  invoiceLines: Array<{ name: string; amount: number; itemId: string | null; fallbackItemUsed: boolean }>;
  bodyLines: Array<{ amount: number; taxCode: string | null; itemId: string | null }>;
  items: Map<string, ItemTaxSnapshot | null>;
  jobberTax: number;
  rate: number | null;
  taxOverride: boolean;
  absorbExpectedTax: number | null;
}): PlannedTaxCheck {
  const problems: string[] = [];
  const seen = new Set<string>();
  const push = (text: string) => {
    if (seen.has(text)) return;
    seen.add(text);
    problems.push(text);
  };
  const problemFor = (itemId: string | null, taxCode: string | null): string | null => {
    if (taxCode !== 'TAX' || !itemId) return null;
    const item = input.items.get(itemId);
    return item ? taxLineItemProblem(item) : null;
  };
  const lines = input.invoiceLines.map((line, index) => {
    const body = input.bodyLines[index];
    const taxCode = body?.taxCode ?? null;
    const item = line.itemId ? input.items.get(line.itemId) ?? null : null;
    const problem = problemFor(line.itemId, taxCode);
    if (problem) push(problem);
    const amount = body ? body.amount : line.amount;
    return {
      name: line.name,
      itemId: line.itemId,
      fallbackItemUsed: line.fallbackItemUsed,
      itemTaxCategory: item?.taxClassificationId ?? null,
      expectedTaxableAmount: taxCode === 'TAX' && !problem ? money(amount) : 0,
    };
  });
  let base = 0;
  for (const body of input.bodyLines) {
    if (body.taxCode !== 'TAX') continue;
    const problem = problemFor(body.itemId, body.taxCode);
    if (problem) {
      push(problem);
      continue;
    }
    base = money(base + body.amount);
  }
  const absorb = input.absorbExpectedTax != null;
  const target = absorb ? money(input.absorbExpectedTax || 0) : money(input.jobberTax);
  const targetLabel = absorb ? 'expected QuickBooks tax' : 'Jobber tax';
  let expectedTax: number | null = null;
  if (base < -0.009) {
    push(`Taxable amount ${money(base)} is negative, so QuickBooks would not match ${targetLabel} ${target}.`);
    expectedTax = input.rate != null ? money(base * input.rate) : null;
  } else if (Math.abs(base) <= 0.009) {
    expectedTax = 0;
  } else if (input.rate != null) {
    expectedTax = money(base * input.rate);
  }
  if (!input.taxOverride && expectedTax != null && Math.abs(expectedTax - target) > TAX_MATCH) {
    push(`Computed tax ${expectedTax} on taxable amount ${money(base)} does not match ${targetLabel} ${target} within $0.01.`);
  }
  return { lines, expectedTaxableAmount: money(base), expectedTax, reason: problems.length ? problems.join(' ') : null };
}

function taxableLineBase(invoice: JobberInvoiceForQbo, negativeTaxable: boolean): number {
  return money(invoice.lines.reduce((sum, line) => {
    const amount = money(line.quantity * line.unitPrice);
    if (!line.taxable) return sum;
    if (amount < 0 && !negativeTaxable) return sum;
    return sum + amount;
  }, 0));
}

function previewFromChoice(choice: { taxable?: boolean; taxIfNon: number; taxIfTaxable: number; bothMatch: boolean }, forced: boolean, code: 'TAX' | 'NON' | null): DiscountTaxPreview {
  return {
    taxable: code == null ? null : code === 'TAX',
    taxCode: code,
    taxIfNon: choice.taxIfNon,
    taxIfTaxable: choice.taxIfTaxable,
    bothMatch: choice.bothMatch,
    forced,
  };
}

function discountTaxCode(
  invoice: JobberInvoiceForQbo,
  discountAmount: number,
  discountTaxable: boolean | null | undefined,
  taxRate: number | null | undefined,
  taxableBase: number
): { code: 'TAX' | 'NON'; preview: DiscountTaxPreview } | { error: string; preview: DiscountTaxPreview } {
  const rate = normalizeTaxRate(taxRate);
  const computed = rate == null
    ? null
    : chooseDiscountTaxable({
      taxableBase,
      discount: discountAmount,
      jobberTax: money(invoice.taxAmount),
      rate,
    });
  if (discountTaxable === true || discountTaxable === false) {
    const code = discountTaxable ? 'TAX' : 'NON';
    return {
      code,
      preview: computed
        ? previewFromChoice(computed, true, code)
        : { taxable: discountTaxable, taxCode: code, taxIfNon: null, taxIfTaxable: null, bothMatch: false, forced: true },
    };
  }
  if (money(invoice.taxAmount) <= 0) {
    return {
      code: 'NON',
      preview: computed
        ? previewFromChoice(computed, false, 'NON')
        : { taxable: false, taxCode: 'NON', taxIfNon: null, taxIfTaxable: null, bothMatch: false, forced: false },
    };
  }
  if (!computed) {
    return {
      error: 'Cannot tell whether the discount is taxable. Pass taxRate (0.0775 or 7.75) or discountTaxable.',
      preview: { taxable: null, taxCode: null, taxIfNon: null, taxIfTaxable: null, bothMatch: false, forced: false },
    };
  }
  if ('error' in computed) return { error: computed.error, preview: previewFromChoice(computed, false, null) };
  const code = computed.taxable ? 'TAX' : 'NON';
  return { code, preview: previewFromChoice(computed, false, code) };
}

type InvoiceBuildOptions = {
  taxOverride?: boolean;
  discountItemId?: string | null;
  batchId?: string | null;
  holdTaxCode?: boolean;
  absorb?: AbsorbTaxShortfall | null;
  discountTaxable?: boolean | null;
  taxRate?: number | null;
  negativeLinesNonTaxable?: boolean | null;
};

type BuiltInvoice = {
  body: Record<string, unknown> | null;
  missingItems: string[];
  negativeTaxableLines: number;
  discountAmount: number;
  memo: MemoReport;
  error?: string;
  discountTax: DiscountTaxPreview | null;
  negativeLineTax: NegativeLineTaxPreview | null;
};

export function buildJobberSyncedInvoice(
  invoice: JobberInvoiceForQbo,
  customerId: string,
  itemsByName: Record<string, string>,
  txnTaxCodeId: string,
  options: InvoiceBuildOptions = {}
): BuiltInvoice {
  const memo = memoReport(invoice.message);
  const missing = [...new Set(invoice.lines.map((line) => line.name).filter((name) => name && !qboItemIdForLineName(name, itemsByName)))];
  if (missing.length || !invoice.lines.length) {
    return { body: null, missingItems: missing.length ? missing : ['(no lines)'], negativeTaxableLines: 0, discountAmount: 0, memo, discountTax: null, negativeLineTax: null };
  }
  const lineAmounts = invoice.lines.map((line) => money(line.quantity * line.unitPrice));
  const statedDiscount = money(Math.max(0, invoice.discountAmount || 0));
  const negativeAlready = money(lineAmounts.filter((amount) => amount < 0).reduce((sum, amount) => sum + amount, 0));
  const discountAmount = statedDiscount > 0 && Math.abs(negativeAlready + statedDiscount) > 0.009 ? statedDiscount : 0;
  const positiveTaxable = money(lineAmounts.reduce((sum, amount, index) => (invoice.lines[index].taxable && amount > 0 ? sum + amount : sum), 0));
  const negativeTaxable = money(lineAmounts.reduce((sum, amount, index) => (invoice.lines[index].taxable && amount < 0 ? sum + amount : sum), 0));
  const hasNegativeTaxable = negativeTaxable < -0.009;
  const negativeDecision = hasNegativeTaxable
    ? chooseNegativeLineTaxable({
      positiveTaxable,
      negativeTaxable,
      discount: discountAmount,
      jobberTax: money(invoice.taxAmount),
      rate: normalizeTaxRate(options.taxRate),
      forceNonTaxable: options.negativeLinesNonTaxable === true,
      discountTaxable: options.discountTaxable,
    })
    : null;
  const negativeLineTax: NegativeLineTaxPreview | null = negativeDecision
    ? {
      taxable: negativeDecision.taxable,
      taxCode: negativeDecision.taxable ? 'TAX' : 'NON',
      forced: negativeDecision.forced,
      taxIfTaxable: negativeDecision.taxIfTaxable,
      taxIfNon: negativeDecision.taxIfNon,
    }
    : null;
  const negativeIsTaxable = negativeDecision ? negativeDecision.taxable : true;
  let negativeTaxableLines = 0;
  const lines = invoice.lines.map((line, index) => {
    const amount = lineAmounts[index];
    if (line.taxable && amount < 0) negativeTaxableLines += 1;
    const sendTaxable = line.taxable && (amount < 0 ? negativeIsTaxable : true);
    const itemId = qboItemIdForLineName(line.name, itemsByName);
    return {
      Amount: amount,
      DetailType: 'SalesItemLineDetail',
      ...(line.description ? { Description: line.description } : {}),
      SalesItemLineDetail: {
        ItemRef: { value: itemId || '' },
        Qty: line.quantity,
        UnitPrice: money(line.unitPrice),
        TaxCodeRef: { value: sendTaxable ? 'TAX' : 'NON' },
      },
    };
  });
  let discountTax: DiscountTaxPreview | null = null;
  if (discountAmount > 0) {
    const discountKey = Object.keys(itemsByName).find((name) => name.trim().toLowerCase() === 'discount');
    const positive = invoice.lines.find((line) => line.quantity * line.unitPrice > 0);
    const discountItem = options.discountItemId || (discountKey ? itemsByName[discountKey] : '') || (positive ? qboItemIdForLineName(positive.name, itemsByName) : '') || '';
    if (!discountItem) {
      return { body: null, missingItems: ['Discount'], negativeTaxableLines, discountAmount, memo, discountTax: null, negativeLineTax };
    }
    if (money(lineAmounts.reduce((sum, amount) => sum + amount, 0) - discountAmount) < 0) {
      return { body: null, missingItems: [], negativeTaxableLines, discountAmount, memo, discountTax: null, negativeLineTax, error: 'Discount is larger than the line total.' };
    }
    const decided = discountTaxCode(invoice, discountAmount, options.discountTaxable, options.taxRate, taxableLineBase(invoice, negativeIsTaxable));
    discountTax = decided.preview;
    if ('error' in decided) {
      return { body: null, missingItems: [], negativeTaxableLines, discountAmount, memo, discountTax, negativeLineTax, error: decided.error };
    }
    lines.push({
      Amount: money(-discountAmount),
      DetailType: 'SalesItemLineDetail',
      Description: 'Jobber discount',
      SalesItemLineDetail: {
        ItemRef: { value: discountItem },
        Qty: 1,
        UnitPrice: money(-discountAmount),
        TaxCodeRef: { value: decided.code },
      },
    });
  }
  if (options.absorb) {
    const shortfall = money(options.absorb.expectedQboTax - options.absorb.jobberTax);
    if (shortfall > 0.009) {
      lines.push({
        Amount: money(-shortfall),
        DetailType: 'SalesItemLineDetail',
        Description: ABSORBED_TAX_DESCRIPTION,
        SalesItemLineDetail: {
          ItemRef: { value: options.absorb.itemId },
          Qty: 1,
          UnitPrice: money(-shortfall),
          TaxCodeRef: { value: 'NON' },
        },
      });
    }
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
  return { body, missingItems: [], negativeTaxableLines, discountAmount, memo, discountTax, negativeLineTax };
}

export function classifyJobberInvoice(
  invoice: JobberInvoiceForQbo,
  existingDocNumbers: Set<string>,
  customerId: string | null,
  itemsByName: Record<string, string>,
  txnTaxCodeId: string | null,
  taxReason?: string,
  options: InvoiceBuildOptions & { createCustomer?: boolean; countyRates?: CountyRateIds } = {}
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
    return { ...base, status: 'blocked', reason: built.error, body: null, negativeTaxableLines: built.negativeTaxableLines, discountAmount: built.discountAmount, memo: built.memo, discountTax: built.discountTax, negativeLineTax: built.negativeLineTax };
  }
  if (!built.body) {
    return { ...base, status: 'blocked', reason: `Missing QuickBooks items: ${built.missingItems.join(', ')}`, body: null, negativeTaxableLines: built.negativeTaxableLines, memo: built.memo, discountTax: built.discountTax, negativeLineTax: built.negativeLineTax };
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
    absorb: options.absorb || null,
    discountTax: built.discountTax,
    negativeLineTax: built.negativeLineTax,
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

function optionalDiscountTaxable(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true')) return true;
  if (value === false || (typeof value === 'string' && value.trim().toLowerCase() === 'false')) return false;
  throw new Error('discountTaxable must be true or false.');
}

function optionalNegativeLinesNonTaxable(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true')) return true;
  if (value === false || (typeof value === 'string' && value.trim().toLowerCase() === 'false')) return false;
  throw new Error('negativeLinesNonTaxable must be true or false.');
}

function optionalTaxRate(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('taxRate must be a decimal such as 0.0775 or a percent such as 7.75.');
  return normalizeTaxRate(n);
}

function numberField(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number.`);
  return money(n);
}

export function parseAbsorbTaxShortfall(value: unknown): AbsorbTaxShortfall | null {
  if (value == null || value === '') return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('absorbTaxShortfall must be an object.');
  const row = value as Record<string, unknown>;
  const expectedQboTax = numberField(row.expectedQboTax, 'absorbTaxShortfall.expectedQboTax');
  const jobberTax = numberField(row.jobberTax, 'absorbTaxShortfall.jobberTax');
  const expenseAccountId = String(row.expenseAccountId ?? '').trim();
  const itemId = String(row.itemId ?? '').trim();
  if (expenseAccountId !== TAXES_EXPENSE_ACCOUNT_ID) {
    throw new Error('absorbTaxShortfall.expenseAccountId must be 18 (Taxes expense). The absorbed line uses an existing item mapped to that account.');
  }
  if (!/^\d{1,20}$/.test(itemId)) throw new Error('absorbTaxShortfall.itemId is required. Pass the QuickBooks item id for Sales tax absorbed by SCWS. The item is not created.');
  if (expectedQboTax + 0.009 < jobberTax) {
    throw new Error('absorbTaxShortfall.expectedQboTax is less than jobberTax, so there is no shortfall to absorb.');
  }
  return { expectedQboTax, jobberTax, expenseAccountId, itemId };
}

function accountRefValue(ref: unknown): string | null {
  if (!ref || typeof ref !== 'object') return null;
  const value = (ref as { value?: unknown }).value;
  if (value == null || String(value).trim() === '') return null;
  return String(value).trim();
}

/** Refuse unless the item is active, its income account is 18 (Taxes), and it is non-taxable. Invoice lines post to IncomeAccountRef. */
export async function absorbItemProblem(itemId: string, query: (sql: string) => Promise<unknown>): Promise<string | null> {
  const rows = rowsOf(
    await query(`select Id, Name, Active, Taxable, IncomeAccountRef, ExpenseAccountRef from Item where Id = '${itemId}'`),
    'Item'
  );
  const item = rows.find((row) => String(row.Id) === itemId) || null;
  if (!item) {
    return `QuickBooks item ${itemId} was not found. The absorbed tax line needs an existing active non-taxable item mapped to account 18 (Taxes, TaxesPaid). The item is not created.`;
  }
  const name = typeof item.Name === 'string' && item.Name.trim() ? item.Name.trim() : itemId;
  if (item.Active === false) return `QuickBooks item ${itemId} (${name}) is inactive. The absorbed tax line needs an active item.`;
  const income = accountRefValue(item.IncomeAccountRef);
  const expense = accountRefValue(item.ExpenseAccountRef);
  if (income !== TAXES_EXPENSE_ACCOUNT_ID) {
    const expenseNote = expense ? ` Expense account ${expense} is not the account an invoice line posts to.` : '';
    return `QuickBooks item ${itemId} (${name}) posts invoice lines to income account ${income || 'none'}, not 18 (Taxes).${expenseNote}`;
  }
  if (item.Taxable !== false) return `QuickBooks item ${itemId} (${name}) is taxable. The absorbed tax line must be non-taxable.`;
  return null;
}

function salesTaxLines(body: Record<string, unknown> | null): Array<{ amount: number; taxCode: string | null; itemId: string | null }> {
  const lines = Array.isArray(body?.Line) ? body.Line as Array<Record<string, unknown>> : [];
  return lines.filter((line) => line.DetailType === 'SalesItemLineDetail').map((line) => {
    const detail = line.SalesItemLineDetail as { ItemRef?: { value?: unknown }; TaxCodeRef?: { value?: unknown } } | undefined;
    const rawId = detail?.ItemRef?.value;
    const rawCode = detail?.TaxCodeRef?.value;
    return {
      amount: money(Number(line.Amount) || 0),
      taxCode: rawCode == null || String(rawCode).trim() === '' ? null : String(rawCode),
      itemId: rawId == null || String(rawId).trim() === '' ? null : String(rawId).trim(),
    };
  });
}

function itemTaxSnapshot(row: Record<string, unknown>): ItemTaxSnapshot {
  const ref = row.TaxClassificationRef;
  const refObj = ref && typeof ref === 'object' ? ref as { value?: unknown; name?: unknown } : null;
  const taxClassificationId = typeof refObj?.value === 'string' && refObj.value.trim() ? refObj.value.trim() : null;
  const taxClassificationName = typeof refObj?.name === 'string' && refObj.name.trim() ? refObj.name.trim() : null;
  return {
    id: String(row.Id),
    name: typeof row.Name === 'string' && row.Name.trim() ? row.Name.trim() : null,
    taxable: typeof row.Taxable === 'boolean' ? row.Taxable : null,
    taxClassificationId,
    taxClassificationName,
  };
}

async function loadItemTaxSnapshots(
  ids: string[],
  query: (sql: string) => Promise<unknown>,
  cache: Map<string, ItemTaxSnapshot | null>
): Promise<void> {
  for (const id of ids) {
    if (cache.has(id)) continue;
    if (!/^\d{1,20}$/.test(id)) {
      cache.set(id, null);
      continue;
    }
    const rows = rowsOf(await query(`select * from Item where Id = '${id}'`), 'Item');
    const row = rows.find((item) => String(item.Id) === id) || null;
    cache.set(id, row ? itemTaxSnapshot(row) : null);
  }
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
  const absorb = parseAbsorbTaxShortfall(args.absorbTaxShortfall);
  if (absorb && taxOverride) {
    throw new Error('absorbTaxShortfall cannot be combined with taxOverride. Post the computed QuickBooks tax and the absorbed line, not a TotalTax override.');
  }
  if (absorb && numbers.length !== 1) throw new Error('absorbTaxShortfall applies to one invoice. Pass a single invoiceNumbers entry.');
  const discountTaxable = optionalDiscountTaxable(args.discountTaxable);
  const negativeLinesNonTaxable = optionalNegativeLinesNonTaxable(args.negativeLinesNonTaxable);
  const explicitTaxRate = optionalTaxRate(args.taxRate);
  if ((discountTaxable != null || explicitTaxRate != null || negativeLinesNonTaxable != null) && numbers.length !== 1) {
    throw new Error('discountTaxable, taxRate, and negativeLinesNonTaxable apply to one invoice. Pass a single invoiceNumbers entry.');
  }
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
  if (absorb) {
    const problem = await absorbItemProblem(absorb.itemId, qbo);
    if (problem) throw new Error(problem);
  }
  const rateCache = new Map<string, number | null>();
  const itemTaxCache = new Map<string, ItemTaxSnapshot | null>();
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
      const fallbackNames = new Set<string>();
      for (const name of [...new Set(invoice.lines.map((line) => line.name).filter(Boolean))]) {
        const explicit = explicitItemId(name, itemIds);
        if (explicit) {
          items[name] = explicit;
          continue;
        }
        const found = rowsOf(await qbo(`select Id, Name from Item where Name = ${sqlString(name)}`), 'Item');
        const wanted = name.trim().toLowerCase();
        const matches = found.filter((row) => typeof row.Name === 'string' && row.Name.trim().toLowerCase() === wanted);
        if (matches.length > 1) ambiguousItems.push(name);
        else if (matches[0]?.Id != null) items[name] = String(matches[0].Id);
        else if (found.length > 1) ambiguousItems.push(name);
        else if (found[0]?.Id != null) items[name] = String(found[0].Id);
        else {
          const fallback = fallbackItemId(name);
          if (fallback) {
            items[name] = fallback;
            fallbackNames.add(name);
          }
        }
      }
      if (!discountItemId && (invoice.discountAmount || 0) > 0 && !Object.keys(items).some((name) => name.trim().toLowerCase() === 'discount')) {
        if (discountLookup === undefined) discountLookup = await findDiscountItem(qbo);
        if (discountLookup) items.Discount = discountLookup;
      }
      const tax = await taxForInvoice(invoice, customerId, overrideId, overrideExists, cityOverrides, customerTax, qbo);
      const holdTaxCode = shouldHoldAutomatedSalesTax(invoice.city, cdtfaCities);
      const taxRate = explicitTaxRate ?? await cachedCombinedTaxRate(tax.id, qbo, rateCache);
      let plan = classifyJobberInvoice(
        invoice,
        new Set(existing.map((row) => String(row.DocNumber))),
        customerId,
        items,
        tax.id,
        tax.reason,
        { taxOverride, discountItemId, createCustomer: createCustomers && !customerId && !ambiguousCustomer, batchId, countyRates, holdTaxCode, absorb, discountTaxable, taxRate, negativeLinesNonTaxable }
      );
      if (ambiguousCustomer) {
        plan = { ...plan, status: 'blocked', reason: `More than one QuickBooks customer is named "${invoice.clientName}". Pass customerIds.`, body: null, customerCreate: null };
      } else if (ambiguousItems.length) {
        plan = { ...plan, status: 'blocked', reason: `More than one QuickBooks item matches: ${ambiguousItems.join(', ')}. Pass itemIds.`, body: null };
      }
      const previewLines = invoice.lines.map((line) => ({
        name: line.name,
        amount: money(line.quantity * line.unitPrice),
        itemId: explicitItemId(line.name, items),
        fallbackItemUsed: fallbackNames.has(line.name),
      }));
      if (plan.status === 'create' && plan.body) {
        const bodyLines = salesTaxLines(plan.body);
        const ids = new Set<string>();
        for (const line of previewLines) if (line.itemId) ids.add(line.itemId);
        for (const line of bodyLines) if (line.taxCode === 'TAX' && line.itemId) ids.add(line.itemId);
        await loadItemTaxSnapshots([...ids], qbo, itemTaxCache);
        const assessed = assessImportTax({
          invoiceLines: previewLines,
          bodyLines,
          items: itemTaxCache,
          jobberTax: invoice.taxAmount,
          rate: taxRate,
          taxOverride,
          absorbExpectedTax: absorb ? absorb.expectedQboTax : null,
        });
        plan = {
          ...plan,
          lines: assessed.lines,
          expectedTaxableAmount: assessed.expectedTaxableAmount,
          expectedTax: assessed.expectedTax,
          ...(assessed.reason ? { status: 'blocked' as const, reason: assessed.reason, body: null } : {}),
        };
      } else {
        plan = {
          ...plan,
          lines: previewLines.map((line) => ({
            name: line.name,
            itemId: line.itemId,
            fallbackItemUsed: line.fallbackItemUsed,
            itemTaxCategory: null,
            expectedTaxableAmount: 0,
          })),
        };
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
    if (!row.body) {
      entry.invoice = { wrote: false, id: null, error: row.reason || 'Invoice was refused before create.' };
      posted.push(entry);
      continue;
    }
    const invoiceBody = { ...row.body, ...(customerId ? { CustomerRef: { value: customerId } } : {}) };
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
        absorb: row.absorb ? { expectedQboTax: row.absorb.expectedQboTax, jobberTax: row.absorb.jobberTax, jobberTotal: row.total } : null,
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
  if (fromCity) {
    if (!KNOWN_QBO_TAX_CODE_IDS.has(fromCity)) {
      const exists = await taxCodeIdExists(fromCity, query);
      if (!exists) return { id: null, reason: unknownTaxCodeReason(fromCity, invoice.city) };
    }
    return { id: fromCity, reason: '' };
  }
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

async function cachedCombinedTaxRate(taxCodeId: string | null, query: (sql: string) => Promise<unknown>, cache: Map<string, number | null>): Promise<number | null> {
  if (!taxCodeId) return null;
  if (cache.has(taxCodeId)) return cache.get(taxCodeId) ?? null;
  const rate = await combinedTaxRate(taxCodeId, query);
  cache.set(taxCodeId, rate);
  return rate;
}

async function combinedTaxRate(taxCodeId: string, query: (sql: string) => Promise<unknown>): Promise<number | null> {
  const rows = rowsOf(await query(`select Id, SalesTaxRateList from TaxCode where Id = '${taxCodeId}'`), 'TaxCode');
  const row = rows.find((item) => String(item.Id) === taxCodeId) || null;
  const rateIds = row ? rateIdsFromTaxCode(row) : null;
  if (!rateIds?.length) return null;
  let sum = 0;
  let any = false;
  for (const id of rateIds) {
    const rates = rowsOf(await query(`select Id, RateValue from TaxRate where Id = '${id}'`), 'TaxRate');
    const match = rates.find((item) => String(item.Id) === id) || null;
    const value = match ? Number(match.RateValue) : NaN;
    if (Number.isFinite(value)) {
      sum += value;
      any = true;
    }
  }
  if (!any) return null;
  return sum / 100;
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
