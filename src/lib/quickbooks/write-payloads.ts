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

export type QboReadApply = 'syncToken' | 'purchaseAccounts' | 'closeDate' | 'privateNote' | 'customerMemo' | 'void';

export type QboPlan = {
  tool: QboWriteTool;
  entity: string;
  action: 'create' | 'update' | 'void' | 'attach' | 'close';
  path: string;
  operation?: 'update' | 'void';
  /** Exact POST body when no read is required. Null when confirm must GET first. */
  body: Record<string, unknown> | null;
  read?: { path: string; apply: QboReadApply };
  changes?: unknown;
  reason?: string;
};

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
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) throw new Error(`${field} must have at most 2 decimal places`);
  if (cents <= 0) throw new Error(`${field} must be greater than 0`);
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

function note(value: unknown, field: string, max = 4000): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const s = value.trim();
  if (!s) return undefined;
  if (s.length > max) throw new Error(`${field} is longer than ${max} characters`);
  return s;
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
    const amount = money(row.amount, `lines[${index}].amount`);
    const paymentId = row.paymentId === undefined || row.paymentId === '' ? undefined : qboId(row.paymentId, `lines[${index}].paymentId`);
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
  const privateNote = note(args.privateNote, 'privateNote');
  const customerMemo = note(args.customerMemo, 'customerMemo');
  const number = docNumber(args.docNumber);
  if (txnDate) body.TxnDate = txnDate;
  if (dueDate) body.DueDate = dueDate;
  if (privateNote) body.PrivateNote = privateNote;
  if (customerMemo) body.CustomerMemo = { value: customerMemo };
  if (number) body.DocNumber = number;
  if (id) {
    body.Id = id;
    body.sparse = !hasLines;
    if (syncToken) body.SyncToken = syncToken;
  }
  if (Object.keys(body).filter((key) => key !== 'Id' && key !== 'sparse' && key !== 'SyncToken').length === 0) {
    throw new Error('Invoice update needs at least one field to change.');
  }
  const plan: QboPlan = {
    tool: 'qbo_invoice',
    entity: 'Invoice',
    action: id ? 'update' : 'create',
    path: '/invoice',
    body,
  };
  if (id && !syncToken) plan.read = { path: `/invoice/${id}`, apply: 'syncToken' };
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
  const syncToken = typeof entity.SyncToken === 'string' ? entity.SyncToken : '';
  if (!syncToken) throw new Error(`${plan.entity} is missing SyncToken.`);
  const body = { ...(plan.body || {}) };
  body.Id = qboId(entity.Id ?? body.Id, 'Id');
  body.SyncToken = syncToken;
  if (plan.read?.apply === 'void') body.sparse = true;
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
