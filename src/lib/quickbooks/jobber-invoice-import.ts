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
 * - TxnDate is the issue timestamp's America/Los_Angeles date. DueDate is the due date
 * - CustomerMemo is the Jobber client message
 * - EmailStatus is never set
 *
 * ServiceDate is not copied: the invoice line we can read does not carry the visit date.
 * October Jobber payouts are already deposits that hit Sales. Linking a payment onto
 * one of those deposits records the invoice income as well. The preview says so.
 */
import { runQboPlan, writeRealmQuery, type QboWriteDeps } from './durable-write.ts';
import { taxCodeIdForCity, taxCodeMissingReason } from './tax-codes.ts';
import { describeQboWriteGate } from './write-gate.ts';
import { parseBatchId, type QboPlan } from './write-payloads.ts';

export type JobberInvoiceForQbo = {
  invoiceNumber: string;
  issuedDate: string;
  dueDate: string | null;
  message: string | null;
  clientName: string;
  city: string | null;
  lines: Array<{ name: string; description: string | null; quantity: number; unitPrice: number; taxable: boolean }>;
  total: number;
  taxAmount: number;
  paymentsTotal: number;
};

export type ImportStatus = 'create' | 'skip' | 'blocked';

export type ImportInvoicePlan = {
  invoiceNumber: string;
  status: ImportStatus;
  reason: string | null;
  customerName: string;
  total: number;
  taxAmount: number;
  paymentsTotal: number;
  body: Record<string, unknown> | null;
  payment: Record<string, unknown> | null;
};

const DEPOSIT_WARNING =
  'October Jobber payouts are already QBO deposits that post to 4010 Sales. Linking a payment to one of those deposits also records the invoice income. Read the deposit before confirm, or use payments: "undeposited".';

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

export function buildJobberSyncedInvoice(
  invoice: JobberInvoiceForQbo,
  customerId: string,
  itemsByName: Record<string, string>,
  txnTaxCodeId: string
): { body: Record<string, unknown> | null; missingItems: string[] } {
  const missing = [...new Set(invoice.lines.map((line) => line.name).filter((name) => !itemsByName[name]))];
  if (missing.length || !invoice.lines.length) return { body: null, missingItems: missing.length ? missing : ['(no lines)'] };
  const txnDate = pacificDate(invoice.issuedDate);
  const due = invoice.dueDate ? pacificDate(invoice.dueDate) : txnDate;
  const body: Record<string, unknown> = {
    DocNumber: invoice.invoiceNumber,
    CustomerRef: { value: customerId },
    TxnDate: txnDate,
    DueDate: due,
    Line: invoice.lines.map((line) => ({
      Amount: money(line.quantity * line.unitPrice),
      DetailType: 'SalesItemLineDetail',
      ...(line.description ? { Description: line.description } : {}),
      SalesItemLineDetail: {
        ItemRef: { value: itemsByName[line.name] },
        Qty: line.quantity,
        UnitPrice: money(line.unitPrice),
        TaxCodeRef: { value: line.taxable ? 'TAX' : 'NON' },
      },
    })),
    TxnTaxDetail: { TxnTaxCodeRef: { value: txnTaxCodeId } },
  };
  const memo = (invoice.message || '').trim();
  if (memo) body.CustomerMemo = { value: memo.slice(0, 1000) };
  return { body, missingItems: [] };
}

export function classifyJobberInvoice(
  invoice: JobberInvoiceForQbo,
  existingDocNumbers: Set<string>,
  customerId: string | null,
  itemsByName: Record<string, string>,
  txnTaxCodeId: string | null,
  taxReason?: string
): ImportInvoicePlan {
  const base = {
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.clientName,
    total: invoice.total,
    taxAmount: invoice.taxAmount,
    paymentsTotal: invoice.paymentsTotal,
  };
  if (existingDocNumbers.has(invoice.invoiceNumber)) {
    return { ...base, status: 'skip', reason: 'DocNumber already exists in QuickBooks', body: null, payment: null };
  }
  if (!customerId) {
    return { ...base, status: 'blocked', reason: `No QuickBooks customer with DisplayName "${invoice.clientName}"`, body: null, payment: null };
  }
  if (!txnTaxCodeId) {
    return { ...base, status: 'blocked', reason: taxReason || taxCodeMissingReason(invoice.city), body: null, payment: null };
  }
  const built = buildJobberSyncedInvoice(invoice, customerId, itemsByName, txnTaxCodeId);
  if (!built.body) {
    return { ...base, status: 'blocked', reason: `Missing QuickBooks items: ${built.missingItems.join(', ')}`, body: null, payment: null };
  }
  const payment = invoice.paymentsTotal > 0 ? { amount: money(Math.min(invoice.paymentsTotal, invoice.total)), ref: invoice.invoiceNumber } : null;
  return { ...base, status: 'create', reason: null, body: built.body, payment };
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "\\'")}'`;
}

function rowsOf(json: any, key: string): Record<string, unknown>[] {
  const rows = json?.QueryResponse?.[key];
  return Array.isArray(rows) ? rows : [];
}

export async function runJobberInvoiceImport(
  args: Record<string, unknown>,
  deps: QboWriteDeps & {
    loadJobberInvoices?: (numbers: string[]) => Promise<JobberInvoiceForQbo[]>;
    qboQuery?: (query: string) => Promise<unknown>;
  } = {}
): Promise<Record<string, unknown>> {
  const numbers = invoiceNumbersFromArgs(args);
  const confirm = args.confirm === true || (typeof args.confirm === 'string' && args.confirm.trim().toLowerCase() === 'true');
  const batchId = parseBatchId(args.batchId, confirm);
  const payments = args.payments === undefined || args.payments === '' ? 'none' : String(args.payments);
  if (payments !== 'none' && payments !== 'undeposited' && payments !== 'deposit') {
    throw new Error('payments must be none, undeposited, or deposit.');
  }
  const depositId = args.depositId === undefined || args.depositId === '' ? null : String(args.depositId).trim();
  if (payments === 'deposit' && !depositId) throw new Error('depositId is required when payments is deposit.');
  const limit = importChunkLimit(args.limit);
  const { chunk, nextCursor } = sliceInvoiceChunk(numbers, args.cursor, limit);
  const query = deps.qboQuery || ((sql: string) => writeRealmQuery(sql, deps));
  const load = deps.loadJobberInvoices || ((nums: string[]) => loadJobberInvoices(nums, deps));
  const invoices = await load(chunk);
  const byNumber = new Map(invoices.map((invoice) => [invoice.invoiceNumber, invoice]));
  const cityOverrides = cityOverrideMap(args.taxCodeByCity);
  const overrideId = typeof args.txnTaxCodeId === 'string' && args.txnTaxCodeId.trim() ? args.txnTaxCodeId.trim() : null;
  const overrideExists = overrideId ? await taxCodeIdExists(overrideId, query) : false;
  const customerTax = new Map<string, string | null>();
  const plans: ImportInvoicePlan[] = [];
  for (const number of chunk) {
    const invoice = byNumber.get(number);
    if (!invoice) {
      plans.push({ invoiceNumber: number, status: 'blocked', reason: 'Jobber invoice was not found', customerName: '', total: 0, taxAmount: 0, paymentsTotal: 0, body: null, payment: null });
      continue;
    }
    const existing = rowsOf(await query(`select Id, DocNumber from Invoice where DocNumber = ${sqlString(number)}`), 'Invoice');
    const customers = rowsOf(await query(`select Id, DisplayName from Customer where DisplayName = ${sqlString(invoice.clientName)}`), 'Customer');
    const items: Record<string, string> = {};
    for (const name of [...new Set(invoice.lines.map((line) => line.name))]) {
      const found = rowsOf(await query(`select Id, Name from Item where Name = ${sqlString(name)}`), 'Item');
      const id = found[0]?.Id;
      if (id != null) items[name] = String(id);
    }
    const customerId = customers[0]?.Id != null ? String(customers[0].Id) : null;
    const tax = await taxForInvoice(invoice, customerId, overrideId, overrideExists, cityOverrides, customerTax, query);
    plans.push(classifyJobberInvoice(invoice, new Set(existing.map((row) => String(row.DocNumber))), customerId, items, tax.id, tax.reason));
  }
  const creates = plans.filter((row) => row.status === 'create');
  const summary = {
    batchId,
    count: plans.length,
    create: creates.length,
    skip: plans.filter((row) => row.status === 'skip').length,
    blocked: plans.filter((row) => row.status === 'blocked').length,
    invoiceTotal: money(creates.reduce((sum, row) => sum + row.total, 0)),
    taxTotal: money(creates.reduce((sum, row) => sum + row.taxAmount, 0)),
    paymentTotal: money(creates.reduce((sum, row) => sum + (row.payment ? Number(row.payment.amount) : 0), 0)),
    payments,
    depositId,
    warning: payments === 'deposit' ? DEPOSIT_WARNING : null,
    cursor: args.cursor ? String(args.cursor) : null,
    nextCursor,
    done: nextCursor == null,
    limit,
  };
  if (!confirm) {
    return { ok: true, dryRun: true, wrote: false, ...summary, invoices: plans };
  }
  const gate = describeQboWriteGate(deps.env || process.env);
  if (!gate.enabled) {
    return { ok: false, dryRun: true, wrote: false, refused: true, error: gate.blockedReason, ...summary, invoices: plans };
  }
  const posted: Record<string, unknown>[] = [];
  for (const row of creates) {
    const invoicePlan: QboPlan = { tool: 'qbo_import_jobber_invoices', entity: 'Invoice', action: 'create', path: '/invoice', body: row.body };
    const invoiceResult = await runQboPlan(invoicePlan, { confirm: true, batchId, requestId: requestKey(batchId!, row.invoiceNumber, 'inv') }, deps);
    const entry: Record<string, unknown> = { invoiceNumber: row.invoiceNumber, invoice: { wrote: invoiceResult.wrote, id: invoiceResult.ids.id, error: invoiceResult.error || null } };
    if (invoiceResult.wrote && row.payment && payments !== 'none' && invoiceResult.ids.id) {
      const amount = Number(row.payment.amount);
      const paymentBody = {
        CustomerRef: (row.body as { CustomerRef: { value: string } }).CustomerRef,
        TotalAmt: amount,
        TxnDate: (row.body as { TxnDate: string }).TxnDate,
        PaymentRefNum: String(row.payment.ref).slice(0, 21),
        Line: [{ Amount: amount, LinkedTxn: [{ TxnId: invoiceResult.ids.id, TxnType: 'Invoice' }] }],
      };
      const paymentPlan: QboPlan = { tool: 'qbo_import_jobber_invoices', entity: 'Payment', action: 'create', path: '/payment', body: paymentBody };
      const paymentResult = await runQboPlan(paymentPlan, { confirm: true, batchId, requestId: requestKey(batchId!, row.invoiceNumber, 'pay') }, deps);
      entry.payment = { wrote: paymentResult.wrote, id: paymentResult.ids.id, error: paymentResult.error || null };
      if (payments === 'deposit' && paymentResult.wrote && paymentResult.ids.id && depositId) {
        const link: QboPlan = {
          tool: 'qbo_import_jobber_invoices',
          entity: 'Deposit',
          action: 'update',
          path: '/deposit',
          body: { Id: depositId },
          read: { path: `/deposit/${depositId}`, apply: 'linkPayment' },
          changes: { paymentId: paymentResult.ids.id, amount },
        };
        const linkResult = await runQboPlan(link, { confirm: true, batchId, requestId: requestKey(batchId!, row.invoiceNumber, 'dep') }, deps);
        entry.deposit = { wrote: linkResult.wrote, id: linkResult.ids.id, error: linkResult.error || null };
      }
    }
    posted.push(entry);
  }
  return {
    ok: posted.every((row) => (row.invoice as { wrote: boolean }).wrote) && plans.every((row) => row.status !== 'blocked'),
    dryRun: false,
    wrote: posted.some((row) => (row.invoice as { wrote: boolean }).wrote),
    ...summary,
    invoices: plans,
    posted,
  };
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
  } catch {
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
  } catch {
    return null;
  }
  return null;
}

function jobCity(node: Record<string, any>): string | null {
  const jobs = node.jobs?.nodes || [];
  for (const job of jobs) {
    const city = job?.property?.address?.city;
    if (typeof city === 'string' && city.trim()) return city.trim();
  }
  return null;
}

function requestKey(batchId: string, invoiceNumber: string, kind: string): string {
  const raw = `${kind}-${batchId}-${invoiceNumber}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50);
  return raw.length >= 8 ? raw : `${raw}00000000`.slice(0, 8);
}

async function loadJobberInvoices(numbers: string[], deps: QboWriteDeps): Promise<JobberInvoiceForQbo[]> {
  const { jobberGraphql, assertNoJobberErrors } = await import('../jobber/client.ts');
  const out: JobberInvoiceForQbo[] = [];
  for (const number of numbers) {
    const res = await jobberGraphql(
      `query ImportInvoice($searchTerm: String!) {
        invoices(first: 5, searchTerm: $searchTerm) {
          nodes {
            invoiceNumber issuedDate dueDate message
            amounts { total taxAmount paymentsTotal }
            client { name }
            jobs(first: 3) { nodes { property { address { city } } } }
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
    out.push({
      invoiceNumber: number,
      issuedDate: String(match.issuedDate),
      dueDate: match.dueDate ? String(match.dueDate) : null,
      message: match.message ? String(match.message) : null,
      clientName: String(match.client?.name || ''),
      city: jobCity(match),
      total: Number(match.amounts?.total || 0),
      taxAmount: Number(match.amounts?.taxAmount || 0),
      paymentsTotal: Number(match.amounts?.paymentsTotal || 0),
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
