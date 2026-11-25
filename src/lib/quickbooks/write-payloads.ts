/**
 * Pure QuickBooks write payloads. No network. Preview returns these bodies.
 */
import { createHash } from 'node:crypto';

export const QBO_WRITE_TOOLS = [
  'qbo_journal_entry',
  'qbo_deposit',
  'qbo_payment',
  'qbo_invoice',
  'qbo_categorize_purchase',
  'qbo_bill',
  'qbo_bill_payment',
  'qbo_attach_note',
  'qbo_closing_date',
  'qbo_void',
  'qbo_item_tax_category',
  'qbo_import_jobber_invoices',
  'qbo_relink_deposit',
  'qbo_revert_batch',
] as const;

export type QboWriteTool = (typeof QBO_WRITE_TOOLS)[number];

const PRIVATE_NOTE_ENTITIES = [
  'Invoice',
  'Payment',
  'JournalEntry',
  'Purchase',
  'Bill',
  'BillPayment',
  'Deposit',
  'CreditMemo',
  'SalesReceipt',
] as const;

const ATTACHABLE_ENTITIES = [...PRIVATE_NOTE_ENTITIES, 'Customer', 'Vendor'] as const;

const ENTITY_PATH: Record<string, string> = {
  Invoice: 'invoice',
  Payment: 'payment',
  JournalEntry: 'journalentry',
  Purchase: 'purchase',
  Bill: 'bill',
  BillPayment: 'billpayment',
  Deposit: 'deposit',
  CreditMemo: 'creditmemo',
  SalesReceipt: 'salesreceipt',
  Customer: 'customer',
  Vendor: 'vendor',
};

export type QboReadApply = 'syncToken' | 'purchaseAccounts' | 'closeDate' | 'privateNote' | 'customerMemo' | 'void' | 'linkPayment' | 'relinkSalesLine' | 'appendPrivateNote' | 'itemTaxCategory' | 'retaxLines' | 'setLineTax';

export type QboPlan = {
  tool: QboWriteTool;
  entity: string;
  action: 'create' | 'update' | 'void' | 'attach' | 'close' | 'delete';
  path: string;
  operation?: 'update' | 'void' | 'delete';
  /** Exact POST body when no read is required. Null when confirm must GET first. */
  body: Record<string, unknown> | null;
  read?: { path: string; apply: QboReadApply };
  changes?: unknown;
  reason?: string;
  /** Invoice writes: the TxnTaxCodeRef that must still be on the saved invoice. A different saved code is flagged as taxCodeChanged. */
  expectTaxCode?: string;
  /** With expectTaxCode: the NetAmountTaxable every saved TaxLine must carry. 'body' sums the posted TAX lines. */
  expectNetAmountTaxable?: number | 'body';
  /**
   * CDTFA ship-address update: the saved invoice must have this code, this rate
   * set and no others, this TotalTax, no AST_TAX_OVERRIDE, and the same lines.
   */
  expectSavedTax?: { taxCodeId: string; rateIds: string[]; totalTax: number };
  /**
   * setLineTaxCodes update: header code stays, no AST_TAX_OVERRIDE, line amounts and
   * items stay, the named lines have these tax codes, and TotalTax matches (0 allowed).
   */
  expectLineTax?: { totalTax: number; lines: LineTaxCodeChange[] };
};

export type LineTaxCodeChange = { lineId: string; taxCode: 'TAX' | 'NON' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^\d{1,20}$/;

export function isQboWriteTool(name: string): name is QboWriteTool {
  return (QBO_WRITE_TOOLS as readonly string[]).includes(name);
}

export function confirmRequested(args: Record<string, unknown>): boolean {
  if (args.confirm === true && args.dryRun === true) {
    throw new Error('Pass confirm:true to post, or omit confirm to preview. Do not set both confirm and dryRun.');
  }
  if (args.confirm === true) return true;
  if (typeof args.confirm === 'string' && args.confirm.trim().toLowerCase() === 'true') {
    if (args.dryRun === true) throw new Error('Pass confirm:true to post, or omit confirm to preview. Do not set both confirm and dryRun.');
    return true;
  }
  return false;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
    .join(',')}}`;
}

export function parseBatchId(value: unknown, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error('batchId is required so the batch can be reverted.');
    return null;
  }
  const id = String(value).trim();
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id)) {
    throw new Error('batchId must be 1–80 characters of letters, numbers, "_", ".", ":", or "-".');
  }
  return id;
}

export function explicitRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  if (!id) return undefined;
  if (!/^[A-Za-z0-9_-]{8,50}$/.test(id)) {
    throw new Error('requestId must be 8–50 characters of letters, numbers, "_" or "-".');
  }
  return id;
}

/** Stable Intuit requestid. Same tool + payload retries hit the same key. */
export function resolveRequestId(tool: string, payload: unknown, given?: string): string {
  const explicit = explicitRequestId(given);
  if (explicit) return explicit;
  return createHash('sha256').update(`${tool}\n${canonicalJson(payload)}`).digest('hex').slice(0, 32);
}

function money(value: unknown, field: string): number {
  return roundedMoney(value, field, false);
}

/** expectedTotalTax on a line-tax update. Zero is a real total, not a missing value. */
function moneyAllowZero(value: unknown, field: string): number {
  if (value === undefined || value === null || value === '') throw new Error(`${field} is required.`);
  const n = typeof value === 'number' ? value : typeof value === 'string' && String(value).trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) throw new Error(`${field} must have at most 2 decimal places`);
  if (cents < 0) throw new Error(`${field} must be 0 or greater`);
  return cents / 100;
}

/** Deposit fee lines are negative. Zero is refused. Payment lines stay positive. */
function signedMoney(value: unknown, field: string): number {
  return roundedMoney(value, field, true);
}

function roundedMoney(value: unknown, field: string, allowNegative: boolean): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) throw new Error(`${field} must have at most 2 decimal places`);
  if (cents === 0 || (!allowNegative && cents < 0)) throw new Error(`${field} must be greater than 0`);
  return cents / 100;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function qboId(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if (!ID_RE.test(s)) throw new Error(`${field} must be a QuickBooks id`);
  return s;
}

function dateField(value: unknown, field: string, required: boolean): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${field} is required (YYYY-MM-DD)`);
    return undefined;
  }
  const s = String(value).trim();
  if (!DATE_RE.test(s)) throw new Error(`${field} must be YYYY-MM-DD`);
  return s;
}

export const QBO_PRIVATE_NOTE_MAX = 4000;

function note(value: unknown, field: string, max = QBO_PRIVATE_NOTE_MAX): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const s = value.trim();
  if (!s) return undefined;
  if (s.length > max) throw new Error(`${field} is longer than ${max} characters`);
  return s;
}

export function batchNoteTag(batchId: string): string {
  return `[batch:${batchId}]`;
}

/**
 * Append ` [batch:<id>]` unless that tag is already in the note.
 * A second call with the same id does not add another tag.
 */
export function privateNoteWithBatch(value: string | null | undefined, batchId: string | null | undefined): string | undefined {
  const id = batchId?.trim();
  const base = (value || '').trim();
  if (!id) return base || undefined;
  const tag = batchNoteTag(id);
  if (base.includes(tag)) return base;
  const suffix = ` ${tag}`;
  if (!base) return tag;
  if (base.length + suffix.length <= QBO_PRIVATE_NOTE_MAX) return base + suffix;
  const keep = QBO_PRIVATE_NOTE_MAX - suffix.length;
  if (keep <= 0) return tag.slice(0, QBO_PRIVATE_NOTE_MAX);
  return `${base.slice(0, keep).trimEnd()}${suffix}`;
}

/** Keep the note already on the invoice, append new text once, then the batch tag once. */
export function appendPrivateNote(existing: string | null | undefined, addition: string | null | undefined, batchId: string | null | undefined): string | undefined {
  const current = (existing || '').trim();
  const extra = (addition || '').trim();
  const combined = extra && !current.includes(extra) ? (current ? `${current}\n${extra}` : extra) : current;
  return privateNoteWithBatch(combined, batchId);
}

function requiredNote(value: unknown, field: string): string {
  const s = note(value, field);
  if (!s) throw new Error(`${field} is required`);
  return s;
}

function docNumber(value: unknown): string | undefined {
  const s = note(value, 'docNumber', 21);
  return s;
}

function rows(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be a non-empty array`);
  if (value.length > 50) throw new Error(`${field} is limited to 50 lines`);
  return value.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${field}[${index}] must be an object`);
    return row as Record<string, unknown>;
  });
}

function optString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return s || undefined;
}

function accountRef(id: string): { value: string } {
  return { value: id };
}

function entityRef(row: Record<string, unknown>, index: number, field: string): Record<string, unknown> | undefined {
  const entityId = row.entityId;
  const entityType = optString(row, 'entityType');
  if (entityId === undefined && !entityType) return undefined;
  if (!entityType || entityId === undefined) throw new Error(`${field}[${index}] entityType and entityId must be set together`);
  return { Type: entityType, EntityRef: { value: qboId(entityId, `${field}[${index}].entityId`) } };
}

export function buildJournalEntry(args: Record<string, unknown>): QboPlan {
  const lineRows = rows(args.lines, 'lines');
  let debit = 0;
  let credit = 0;
  const line = lineRows.map((row, index) => {
    const postingType = optString(row, 'postingType');
    if (postingType !== 'Debit' && postingType !== 'Credit') {
      throw new Error(`lines[${index}].postingType must be Debit or Credit`);
    }
    const amount = money(row.amount, `lines[${index}].amount`);
    if (postingType === 'Debit') debit += cents(amount);
    else credit += cents(amount);
    const detail: Record<string, unknown> = {
      PostingType: postingType,
      AccountRef: accountRef(qboId(row.accountId, `lines[${index}].accountId`)),
    };
    const entity = entityRef(row, index, 'lines');
    if (entity) detail.Entity = entity;
    const description = note(row.description, `lines[${index}].description`);
    return {
      ...(description ? { Description: description } : {}),
      Amount: amount,
      DetailType: 'JournalEntryLineDetail',
      JournalEntryLineDetail: detail,
    };
  });
  if (debit !== credit) throw new Error('Journal entry lines must balance (debits equal credits).');
  if (debit === 0 || credit === 0) throw new Error('Journal entry needs at least one debit and one credit.');
  const id = args.id === undefined || args.id === null || args.id === '' ? undefined : qboId(args.id, 'id');
  const syncToken = optString(args, 'syncToken');
  const body: Record<string, unknown> = {
    ...(id ? { Id: id, sparse: false } : {}),
    ...(id && syncToken ? { SyncToken: syncToken } : {}),
    Line: line,
  };
  const txnDate = dateField(args.txnDate, 'txnDate', false);
  const privateNote = note(args.privateNote, 'privateNote');
  const number = docNumber(args.docNumber);
  if (txnDate) body.TxnDate = txnDate;
  if (privateNote) body.PrivateNote = privateNote;
  if (number) body.DocNumber = number;
  const plan: QboPlan = { tool: 'qbo_journal_entry', entity: 'JournalEntry', action: id ? 'update' : 'create', path: '/journalentry', body };
  if (id && !syncToken) plan.read = { path: `/journalentry/${id}`, apply: 'syncToken' };
  return plan;
}

export function buildDeposit(args: Record<string, unknown>): QboPlan {
  const depositToAccountId = qboId(args.depositToAccountId, 'depositToAccountId');
  const lineRows = rows(args.lines, 'lines');
  const line = lineRows.map((row, index) => {
    const paymentId = row.paymentId === undefined || row.paymentId === '' ? undefined : qboId(row.paymentId, `lines[${index}].paymentId`);
    const amount = paymentId ? money(row.amount, `lines[${index}].amount`) : signedMoney(row.amount, `lines[${index}].amount`);
    if (paymentId && row.accountId !== undefined && row.accountId !== '') {
      throw new Error(`lines[${index}] sets both paymentId and accountId. Use one.`);
    }
    if (paymentId) {
      return {
        Amount: amount,
        LinkedTxn: [{ TxnId: paymentId, TxnLineId: '0', TxnType: 'Payment' }],
      };
    }
    const accountId = qboId(row.accountId, `lines[${index}].accountId`);
    const detail: Record<string, unknown> = { AccountRef: accountRef(accountId) };
    const entity = entityRef(row, index, 'lines');
    if (entity) detail.Entity = entity;
    const description = note(row.description, `lines[${index}].description`);
    return {
      Amount: amount,
      DetailType: 'DepositLineDetail',
      DepositLineDetail: detail,
      ...(description ? { Description: description } : {}),
    };
  });
  const body: Record<string, unknown> = {
    DepositToAccountRef: accountRef(depositToAccountId),
    Line: line,
  };
  const txnDate = dateField(args.txnDate, 'txnDate', false);
  const privateNote = note(args.privateNote, 'privateNote');
  if (txnDate) body.TxnDate = txnDate;
  if (privateNote) body.PrivateNote = privateNote;
  return { tool: 'qbo_deposit', entity: 'Deposit', action: 'create', path: '/deposit', body };
}

export function buildPayment(args: Record<string, unknown>): QboPlan {
  const applications = rows(args.applications, 'applications').map((row, index) => ({
    Amount: money(row.amount, `applications[${index}].amount`),
    LinkedTxn: [{ TxnId: qboId(row.invoiceId, `applications[${index}].invoiceId`), TxnType: 'Invoice' }],
  }));
  const applied = applications.reduce((sum, row) => sum + cents(row.Amount), 0);
  const total = money(args.totalAmt, 'totalAmt');
  if (args.allowUnapplied !== true && cents(total) !== applied) {
    throw new Error('totalAmt must equal the sum of applications. Pass allowUnapplied:true to leave a credit.');
  }
  if (cents(total) < applied) throw new Error('totalAmt is less than the sum of applications.');
  const body: Record<string, unknown> = {
    CustomerRef: accountRef(qboId(args.customerId, 'customerId')),
    TotalAmt: total,
    Line: applications,
  };
  const txnDate = dateField(args.txnDate, 'txnDate', false);
  const privateNote = note(args.privateNote, 'privateNote');
  const depositTo = args.depositToAccountId === undefined || args.depositToAccountId === '' ? undefined : qboId(args.depositToAccountId, 'depositToAccountId');
  const ref = note(args.paymentRefNum, 'paymentRefNum', 21);
  if (txnDate) body.TxnDate = txnDate;
  if (privateNote) body.PrivateNote = privateNote;
  if (depositTo) body.DepositToAccountRef = accountRef(depositTo);
  if (ref) body.PaymentRefNum = ref;
  return { tool: 'qbo_payment', entity: 'Payment', action: 'create', path: '/payment', body };
}

function salesLines(args: Record<string, unknown>): Record<string, unknown>[] {
  return rows(args.lines, 'lines').map((row, index) => {
    const amount = money(row.amount, `lines[${index}].amount`);
    const itemId = qboId(row.itemId, `lines[${index}].itemId`);
    const quantity = row.quantity === undefined ? 1 : Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`lines[${index}].quantity must be greater than 0`);
    const unitPrice = row.unitPrice === undefined ? amount / quantity : Number(row.unitPrice);
    if (!Number.isFinite(unitPrice)) throw new Error(`lines[${index}].unitPrice must be a number`);
    const description = note(row.description, `lines[${index}].description`);
    return {
      Amount: amount,
      DetailType: 'SalesItemLineDetail',
      ...(description ? { Description: description } : {}),
      SalesItemLineDetail: {
        ItemRef: { value: itemId },
        Qty: quantity,
        UnitPrice: Math.round(unitPrice * 100) / 100,
      },
    };
  });
}

export function buildInvoice(args: Record<string, unknown>): QboPlan {
  const settingLineTax = Array.isArray(args.setLineTaxCodes);
  if (settingLineTax && (hasShipAddress(args) || flagTrue(args.cdtfaVerified) || flagTrue(args.reuseLiveAddress))) {
    throw new Error('setLineTaxCodes cannot be combined with a ship-address update.');
  }
  if (!settingLineTax && (hasShipAddress(args) || flagTrue(args.cdtfaVerified) || flagTrue(args.reuseLiveAddress))) return buildInvoiceShipHold(args);
  const id = args.id === undefined || args.id === null || args.id === '' ? undefined : qboId(args.id, 'id');
  const syncToken = optString(args, 'syncToken');
  const hasLines = Array.isArray(args.lines) && args.lines.length > 0;
  if (!id && !hasLines) throw new Error('lines are required to create an invoice');
  const body: Record<string, unknown> = {};
  if (!id) body.CustomerRef = accountRef(qboId(args.customerId, 'customerId'));
  else if (args.customerId !== undefined && args.customerId !== '') body.CustomerRef = accountRef(qboId(args.customerId, 'customerId'));
  if (hasLines) body.Line = salesLines(args);
  const txnDate = dateField(args.txnDate, 'txnDate', false);
  const dueDate = dateField(args.dueDate, 'dueDate', false);
  const suppliedNote = note(args.privateNote, 'privateNote');
  const batch = parseBatchId(args.batchId);
  const customerMemo = note(args.customerMemo, 'customerMemo');
  const number = docNumber(args.docNumber);
  if (txnDate) body.TxnDate = txnDate;
  if (dueDate) body.DueDate = dueDate;
  if (!id) {
    const privateNote = privateNoteWithBatch(suppliedNote, batch);
    if (privateNote) body.PrivateNote = privateNote;
  }
  if (customerMemo) body.CustomerMemo = { value: customerMemo };
  if (number) body.DocNumber = number;
  const retax = Array.isArray(args.retaxLineIds) ? args.retaxLineIds : null;
  if (settingLineTax) return buildInvoiceSetLineTax(args, id, syncToken, hasLines, suppliedNote, retax);
  if (retax) return buildInvoiceRetax(args, id, syncToken, hasLines, suppliedNote);
  if (args.totalTax !== undefined && args.totalTax !== null && args.totalTax !== '') {
    if (!id) throw new Error('totalTax is only for an invoice update. Use taxOverride on the import for a new invoice.');
    if (hasLines) throw new Error('totalTax cannot be combined with lines. A full update would drop the saved addresses and tax detail.');
    if (!syncToken) throw new Error('totalTax needs syncToken: the SyncToken you read. Confirm refuses when QuickBooks has a different one.');
    if (suppliedNote) throw new Error('totalTax cannot be combined with privateNote. Send the note as its own update.');
    body.TxnTaxDetail = { TxnTaxCodeRef: { value: qboId(args.txnTaxCodeId, 'txnTaxCodeId') }, TotalTax: money(args.totalTax, 'totalTax') };

  }
  if (id) {
    body.Id = id;
    body.sparse = !hasLines;
    if (syncToken) body.SyncToken = syncToken;
  }
  const noteOnUpdate = Boolean(id && suppliedNote);
  if (!noteOnUpdate && Object.keys(body).filter((key) => key !== 'Id' && key !== 'sparse' && key !== 'SyncToken').length === 0) {
    throw new Error('Invoice update needs at least one field to change.');
  }
  const plan: QboPlan = {
    tool: 'qbo_invoice',
    entity: 'Invoice',
    action: id ? 'update' : 'create',
    path: '/invoice',
    body,
  };
  if (noteOnUpdate) {
    plan.read = { path: `/invoice/${id}`, apply: 'appendPrivateNote' };
    plan.changes = { privateNote: suppliedNote, batchId: batch };
  } else if (id && body.TxnTaxDetail) {
    // Always read so prior_state is audited, and refuse when the live SyncToken is not the one passed.
    // Under Automated Sales Tax a TotalTax override is prorated over the AST-assigned code and the
    // saved TxnTaxCodeRef is replaced by that code (Intuit AST FAQ), so the saved code is checked.
    const taxCode = ((body.TxnTaxDetail as { TxnTaxCodeRef: { value: string } }).TxnTaxCodeRef).value;
    plan.read = { path: `/invoice/${id}`, apply: 'syncToken' };
    plan.changes = { expectedSyncToken: syncToken, totalTax: (body.TxnTaxDetail as { TotalTax: number }).TotalTax, txnTaxCodeId: taxCode };
    plan.expectTaxCode = taxCode;
  } else if (id && !syncToken) {
    plan.read = { path: `/invoice/${id}`, apply: 'syncToken' };
  }
  return plan;
}

export type PurchaseAccountChange = { lineId: string; accountId: string };

export function purchaseAccountChanges(args: Record<string, unknown>): PurchaseAccountChange[] {
  if (Array.isArray(args.lines) && args.lines.length) {
    return rows(args.lines, 'lines').map((row, index) => ({
      lineId: qboId(row.lineId, `lines[${index}].lineId`),
      accountId: qboId(row.accountId, `lines[${index}].accountId`),
    }));
  }
  if (args.accountId !== undefined && args.accountId !== '') {
    return [{ lineId: '*', accountId: qboId(args.accountId, 'accountId') }];
  }
  throw new Error('Pass accountId for every account-based line, or lines: [{ lineId, accountId }].');
}

export function applyPurchaseAccounts(
  purchase: Record<string, unknown>,
  changes: PurchaseAccountChange[],
  privateNoteText?: string
): Record<string, unknown> {
  const id = qboId(purchase.Id, 'Purchase.Id');
  const syncToken = typeof purchase.SyncToken === 'string' ? purchase.SyncToken : '';
  if (!syncToken) throw new Error('Purchase is missing SyncToken.');
  const lines = Array.isArray(purchase.Line) ? (purchase.Line as Record<string, unknown>[]) : [];
  const specific = changes.filter((change) => change.lineId !== '*');
  const blanket = changes.find((change) => change.lineId === '*');
  const seen = new Set<string>();
  const nextLines = lines.map((line) => {
    const detail = line.AccountBasedExpenseLineDetail as Record<string, unknown> | undefined;
    const lineId = typeof line.Id === 'string' ? line.Id : '';
    if (!detail) return line;
    const match = specific.find((change) => change.lineId === lineId);
    const accountId = match?.accountId || blanket?.accountId;
    if (!accountId) return line;
    if (match) seen.add(match.lineId);
    return {
      ...line,
      AccountBasedExpenseLineDetail: { ...detail, AccountRef: { value: accountId } },
    };
  });
  for (const change of specific) {
    if (!seen.has(change.lineId)) throw new Error(`Purchase line ${change.lineId} was not found or is not an account line.`);
  }
  if (blanket && !nextLines.some((line) => (line as Record<string, unknown>).AccountBasedExpenseLineDetail)) {
    throw new Error('Purchase has no account-based lines to categorize.');
  }
  const body: Record<string, unknown> = { ...purchase, Id: id, SyncToken: syncToken, Line: nextLines };
  delete body.MetaData;
  if (privateNoteText) body.PrivateNote = privateNoteText;
  return body;
}

export function buildCategorizePurchase(args: Record<string, unknown>): QboPlan {
  const id = qboId(args.id, 'id');
  const changes = purchaseAccountChanges(args);
  const privateNoteText = note(args.privateNote, 'privateNote');
  const syncToken = optString(args, 'syncToken');
  return {
    tool: 'qbo_categorize_purchase',
    entity: 'Purchase',
    action: 'update',
    path: '/purchase',
    body: null,
    read: { path: `/purchase/${id}`, apply: 'purchaseAccounts' },
    changes: { id, syncToken: syncToken || null, lines: changes, privateNote: privateNoteText || null },
  };
}

function expenseLines(args: Record<string, unknown>): Record<string, unknown>[] {
  return rows(args.lines, 'lines').map((row, index) => {
    const amount = money(row.amount, `lines[${index}].amount`);
    const detail: Record<string, unknown> = {
      AccountRef: accountRef(qboId(row.accountId, `lines[${index}].accountId`)),
    };
    if (row.customerId !== undefined && row.customerId !== '') {
      detail.CustomerRef = accountRef(qboId(row.customerId, `lines[${index}].customerId`));
    }
    const description = note(row.description, `lines[${index}].description`);
    return {
      Amount: amount,
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: detail,
      ...(description ? { Description: description } : {}),
    };
  });
}

export function buildBill(args: Record<string, unknown>): QboPlan {
  const id = args.id === undefined || args.id === null || args.id === '' ? undefined : qboId(args.id, 'id');
  const syncToken = optString(args, 'syncToken');
  const hasLines = Array.isArray(args.lines) && args.lines.length > 0;
  if (!id && !hasLines) throw new Error('lines are required to create a bill');
  const body: Record<string, unknown> = {};
  if (!id || (args.vendorId !== undefined && args.vendorId !== '')) {
    body.VendorRef = accountRef(qboId(args.vendorId, 'vendorId'));
  }
  if (hasLines) body.Line = expenseLines(args);
  const txnDate = dateField(args.txnDate, 'txnDate', false);
  const dueDate = dateField(args.dueDate, 'dueDate', false);
  const privateNoteText = note(args.privateNote, 'privateNote');
  const number = docNumber(args.docNumber);
  if (txnDate) body.TxnDate = txnDate;
  if (dueDate) body.DueDate = dueDate;
  if (privateNoteText) body.PrivateNote = privateNoteText;
  if (number) body.DocNumber = number;
  if (id) {
    body.Id = id;
    body.sparse = !hasLines;
    if (syncToken) body.SyncToken = syncToken;
  }
  const plan: QboPlan = { tool: 'qbo_bill', entity: 'Bill', action: id ? 'update' : 'create', path: '/bill', body };
  if (id && !syncToken) plan.read = { path: `/bill/${id}`, apply: 'syncToken' };
  return plan;
}

export function buildBillPayment(args: Record<string, unknown>): QboPlan {
  const payType = optString(args, 'payType');
  if (payType !== 'Check' && payType !== 'CreditCard') throw new Error('payType must be Check or CreditCard');
  const applications = rows(args.applications, 'applications').map((row, index) => ({
    Amount: money(row.amount, `applications[${index}].amount`),
    LinkedTxn: [{ TxnId: qboId(row.billId, `applications[${index}].billId`), TxnType: 'Bill' }],
  }));
  const applied = applications.reduce((sum, row) => sum + cents(row.Amount), 0);
  const total = money(args.totalAmt, 'totalAmt');
  if (cents(total) !== applied) throw new Error('totalAmt must equal the sum of bill applications.');
  const body: Record<string, unknown> = {
    VendorRef: accountRef(qboId(args.vendorId, 'vendorId')),
    TotalAmt: total,
    PayType: payType,
    Line: applications,
  };
  if (payType === 'Check') {
    body.CheckPayment = { BankAccountRef: accountRef(qboId(args.bankAccountId, 'bankAccountId')) };
  } else {
    body.CreditCardPayment = { CCAccountRef: accountRef(qboId(args.creditCardAccountId, 'creditCardAccountId')) };
  }
  const txnDate = dateField(args.txnDate, 'txnDate', false);
  const privateNoteText = note(args.privateNote, 'privateNote');
  if (txnDate) body.TxnDate = txnDate;
  if (privateNoteText) body.PrivateNote = privateNoteText;
  return { tool: 'qbo_bill_payment', entity: 'BillPayment', action: 'create', path: '/billpayment', body };
}

export function buildAttachNote(args: Record<string, unknown>): QboPlan {
  const modeRaw = optString(args, 'mode') || 'private_note';
  if (modeRaw !== 'private_note' && modeRaw !== 'attachable' && modeRaw !== 'customer_memo') {
    throw new Error('mode must be private_note, attachable, or customer_memo');
  }
  const entityType = optString(args, 'entityType') || '';
  const entityId = qboId(args.entityId, 'entityId');
  const text = requiredNote(args.note, 'note');
  if (modeRaw === 'attachable') {
    if (!(ATTACHABLE_ENTITIES as readonly string[]).includes(entityType)) {
      throw new Error(`entityType must be one of ${ATTACHABLE_ENTITIES.join(', ')}`);
    }
    return {
      tool: 'qbo_attach_note',
      entity: 'Attachable',
      action: 'attach',
      path: '/attachable',
      body: {
        Note: text,
        AttachableRef: [{ EntityRef: { type: entityType, value: entityId }, IncludeOnSend: false }],
      },
    };
  }
  if (modeRaw === 'customer_memo' && entityType !== 'Invoice') {
    throw new Error('customer_memo is only supported on Invoice. Use private_note or attachable.');
  }
  if (modeRaw === 'private_note' && !(PRIVATE_NOTE_ENTITIES as readonly string[]).includes(entityType)) {
    throw new Error(`private_note entityType must be one of ${PRIVATE_NOTE_ENTITIES.join(', ')}`);
  }
  const pathName = ENTITY_PATH[entityType];
  const syncToken = optString(args, 'syncToken');
  const body: Record<string, unknown> =
    modeRaw === 'customer_memo'
      ? { Id: entityId, sparse: true, CustomerMemo: { value: text } }
      : { Id: entityId, sparse: true, PrivateNote: text };
  if (syncToken) body.SyncToken = syncToken;
  const plan: QboPlan = {
    tool: 'qbo_attach_note',
    entity: entityType,
    action: 'update',
    path: `/${pathName}`,
    body,
  };
  if (!syncToken) plan.read = { path: `/${pathName}/${entityId}`, apply: modeRaw === 'customer_memo' ? 'customerMemo' : 'privateNote' };
  return plan;
}

/**
 * Sparse Item update of the sales tax category (TaxClassificationRef) and Taxable flag only.
 * The read captures prior_state for revert. applicableTo is the item types the class allows,
 * from QuickBooks' TaxClassification list (the tool handler reads it; see item-tax-category.ts).
 * Confirm refuses when the live SyncToken differs from the one passed or the item type is not allowed.
 */
export function buildItemTaxCategory(args: Record<string, unknown>): QboPlan {
  const itemId = qboId(args.itemId, 'itemId');
  const raw = typeof args.taxClassificationId === 'string' ? args.taxClassificationId.trim() : '';
  if (!/^EUC-\d{8}-V1-\d{8}$/.test(raw)) throw new Error('taxClassificationId must look like EUC-99990202-V1-00020000.');
  const syncToken = optString(args, 'syncToken');
  if (!syncToken) throw new Error('syncToken is required: the item SyncToken you read. Confirm refuses when QuickBooks has a different one.');
  const applicableTo = Array.isArray(args.applicableTo) ? args.applicableTo.filter((t): t is string => typeof t === 'string' && t.length > 0) : [];
  if (!applicableTo.length) throw new Error('taxClassificationId was not checked against the QuickBooks TaxClassification list.');
  const body: Record<string, unknown> = { Id: itemId, SyncToken: syncToken, sparse: true, TaxClassificationRef: { value: raw } };
  if (args.taxable !== undefined) {
    if (typeof args.taxable !== 'boolean') throw new Error('taxable must be true or false');
    body.Taxable = args.taxable;
  }
  return {
    tool: 'qbo_item_tax_category',
    entity: 'Item',
    action: 'update',
    path: '/item',
    body,
    read: { path: `/item/${itemId}`, apply: 'itemTaxCategory' },
    changes: { expectedSyncToken: syncToken, taxClassificationId: raw, taxable: args.taxable ?? null, applicableTo },
  };
}

export function buildClosingDate(args: Record<string, unknown>): QboPlan {
  const closeDate = dateField(args.closeDate, 'closeDate', true);
  return {
    tool: 'qbo_closing_date',
    entity: 'Preferences',
    action: 'close',
    path: '/preferences',
    operation: 'update',
    body: null,
    read: { path: '/preferences', apply: 'closeDate' },
    changes: { closeDate },
  };
}

export type DepositSalesRelink = {
  lineId?: string | null;
  amount: number;
  salesAccountId?: string | null;
  paymentId: string;
};

function depositLines(deposit: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(deposit.Line) ? (deposit.Line as Record<string, unknown>[]) : [];
}

function lineCents(line: Record<string, unknown>): number {
  return Math.round(Number(line.Amount) * 100);
}

function isPaymentDepositLine(line: Record<string, unknown>): boolean {
  const linked = line.LinkedTxn as Array<{ TxnType?: string }> | undefined;
  return Array.isArray(linked) && linked.some((item) => item.TxnType === 'Payment');
}

/** The 4010 Sales line a payout booked directly to income, matched by id or by amount and account. */
export function findDepositSalesLine(deposit: Record<string, unknown>, change: Pick<DepositSalesRelink, 'lineId' | 'amount' | 'salesAccountId'>): Record<string, unknown> {
  if (!change.lineId && !change.salesAccountId) throw new Error('Pass lineId or salesAccountId so the sales line is explicit.');
  const wanted = Math.round(Number(change.amount) * 100);
  if (!Number.isFinite(wanted) || wanted <= 0) throw new Error('amount must be greater than 0');
  const matches = depositLines(deposit).filter((line) => {
    if (isPaymentDepositLine(line) || !line.DepositLineDetail) return false;
    if (lineCents(line) !== wanted) return false;
    if (change.lineId && String(line.Id) !== String(change.lineId)) return false;
    if (change.salesAccountId) {
      const detail = line.DepositLineDetail as { AccountRef?: { value?: string } };
      if (String(detail.AccountRef?.value || '') !== change.salesAccountId) return false;
    }
    return true;
  });
  if (matches.length !== 1) {
    throw new Error(matches.length === 0 ? 'No deposit sales line matches that amount and account.' : 'More than one deposit line matches. Pass lineId.');
  }
  return matches[0];
}

/**
 * Remove one income line and link a ReceivePayment of the same amount.
 * The deposit total does not change, so the bank reconciliation stays put.
 */
export function replaceDepositSalesLine(deposit: Record<string, unknown>, change: DepositSalesRelink): Record<string, unknown> {
  const lines = depositLines(deposit);
  const match = findDepositSalesLine(deposit, change);
  if (!change.paymentId) throw new Error('paymentId is required to relink the deposit.');
  const next = lines.filter((line) => line !== match);
  const already = next.some((line) => {
    const linked = line.LinkedTxn as Array<{ TxnId?: string; TxnType?: string }> | undefined;
    return (linked || []).some((item) => item.TxnId === change.paymentId && item.TxnType === 'Payment');
  });
  if (!already) {
    next.push({ Amount: Math.round(change.amount * 100) / 100, LinkedTxn: [{ TxnId: change.paymentId, TxnLineId: '0', TxnType: 'Payment' }] });
  }
  const before = lines.reduce((sum, line) => sum + lineCents(line), 0);
  const after = next.reduce((sum, line) => sum + lineCents(line), 0);
  if (before !== after) throw new Error('Deposit total would change. The sales line was not replaced.');
  const syncToken = deposit.SyncToken == null ? '' : String(deposit.SyncToken);
  if (!syncToken) throw new Error('Deposit is missing SyncToken.');
  const body: Record<string, unknown> = { ...deposit, Id: String(deposit.Id), SyncToken: syncToken, Line: next };
  delete body.MetaData;
  return body;
}

export function linkPaymentOnDeposit(deposit: Record<string, unknown>, paymentId: string, amount: number): Record<string, unknown> {
  const lines = Array.isArray(deposit.Line) ? [...(deposit.Line as Record<string, unknown>[])] : [];
  const already = lines.some((line) => {
    const linked = line.LinkedTxn as Array<{ TxnId?: string; TxnType?: string }> | undefined;
    return (linked || []).some((item) => item.TxnId === paymentId && item.TxnType === 'Payment');
  });
  if (!already) {
    lines.push({ Amount: amount, LinkedTxn: [{ TxnId: paymentId, TxnLineId: '0', TxnType: 'Payment' }] });
  }
  const body: Record<string, unknown> = { ...deposit, Id: String(deposit.Id), SyncToken: String(deposit.SyncToken), Line: lines };
  delete body.MetaData;
  return body;
}

export function preferencesCloseDateBody(preferences: Record<string, unknown>, closeDate: string): Record<string, unknown> {
  const syncToken = typeof preferences.SyncToken === 'string' ? preferences.SyncToken : '';
  if (!syncToken) throw new Error('Preferences is missing SyncToken. The books close date was not changed.');
  const body: Record<string, unknown> = {
    SyncToken: syncToken,
    sparse: true,
    AccountingInfoPrefs: { BookCloseDate: closeDate },
  };
  if (preferences.Id !== undefined && preferences.Id !== null && String(preferences.Id).length) {
    body.Id = String(preferences.Id);
  }
  return body;
}

export function buildVoid(args: Record<string, unknown>): QboPlan {
  const entityType = optString(args, 'entityType');
  if (entityType !== 'Invoice' && entityType !== 'Payment') {
    throw new Error('qbo_void only voids an Invoice or a Payment. Nothing is deleted. Reverse a journal entry with qbo_journal_entry.');
  }
  const entityId = qboId(args.entityId, 'entityId');
  const reason = requiredNote(args.reason, 'reason');
  const syncToken = optString(args, 'syncToken');
  const pathName = ENTITY_PATH[entityType];
  const body: Record<string, unknown> = { Id: entityId, sparse: true };
  if (syncToken) body.SyncToken = syncToken;
  const plan: QboPlan = {
    tool: 'qbo_void',
    entity: entityType,
    action: 'void',
    path: `/${pathName}`,
    operation: 'void',
    body,
    reason,
  };
  if (!syncToken) plan.read = { path: `/${pathName}/${entityId}`, apply: 'void' };
  return plan;
}

export function buildQboPlan(tool: string, args: Record<string, unknown>): QboPlan {
  switch (tool) {
    case 'qbo_journal_entry':
      return buildJournalEntry(args);
    case 'qbo_deposit':
      return buildDeposit(args);
    case 'qbo_payment':
      return buildPayment(args);
    case 'qbo_invoice':
      return buildInvoice(args);
    case 'qbo_categorize_purchase':
      return buildCategorizePurchase(args);
    case 'qbo_bill':
      return buildBill(args);
    case 'qbo_bill_payment':
      return buildBillPayment(args);
    case 'qbo_attach_note':
      return buildAttachNote(args);
    case 'qbo_closing_date':
      return buildClosingDate(args);
    case 'qbo_void':
      return buildVoid(args);
    case 'qbo_item_tax_category':
      return buildItemTaxCategory(args);
    case 'qbo_relink_deposit':
      throw new Error('qbo_relink_deposit has its own preview and confirm path.');
    default:
      throw new Error(`Unknown QuickBooks write tool: ${tool}`);
  }
}

export function applyRead(plan: QboPlan, fetched: Record<string, unknown>): Record<string, unknown> {
  const entity = (fetched[plan.entity] as Record<string, unknown> | undefined) || fetched;
  if (plan.read?.apply === 'purchaseAccounts') {
    const changes = plan.changes as { lines: PurchaseAccountChange[]; privateNote?: string | null };
    return applyPurchaseAccounts(entity, changes.lines, changes.privateNote || undefined);
  }
  if (plan.read?.apply === 'closeDate') {
    const changes = plan.changes as { closeDate: string };
    return preferencesCloseDateBody(entity, changes.closeDate);
  }
  if (plan.read?.apply === 'linkPayment') {
    const changes = plan.changes as { paymentId: string; amount: number };
    return linkPaymentOnDeposit(entity, changes.paymentId, changes.amount);
  }
  if (plan.read?.apply === 'relinkSalesLine') {
    return replaceDepositSalesLine(entity, plan.changes as DepositSalesRelink);
  }
  if (plan.read?.apply === 'appendPrivateNote') {
    const changes = plan.changes as { privateNote?: string | null; batchId?: string | null };
    const syncToken = typeof entity.SyncToken === 'string' ? entity.SyncToken : '';
    if (!syncToken) throw new Error(`${plan.entity} is missing SyncToken.`);
    const existing = typeof entity.PrivateNote === 'string' ? entity.PrivateNote : '';
    const next = appendPrivateNote(existing, changes.privateNote, changes.batchId);
    const body = { ...(plan.body || {}) };
    body.Id = qboId(entity.Id ?? body.Id, 'Id');
    body.SyncToken = syncToken;
    if (next) body.PrivateNote = next;
    return body;
  }
  const syncToken = typeof entity.SyncToken === 'string' ? entity.SyncToken : '';
  if (!syncToken) throw new Error(`${plan.entity} is missing SyncToken.`);
  const expected = (plan.changes as { expectedSyncToken?: unknown } | undefined)?.expectedSyncToken;
  if (typeof expected === 'string' && expected && syncToken !== expected) {
    throw new Error(`${plan.entity} ${String(entity.Id ?? '')} has SyncToken ${syncToken} in QuickBooks, not ${expected}. It changed since it was read. Nothing was posted; re-read and preview again.`);
  }
  if (plan.read?.apply === 'itemTaxCategory') {
    const allowed = (plan.changes as { applicableTo?: string[] }).applicableTo || [];
    const type = typeof entity.Type === 'string' ? entity.Type : '';
    if (!allowed.includes(type)) {
      throw new Error(`Item ${String(entity.Id ?? '')} is type ${type || 'unknown'}; the tax category applies only to ${allowed.join(', ')}. Nothing was posted.`);
    }
  }
  const body = { ...(plan.body || {}) };
  body.Id = qboId(entity.Id ?? body.Id, 'Id');
  body.SyncToken = syncToken;
  if ((plan.changes as { reuseLiveAddress?: boolean } | undefined)?.reuseLiveAddress) {
    const ship = addressAsRead(entity.ShipAddr);
    const shipFrom = addressAsRead(entity.ShipFromAddr);
    if (!ship && !shipFrom) {
      throw new Error(`${plan.entity} ${String(entity.Id ?? '')} has no ShipAddr or ShipFromAddr to reuse. Nothing was posted.`);
    }
    if (ship) body.ShipAddr = ship;
    if (shipFrom) body.ShipFromAddr = shipFrom;
  }
  if (plan.read?.apply === 'void') body.sparse = true;
  if (plan.read?.apply === 'retaxLines') {
    const changes = plan.changes as { retaxLineIds: string[]; txnTaxCodeId: string };
    return { ...retaxInvoiceBody(entity, changes.retaxLineIds, changes.txnTaxCodeId), SyncToken: syncToken };
  }
  if (plan.read?.apply === 'setLineTax') {
    const changes = plan.changes as { setLineTaxCodes: LineTaxCodeChange[] };
    return { ...setLineTaxInvoiceBody(entity, changes.setLineTaxCodes), SyncToken: syncToken };
  }
  return body;
}

/** A structured QuickBooks address object, or null. Keeps the address Id so QuickBooks reuses the saved record. */
export function addressArg(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ['Id', 'Line1', 'Line2', 'Line3', 'Line4', 'Line5', 'City', 'Country', 'CountrySubDivisionCode', 'PostalCode', 'Lat', 'Long']) {
    if (typeof src[key] === 'string' && (src[key] as string).length) out[key] = src[key];
  }
  if (!out.Line1 && !out.City && !out.PostalCode) return null;
  return out;
}

/** Sum of TAX sales lines in an invoice body (what NetAmountTaxable should be with no discount lines). */
export function taxableAmountOfBody(body: Record<string, unknown> | null | undefined): number | null {
  const lines = Array.isArray(body?.Line) ? (body!.Line as Record<string, any>[]) : null;
  if (!lines) return null;
  const sum = lines
    .filter((line) => line?.DetailType === 'SalesItemLineDetail' && line?.SalesItemLineDetail?.TaxCodeRef?.value === 'TAX')
    .reduce((total, line) => total + Number(line.Amount || 0), 0);
  return Math.round(sum * 100) / 100;
}

const COORD_LINE = /(?:\blat(?:itude)?\b|\blong(?:itude)?\b|\blng\b)|[-+]?\d{1,3}\.\d{2,}\s*,\s*[-+]?\d{1,3}\.\d{2,}|\d+\s*°/i;

function flagTrue(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

function hasShipAddress(args: Record<string, unknown>): boolean {
  return (args.shipAddr != null && args.shipAddr !== '') || (args.shipFromAddr != null && args.shipFromAddr !== '');
}

/**
 * Full postal address for ShipAddr / ShipFromAddr. QuickBooks replaces an
 * address sent without its fields, so every line the caller provided is resent.
 * Coordinates are rejected: the customer sees the address lines, and Automated
 * Sales Tax does not document Lat/Long as a jurisdiction input.
 */
export function postalAddress(value: unknown, label: string): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a postal address object.`);
  const src = value as Record<string, unknown>;
  for (const key of Object.keys(src)) {
    if (/^(lat|long|latitude|longitude)$/i.test(key)) {
      throw new Error(`${label} must not include ${key}. Put the street address in the lines. Coordinates are not a tax input, and the customer sees the address.`);
    }
  }
  const lines = [1, 2, 3, 4, 5].map((n) => (typeof src[`Line${n}`] === 'string' ? String(src[`Line${n}`]).trim() : ''));
  for (const line of lines) {
    if (line && COORD_LINE.test(line)) {
      throw new Error(`${label} lines must be a street address. Coordinates are not allowed because the customer sees them.`);
    }
  }
  const city = typeof src.City === 'string' ? src.City.trim() : '';
  const state = typeof src.CountrySubDivisionCode === 'string' ? src.CountrySubDivisionCode.trim() : '';
  const postal = typeof src.PostalCode === 'string' ? src.PostalCode.trim() : '';
  if (!lines[0] || !city || !state || !postal) {
    throw new Error(`${label} must be a full postal address: Line1, City, CountrySubDivisionCode, and PostalCode.`);
  }
  const out: Record<string, string> = {
    Line1: lines[0],
    City: city,
    CountrySubDivisionCode: state,
    PostalCode: postal,
    Country: typeof src.Country === 'string' && src.Country.trim() ? src.Country.trim() : 'United States',
  };
  for (let n = 2; n <= 5; n += 1) {
    if (lines[n - 1]) out[`Line${n}`] = lines[n - 1];
  }
  return out;
}

/** Shallow copy of a QuickBooks address, including Id, Lat, and Long. Nothing is rewritten. */
export function addressAsRead(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = { ...(value as Record<string, unknown>) };
  return Object.keys(out).length ? out : null;
}

function rateIdList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length) throw new Error('expectedTaxRateIds must list the TaxRate ids and no others, for example ["3","25","9"].');
  const ids = value.map((item, index) => {
    const text = String(item ?? '').trim();
    if (!/^\d{1,10}$/.test(text)) throw new Error(`expectedTaxRateIds[${index}] must be a TaxRate id.`);
    return text;
  });
  return [...new Set(ids)];
}

/**
 * Sparse invoice update for a CDTFA-verified jobsite whose mailing city makes
 * Automated Sales Tax pick the wrong code (Temecula city 29 / rate 13, when
 * CDTFA says unincorporated Riverside 23 / rates 3, 9, 25). A real house number
 * does not fix that, and neither does ShipFromAddr: California district tax
 * follows the ship-to address.
 *
 * UseAutomatedSalesTax false plus TxnTaxCodeRef is the documented partner
 * override that keeps the supplied tax code and its rates, when the company
 * allows it. TotalTax is omitted unless the caller passes an explicit reset.
 * A TotalTax-only payload is prorated over the AST-assigned code and leaves
 * TaxReviewStatus AST_TAX_OVERRIDE, which the post-check rejects.
 * Lines are not sent.
 */
function buildInvoiceShipHold(args: Record<string, unknown>): QboPlan {
  const id = args.id === undefined || args.id === null || args.id === '' ? undefined : qboId(args.id, 'id');
  const syncToken = optString(args, 'syncToken');
  if (!id) throw new Error('shipAddr is only for an invoice update.');
  if (!syncToken) throw new Error('shipAddr needs syncToken: the SyncToken you read. Confirm refuses when QuickBooks has a different one.');
  if (!flagTrue(args.cdtfaVerified)) {
    throw new Error('cdtfaVerified: true is required. A Temecula mailing address keeps city code 29 even with a house number, so the tax code is pinned only after a CDTFA check.');
  }
  if (Array.isArray(args.lines) && args.lines.length) throw new Error('shipAddr cannot be combined with lines. The update must not change lines.');
  if (Array.isArray(args.retaxLineIds)) throw new Error('shipAddr cannot be combined with retaxLineIds.');
  if (note(args.privateNote, 'privateNote')) throw new Error('shipAddr cannot be combined with privateNote.');
  for (const key of ['customerId', 'txnDate', 'dueDate', 'customerMemo', 'docNumber']) {
    if (args[key] !== undefined && args[key] !== '') throw new Error(`shipAddr cannot be combined with ${key}.`);
  }
  const reuse = flagTrue(args.reuseLiveAddress);
  if (reuse && hasShipAddress(args)) throw new Error('reuseLiveAddress cannot be combined with shipAddr or shipFromAddr.');
  let ship: Record<string, unknown> | null = !reuse && args.shipAddr != null && args.shipAddr !== '' ? postalAddress(args.shipAddr, 'shipAddr') : null;
  let shipFrom: Record<string, unknown> | null = !reuse && args.shipFromAddr != null && args.shipFromAddr !== '' ? postalAddress(args.shipFromAddr, 'shipFromAddr') : null;
  if (reuse && args.liveInvoice && typeof args.liveInvoice === 'object') {
    const live = args.liveInvoice as Record<string, unknown>;
    ship = addressAsRead(live.ShipAddr);
    shipFrom = addressAsRead(live.ShipFromAddr);
    if (!ship && !shipFrom) throw new Error(`Invoice ${id} has no ShipAddr or ShipFromAddr to reuse.`);
  }
  if (!reuse && !ship && !shipFrom) throw new Error('Pass shipAddr and/or shipFromAddr, or reuseLiveAddress: true to resend the addresses already on the invoice.');
  const taxCodeId = qboId(args.expectedTaxCodeId, 'expectedTaxCodeId');
  const rateIds = rateIdList(args.expectedTaxRateIds);
  const totalTax = money(args.expectedTotalTax, 'expectedTotalTax');
  const explicitTax = args.totalTax !== undefined && args.totalTax !== null && args.totalTax !== '';
  const taxDetail: Record<string, unknown> = {
    UseAutomatedSalesTax: false,
    TxnTaxCodeRef: { value: taxCodeId },
  };
  if (explicitTax) taxDetail.TotalTax = money(args.totalTax, 'totalTax');
  const body: Record<string, unknown> = {
    Id: id,
    SyncToken: syncToken,
    sparse: true,
    FreeFormAddress: false,
    TxnTaxDetail: taxDetail,
  };
  if (ship) body.ShipAddr = ship;
  if (shipFrom) body.ShipFromAddr = shipFrom;
  return {
    tool: 'qbo_invoice',
    entity: 'Invoice',
    action: 'update',
    path: '/invoice',
    body,
    read: { path: `/invoice/${id}`, apply: 'syncToken' },
    changes: { expectedSyncToken: syncToken, holdTaxCode: taxCodeId, shipAddr: ship, shipFromAddr: shipFrom, ...(reuse ? { reuseLiveAddress: true } : {}) },
    expectSavedTax: { taxCodeId, rateIds, totalTax },
  };
}

function invoiceEntity(json: unknown): Record<string, any> | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, any>;
  const entity = root.Invoice && typeof root.Invoice === 'object' ? root.Invoice : root;
  return entity && typeof entity === 'object' ? entity : null;
}

function lineFingerprint(line: any): string {
  const detail = line?.SalesItemLineDetail || {};
  return [
    line?.Id ?? '',
    line?.DetailType ?? '',
    line?.Amount ?? '',
    line?.Description ?? '',
    detail?.ItemRef?.value ?? '',
    detail?.Qty ?? '',
    detail?.TaxCodeRef?.value ?? '',
  ].join('|');
}

export type SavedTaxInspection = {
  ok: boolean;
  status: 'ok' | 'tax_code_changed' | 'tax_mismatch';
  reasons: string[];
  savedTaxCodeId: string | null;
  savedRateIds: string[];
  savedTotalTax: number | null;
  taxReviewStatus: string | null;
  linesUnchanged: boolean;
};

/** Post-write check for a CDTFA ship-address update. ok when the saved invoice matches. */
export function inspectSavedInvoiceTax(json: unknown, expected: { taxCodeId: string; rateIds: string[]; totalTax: number }, prior: unknown): SavedTaxInspection {
  const saved = invoiceEntity(json);
  const before = invoiceEntity(prior);
  const detail = saved?.TxnTaxDetail || {};
  const taxLines: any[] = Array.isArray(detail.TaxLine) ? detail.TaxLine : [];
  const savedTaxCodeId = savedTaxCode(json);
  const savedRateIds = [...new Set(taxLines.map((line) => String(line?.TaxLineDetail?.TaxRateRef?.value ?? '')).filter(Boolean))];
  const totalRaw = detail.TotalTax;
  const savedTotalTax = totalRaw == null || totalRaw === '' || !Number.isFinite(Number(totalRaw)) ? null : Math.round(Number(totalRaw) * 100) / 100;
  const taxReviewStatus = typeof detail.TaxReviewStatus === 'string' && detail.TaxReviewStatus ? detail.TaxReviewStatus : null;
  const expectedRates = [...new Set(expected.rateIds)];
  const extra = savedRateIds.filter((id) => !expectedRates.includes(id));
  const missing = expectedRates.filter((id) => !savedRateIds.includes(id));
  const priorLines = Array.isArray(before?.Line) ? before.Line.map(lineFingerprint).sort() : [];
  const savedLines = Array.isArray(saved?.Line) ? saved.Line.map(lineFingerprint).sort() : [];
  const linesUnchanged = priorLines.length === savedLines.length && priorLines.every((value, index) => value === savedLines[index]);
  const codeReasons: string[] = [];
  if (savedTaxCodeId !== expected.taxCodeId) codeReasons.push(`Requested TxnTaxCodeRef ${expected.taxCodeId}, QuickBooks saved ${savedTaxCodeId ?? 'none'}.`);
  if (extra.length || missing.length) {
    codeReasons.push(`Saved tax rates ${savedRateIds.join(', ') || 'none'}, expected only ${expectedRates.join(', ')}.`);
  }
  if (taxReviewStatus === 'AST_TAX_OVERRIDE') codeReasons.push('TaxReviewStatus is AST_TAX_OVERRIDE.');
  if (!linesUnchanged) codeReasons.push('Invoice lines changed.');
  const amountReasons: string[] = [];
  if (savedTotalTax == null || Math.abs(savedTotalTax - expected.totalTax) > 0.01) {
    amountReasons.push(`Saved TotalTax ${savedTotalTax ?? 'missing'} does not match expected ${expected.totalTax}.`);
  }
  const reasons = [...codeReasons, ...amountReasons];
  const status = !reasons.length ? 'ok' : codeReasons.length ? 'tax_code_changed' : 'tax_mismatch';
  return { ok: status === 'ok', status, reasons, savedTaxCodeId, savedRateIds, savedTotalTax, taxReviewStatus, linesUnchanged };
}

/** Post-write check for setLineTaxCodes. TotalTax may be 0. Line amounts and items must match the invoice that was read. */
export function inspectSavedLineTax(json: unknown, expected: { totalTax: number; lines: LineTaxCodeChange[] }, prior: unknown): SavedTaxInspection {
  const saved = invoiceEntity(json);
  const before = invoiceEntity(prior);
  const detail = saved?.TxnTaxDetail || {};
  const priorDetail = before?.TxnTaxDetail || {};
  const savedTaxCodeId = savedTaxCode(json);
  const priorCodeRaw = priorDetail?.TxnTaxCodeRef?.value;
  const priorTaxCodeId = priorCodeRaw == null || String(priorCodeRaw).trim() === '' ? null : String(priorCodeRaw);
  const totalRaw = detail.TotalTax;
  const savedTotalTax = totalRaw == null || totalRaw === '' || !Number.isFinite(Number(totalRaw)) ? null : Math.round(Number(totalRaw) * 100) / 100;
  const taxReviewStatus = typeof detail.TaxReviewStatus === 'string' && detail.TaxReviewStatus ? detail.TaxReviewStatus : null;
  const codeReasons: string[] = [];
  if (!priorTaxCodeId || savedTaxCodeId !== priorTaxCodeId) {
    codeReasons.push(`TxnTaxCodeRef changed from ${priorTaxCodeId ?? 'none'} to ${savedTaxCodeId ?? 'none'}.`);
  }
  if (taxReviewStatus === 'AST_TAX_OVERRIDE') codeReasons.push('TaxReviewStatus is AST_TAX_OVERRIDE.');
  if (priorDetail.UseAutomatedSalesTax === false && detail.UseAutomatedSalesTax === true) {
    codeReasons.push('UseAutomatedSalesTax was turned on.');
  }
  const priorLines: any[] = Array.isArray(before?.Line) ? before.Line : [];
  const savedLines: any[] = Array.isArray(saved?.Line) ? saved.Line : [];
  const savedById = new Map(savedLines.filter((line) => line?.Id != null && String(line.Id) !== '').map((line) => [String(line.Id), line]));
  let linesUnchanged = priorLines.length === savedLines.length;
  for (const line of priorLines) {
    if (line?.Id == null || String(line.Id) === '') continue;
    const id = String(line.Id);
    const after = savedById.get(id);
    if (!after) {
      linesUnchanged = false;
      codeReasons.push(`Line ${id} is missing after the update.`);
      continue;
    }
    const beforeAmount = Number(line.Amount);
    const afterAmount = Number(after.Amount);
    if (!Number.isFinite(beforeAmount) || !Number.isFinite(afterAmount) || Math.abs(beforeAmount - afterAmount) > 0.009) {
      linesUnchanged = false;
      codeReasons.push(`Line ${id} amount changed from ${line.Amount} to ${after.Amount}.`);
    }
    const beforeItem = line?.SalesItemLineDetail?.ItemRef?.value;
    const afterItem = after?.SalesItemLineDetail?.ItemRef?.value;
    if (beforeItem != null && String(beforeItem) !== String(afterItem ?? '')) {
      linesUnchanged = false;
      codeReasons.push(`Line ${id} item changed from ${beforeItem} to ${afterItem ?? 'none'}.`);
    }
  }
  for (const change of expected.lines) {
    const after = savedById.get(change.lineId);
    const code = after?.SalesItemLineDetail?.TaxCodeRef?.value;
    if (code !== change.taxCode) codeReasons.push(`Line ${change.lineId} tax code is ${code ?? 'none'}, expected ${change.taxCode}.`);
  }
  const amountReasons: string[] = [];
  if (savedTotalTax == null || Math.abs(savedTotalTax - expected.totalTax) > 0.01) {
    amountReasons.push(`Saved TotalTax ${savedTotalTax ?? 'missing'} does not match expected ${expected.totalTax}.`);
  }
  const reasons = [...codeReasons, ...amountReasons];
  const status = !reasons.length ? 'ok' : codeReasons.length ? 'tax_code_changed' : 'tax_mismatch';
  return { ok: status === 'ok', status, reasons, savedTaxCodeId, savedRateIds: [], savedTotalTax, taxReviewStatus, linesUnchanged };
}

/** Saved header TxnTaxCodeRef on an Invoice response, or null. */
export function savedTaxCode(json: unknown): string | null {
  const root = (json && typeof json === 'object' ? json : {}) as Record<string, any>;
  const entity = root.Invoice || root;
  const value = entity?.TxnTaxDetail?.TxnTaxCodeRef?.value;
  return typeof value === 'string' && value ? value : null;
}

export function parseSetLineTaxCodes(value: unknown): LineTaxCodeChange[] {
  if (!Array.isArray(value) || !value.length) throw new Error('setLineTaxCodes needs at least one line.');
  const seen = new Set<string>();
  return value.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`setLineTaxCodes[${index}] must be { lineId, taxCode }.`);
    const source = row as { lineId?: unknown; taxCode?: unknown };
    const lineId = qboId(source.lineId, `setLineTaxCodes[${index}].lineId`);
    const taxCode = String(source.taxCode ?? '').trim().toUpperCase();
    if (taxCode !== 'TAX' && taxCode !== 'NON') throw new Error(`setLineTaxCodes[${index}].taxCode must be TAX or NON.`);
    if (seen.has(lineId)) throw new Error(`setLineTaxCodes lists line ${lineId} more than once.`);
    seen.add(lineId);
    return { lineId, taxCode };
  });
}

/**
 * Sparse update that resends the full Line array and changes only TaxCodeRef on the named lines.
 * TxnTaxCodeRef is the code already on the invoice. UseAutomatedSalesTax false is resent when the
 * invoice was saved that way. BillAddr, ShipAddr, ShipFromAddr, the customer, and the dates are
 * resent as read. TotalTax is not sent; QuickBooks computes it, and 0 is a valid expected total.
 */
export function setLineTaxInvoiceBody(invoice: Record<string, unknown>, changes: LineTaxCodeChange[]): Record<string, unknown> {
  const lines = Array.isArray(invoice.Line) ? (invoice.Line as Record<string, any>[]) : [];
  const wanted = new Map(changes.map((change) => [change.lineId, change.taxCode]));
  const id = String(invoice.Id ?? '');
  for (const lineId of wanted.keys()) {
    const line = lines.find((row) => String(row?.Id ?? '') === lineId);
    if (!line) throw new Error(`Invoice ${id} has no line ${lineId}.`);
    if (line.DetailType !== 'SalesItemLineDetail') throw new Error(`Invoice ${id} line ${lineId} is not a sales line.`);
  }
  const outLines = lines.map((line) => copyInvoiceLine(line, wanted.get(String(line?.Id ?? '')) || null));
  const detail = (invoice.TxnTaxDetail || {}) as { TxnTaxCodeRef?: { value?: unknown }; UseAutomatedSalesTax?: unknown };
  const taxCodeId = detail.TxnTaxCodeRef?.value;
  if (taxCodeId == null || String(taxCodeId).trim() === '') throw new Error(`Invoice ${id} has no TxnTaxCodeRef to keep.`);
  const taxDetail: Record<string, unknown> = { TxnTaxCodeRef: { value: String(taxCodeId) } };
  if (detail.UseAutomatedSalesTax === false) taxDetail.UseAutomatedSalesTax = false;
  const body: Record<string, unknown> = {
    Id: qboId(invoice.Id, 'Id'),
    sparse: true,
    Line: outLines,
    TxnTaxDetail: taxDetail,
  };
  if (invoice.CustomerRef && typeof invoice.CustomerRef === 'object') body.CustomerRef = { ...(invoice.CustomerRef as Record<string, unknown>) };
  if (typeof invoice.TxnDate === 'string' && invoice.TxnDate) body.TxnDate = invoice.TxnDate;
  if (typeof invoice.DueDate === 'string' && invoice.DueDate) body.DueDate = invoice.DueDate;
  const bill = addressAsRead(invoice.BillAddr);
  const ship = addressAsRead(invoice.ShipAddr);
  const shipFrom = addressAsRead(invoice.ShipFromAddr);
  if (bill) body.BillAddr = bill;
  if (ship) body.ShipAddr = ship;
  if (shipFrom) body.ShipFromAddr = shipFrom;
  return body;
}

function copyInvoiceLine(line: Record<string, any>, taxCode: 'TAX' | 'NON' | null): Record<string, unknown> {
  const detailName = typeof line.DetailType === 'string' ? line.DetailType : '';
  const source = detailName && line[detailName] && typeof line[detailName] === 'object' ? { ...line[detailName] } : null;
  if (taxCode && source && detailName === 'SalesItemLineDetail') source.TaxCodeRef = { value: taxCode };
  const out: Record<string, unknown> = { DetailType: line.DetailType };
  if (line.Id != null && String(line.Id) !== '') out.Id = String(line.Id);
  if (line.LineNum != null) out.LineNum = line.LineNum;
  if (line.Amount != null) out.Amount = line.Amount;
  if (typeof line.Description === 'string') out.Description = line.Description;
  if (source && detailName) out[detailName] = source;
  return out;
}

function buildInvoiceSetLineTax(
  args: Record<string, unknown>,
  id: string | undefined,
  syncToken: string | undefined,
  hasLines: boolean,
  noteText: string | undefined,
  retax: unknown[] | null
): QboPlan {
  if (!id) throw new Error('setLineTaxCodes is only for an invoice update.');
  if (!syncToken) throw new Error('setLineTaxCodes needs syncToken: the SyncToken you read.');
  if (hasLines) throw new Error('setLineTaxCodes cannot be combined with lines. The lines are resent from the live invoice.');
  if (noteText) throw new Error('setLineTaxCodes cannot be combined with privateNote.');
  if (retax) throw new Error('setLineTaxCodes cannot be combined with retaxLineIds.');
  if (args.totalTax !== undefined && args.totalTax !== null && args.totalTax !== '') {
    throw new Error('setLineTaxCodes cannot be combined with totalTax. Pass expectedTotalTax for the check. 0 is allowed.');
  }
  for (const key of ['customerId', 'txnDate', 'dueDate', 'customerMemo', 'docNumber', 'txnTaxCodeId']) {
    if (args[key] !== undefined && args[key] !== '') throw new Error(`setLineTaxCodes cannot be combined with ${key}. The saved customer, dates, and tax code are kept.`);
  }
  const changes = parseSetLineTaxCodes(args.setLineTaxCodes);
  const totalTax = moneyAllowZero(args.expectedTotalTax, 'expectedTotalTax');
  const live = args.liveInvoice && typeof args.liveInvoice === 'object' ? (args.liveInvoice as Record<string, unknown>) : null;
  const body = live ? { ...setLineTaxInvoiceBody(live, changes), SyncToken: syncToken } : null;
  return {
    tool: 'qbo_invoice',
    entity: 'Invoice',
    action: 'update',
    path: '/invoice',
    body,
    read: { path: `/invoice/${id}`, apply: 'setLineTax' },
    changes: { expectedSyncToken: syncToken, setLineTaxCodes: changes, expectedTotalTax: totalTax },
    expectLineTax: { totalTax, lines: changes },
  };
}

/**
 * qbo_invoice retaxLineIds: re-save an existing invoice so Automated Sales Tax recomputes it on the
 * given header code with NO TotalTax override. Invoice reads show each line's TaxClassificationRef
 * from the item's current class (39144 line 3 read EUC-99990202 right after the item fix, with the
 * invoice unchanged), but the saved TxnTaxDetail (TaxLine amounts, NetAmountTaxable, TotalTax) is not
 * recalculated until the invoice is saved again. This resends the full Line array as read (sparse:true,
 * so addresses, memo and notes stay) with TaxCodeRef TAX on the listed lines. Dropping their
 * TaxClassificationRef is harmless and defensive: QuickBooks takes the class from the item either way,
 * and this avoids resending a stale value. ShipAddr/ShipFromAddr are
 * resent as read. The handler shows the body on preview from a live read; confirm rebuilds it from its
 * own read and refuses a SyncToken change.
 */
function buildInvoiceRetax(args: Record<string, unknown>, id: string | undefined, syncToken: string | undefined, hasLines: boolean, note: string | undefined): QboPlan {
  if (!id) throw new Error('retaxLineIds is only for an invoice update.');
  if (!syncToken) throw new Error('retaxLineIds needs syncToken: the SyncToken you read.');
  if (hasLines) throw new Error('retaxLineIds cannot be combined with lines; the lines are resent from the live invoice.');
  if (note) throw new Error('retaxLineIds cannot be combined with privateNote.');
  if (args.totalTax !== undefined && args.totalTax !== null && args.totalTax !== '') throw new Error('retaxLineIds cannot be combined with totalTax; the point is to let QuickBooks compute the tax.');
  for (const key of ['customerId', 'txnDate', 'dueDate', 'customerMemo', 'docNumber']) {
    if (args[key] !== undefined && args[key] !== '') throw new Error(`retaxLineIds cannot be combined with ${key}.`);
  }
  const lineIds = (args.retaxLineIds as unknown[]).map((value, index) => qboId(value, `retaxLineIds[${index}]`));
  if (!lineIds.length) throw new Error('retaxLineIds needs at least one line id.');
  const txnTaxCodeId = qboId(args.txnTaxCodeId, 'txnTaxCodeId');
  const live = args.liveInvoice && typeof args.liveInvoice === 'object' ? (args.liveInvoice as Record<string, unknown>) : null;
  const body = live ? { ...retaxInvoiceBody(live, lineIds, txnTaxCodeId), SyncToken: syncToken } : null;
  return {
    tool: 'qbo_invoice',
    entity: 'Invoice',
    action: 'update',
    path: '/invoice',
    body,
    read: { path: `/invoice/${id}`, apply: 'retaxLines' },
    changes: { expectedSyncToken: syncToken, retaxLineIds: lineIds, txnTaxCodeId },
    expectTaxCode: txnTaxCodeId,
    expectNetAmountTaxable: 'body',
  };
}

/** Sparse retax body from a live invoice. Throws when a listed line is missing or the invoice has no ShipFromAddr. */
export function retaxInvoiceBody(invoice: Record<string, unknown>, lineIds: string[], txnTaxCodeId: string): Record<string, unknown> {
  const lines = Array.isArray(invoice.Line) ? (invoice.Line as Record<string, any>[]) : [];
  // A sparse Line array replaces every line, so a line type this body does not resend would be deleted.
  const other = lines.filter((line) => line?.DetailType !== 'SalesItemLineDetail' && line?.DetailType !== 'SubTotalLineDetail');
  if (other.length) {
    throw new Error(`Invoice ${String(invoice.Id ?? '')} has ${other.map((line) => line?.DetailType || 'unknown').join(', ')} lines; retax resends only sales lines and would delete them. Nothing was posted.`);
  }
  const sales = lines.filter((line) => line?.DetailType === 'SalesItemLineDetail');
  for (const lineId of lineIds) {
    if (!sales.some((line) => String(line.Id) === lineId)) throw new Error(`Invoice ${String(invoice.Id ?? '')} has no sales line ${lineId}.`);
  }
  const shipFrom = addressArg(invoice.ShipFromAddr);
  if (!shipFrom) throw new Error(`Invoice ${String(invoice.Id ?? '')} has no ShipFromAddr; QuickBooks would source the tax from the company address.`);
  const ship = addressArg(invoice.ShipAddr);
  const outLines = sales.map((line) => {
    const detail = { ...(line.SalesItemLineDetail || {}) } as Record<string, any>;
    const retaxed = lineIds.includes(String(line.Id));
    if (retaxed) {
      detail.TaxCodeRef = { value: 'TAX' };
      delete detail.TaxClassificationRef;
    } else if (!detail.TaxClassificationRef || !detail.TaxClassificationRef.value) {
      delete detail.TaxClassificationRef;
    }
    const out: Record<string, unknown> = { Id: String(line.Id), LineNum: line.LineNum, Amount: line.Amount, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: detail };
    if (typeof line.Description === 'string') out.Description = line.Description;
    return out;
  });
  const body: Record<string, unknown> = {
    Id: qboId(invoice.Id, 'Id'),
    sparse: true,
    Line: outLines,
    TxnTaxDetail: { TxnTaxCodeRef: { value: txnTaxCodeId } },
    ShipFromAddr: shipFrom,
  };
  if (ship) body.ShipAddr = ship;
  return body;
}

/** Payload that requestid is derived from. Includes the read, so a retry of the same change matches. */
export function idempotencyPayload(plan: QboPlan): unknown {
  return {
    tool: plan.tool,
    path: plan.path,
    operation: plan.operation || null,
    body: plan.body,
    read: plan.read || null,
    changes: plan.changes || null,
  };
}
