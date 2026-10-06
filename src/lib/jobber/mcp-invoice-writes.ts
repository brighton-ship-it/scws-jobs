/**
 * Invoice writes for the MCP gateway.
 *
 * Schema (do not invent a second shape):
 * - invoiceCreate(input: InvoiceCreateInput!) and
 *   invoiceEdit(invoiceId: EncodedId!, input: InvoiceEditInput!)
 *   were validated against Jobber's live schema on 2026-09-24 at API version
 *   2026-05-12 (getjobber-cli write-redesign). Jobber's changelog between this
 *   app's pin (2025-04-16) and 2026-05-12 is additive enum values only.
 * - invoiceCreate requires clientId, dueDetails, tax.taxCalculationMethod
 *   (EXCLUSIVE | INCLUSIVE), and a non-empty lineItems list (name at minimum).
 *   jobId is an accepted optional argument. issuedDate is omitted so the
 *   create stays unissued.
 * - InvoiceCreationLineItemInput does not define saveToProductsAndServices.
 *   A live invoiceCreate on the 2025-04-16 pin rejects that field
 *   ("Field is not defined on InvoiceCreationLineItemInput"). Quote create
 *   lines (QuoteCreateLineItemAttributes) and job create lines
 *   (JobCreateLineItemAttributes) still require it. Quote edit lines
 *   (QuoteEditLineItemAttributes) do not have it; this gateway adds quote
 *   lines with quoteCreateLineItems, not quoteEditLineItems.
 * - InvoiceEditInput does not take line items. A live invoiceEdit on
 *   2025-04-16 was rejected: lineItemsToEdit is not defined on
 *   InvoiceEditInput. The public introspection at API version 2025-01-20
 *   (hightreequency/jobberschema) lists InvoiceEditInput as message,
 *   taxRateId, discount, allowClientHubCreditCardPayments,
 *   allowClientHubAchPayments, invoiceNumber, issuedDate, dueDetails,
 *   subject, contractDisclaimer, customFields, allowReviewRequest,
 *   salespersonId, allowPartialPayments. That schema has
 *   quoteCreateLineItems / quoteEditLineItems / quoteDeleteLineItems and
 *   the same trio for jobs and visits. It has no invoiceCreateLineItems,
 *   invoiceEditLineItems, or invoiceDeleteLineItems. Those names are
 *   unverified on later API versions and are not called.
 * - taxRateId, allowClientHubCreditCardPayments, allowClientHubAchPayments,
 *   and allowPartialPayments are on InvoiceEditInput in that introspection.
 *   edit_invoice maps allowCardPayments, allowAchPayments, and
 *   allowPartialPayments onto those three fields. They are invoice settings,
 *   not a charge. This module never records or collects a payment.
 * - invoiceMarkAsSent exists and only flags the record, but this module
 *   never calls it. invoiceSend is gone. Nothing here emails or texts.
 */

import {
  assertNoJobberErrors,
  jobberGraphql,
  jobberUserErrors,
} from './client.ts';
import { getInvoice } from './mcp-invoices.ts';
import { getJob } from './mcp-jobs.ts';
import type { JobberDeps } from './quotes.ts';
import type { JobberInvoiceSummary } from './mcp-invoices.ts';

export const INVOICE_TAX_METHODS = ['EXCLUSIVE', 'INCLUSIVE'] as const;
export type InvoiceTaxMethod = (typeof INVOICE_TAX_METHODS)[number];

/** Argument names that would send, flag sent, record, or collect. Not settings. */
export const REJECTED_INVOICE_ACTION_FIELDS = [
  'recordPayment',
  'collectPayment',
  'sendInvoice',
  'markInvoiceSent',
  'markAsSent',
  'emailInvoice',
  'textInvoice',
] as const;

const DELIVERY_MUTATION =
  /invoiceMarkAsSent|invoiceSend|sendInvoice|quoteSend|emailCreate|\bsms\b|clientHubMessage|workObjectSend|transitionQuoteTo/i;

const INVOICE_EDIT = `
  mutation McpInvoiceEdit($invoiceId: EncodedId!, $input: InvoiceEditInput!) {
    invoiceEdit(invoiceId: $invoiceId, input: $input) {
      invoice { id invoiceNumber invoiceStatus subject }
      userErrors { message path }
    }
  }
`;

const INVOICE_CREATE = `
  mutation McpInvoiceCreate($input: InvoiceCreateInput!) {
    invoiceCreate(input: $input) {
      invoice { id invoiceNumber invoiceStatus subject }
      userErrors { message path }
    }
  }
`;

const JOB_LINES = `
  query McpJobLinesForInvoice($id: EncodedId!) {
    job(id: $id) {
      id
      lineItems(first: 80) {
        nodes { name description quantity unitPrice taxable }
      }
    }
  }
`;

const JOB_LINES_NO_TAXABLE = `
  query McpJobLinesForInvoiceNoTaxable($id: EncodedId!) {
    job(id: $id) {
      id
      lineItems(first: 80) {
        nodes { name description quantity unitPrice }
      }
    }
  }
`;

export type InvoiceLineDraft = {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  taxable: boolean;
};

export type InvoiceLineUpdate = {
  lineItemId: string;
  name?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  taxable?: boolean;
};

type JobLineNode = {
  name?: string | null;
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  taxable?: boolean | null;
};

function graphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  assertInvoiceWriteDoesNotDeliver(query);
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

export function assertInvoiceWriteDoesNotDeliver(query: string): void {
  if (DELIVERY_MUTATION.test(query)) {
    throw new Error('Invoice writes cannot send, mark sent, email, or text a client');
  }
}

/**
 * Line-item writes are not sent. Sources for the refusal:
 * - Live Jobber error (API pin 2025-04-16): lineItemsToEdit is not defined
 *   on InvoiceEditInput.
 * - Public introspection, extensions.versioning.version 2025-01-20: no
 *   line-item fields on InvoiceEditInput, and no invoice*LineItems mutations.
 * invoiceCreateLineItems / invoiceEditLineItems / invoiceDeleteLineItems are
 * unverified and are not called.
 */
export const INVOICE_LINE_ITEMS_UNSUPPORTED =
  "Jobber's API cannot edit invoice line items; use the Jobber web UI.";

export function invoiceLineItemsRequested(input: {
  addLineItems?: InvoiceLineDraft[];
  updateLineItems?: InvoiceLineUpdate[];
  removeLineItemIds?: string[];
}): boolean {
  return Boolean(input.addLineItems?.length || input.updateLineItems?.length || input.removeLineItemIds?.length);
}

export function assertNoInvoicePaymentOptions(args: Record<string, unknown>): void {
  const present = REJECTED_INVOICE_ACTION_FIELDS.filter((key) => key in args && args[key] != null);
  if (!present.length) return;
  throw new Error(
    `Unsupported: this gateway cannot send, mark sent, record, or collect a payment (${present.join(', ')}).`
  );
}

function linePayload(line: InvoiceLineDraft): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxable: line.taxable,
  };
  if (line.description?.trim()) row.description = line.description.trim();
  return row;
}

export function buildInvoiceEditInput(input: {
  addLineItems?: InvoiceLineDraft[];
  updateLineItems?: InvoiceLineUpdate[];
  removeLineItemIds?: string[];
  taxRateId?: string | null;
  allowCardPayments?: boolean | null;
  allowAchPayments?: boolean | null;
  allowPartialPayments?: boolean | null;
}): Record<string, unknown> {
  if (invoiceLineItemsRequested(input)) {
    throw new Error(INVOICE_LINE_ITEMS_UNSUPPORTED);
  }
  const attributes: Record<string, unknown> = {};
  const taxRateId = input.taxRateId?.trim();
  if (taxRateId) attributes.taxRateId = taxRateId;
  // InvoiceEditInput fields from the 2025-01-20 introspection. Settings only.
  if (typeof input.allowCardPayments === 'boolean') {
    attributes.allowClientHubCreditCardPayments = input.allowCardPayments;
  }
  if (typeof input.allowAchPayments === 'boolean') {
    attributes.allowClientHubAchPayments = input.allowAchPayments;
  }
  if (typeof input.allowPartialPayments === 'boolean') {
    attributes.allowPartialPayments = input.allowPartialPayments;
  }
  if (!Object.keys(attributes).length) {
    throw new Error(
      'edit_invoice needs taxRateId, allowCardPayments, allowAchPayments, or allowPartialPayments.'
    );
  }
  return attributes;
}

export function buildUnsentInvoiceCreateInput(input: {
  clientId: string;
  jobId: string;
  subject: string;
  lineItems: InvoiceLineDraft[];
  taxRateId?: string | null;
  taxCalculationMethod?: InvoiceTaxMethod;
  dueDate?: string | null;
  invoiceNet?: number | null;
}): Record<string, unknown> {
  if (!input.lineItems.length) {
    throw new Error('lineItems is required to create a Jobber invoice draft');
  }
  const method = input.taxCalculationMethod || 'EXCLUSIVE';
  if (!INVOICE_TAX_METHODS.includes(method)) {
    throw new Error('taxCalculationMethod must be EXCLUSIVE or INCLUSIVE');
  }
  const dueDetails: Record<string, unknown> = {};
  if (input.dueDate?.trim()) dueDetails.dueDate = input.dueDate.trim();
  if (input.invoiceNet != null) dueDetails.invoiceNet = input.invoiceNet;
  const attributes: Record<string, unknown> = {
    clientId: input.clientId,
    jobId: input.jobId,
    subject: input.subject,
    dueDetails,
    tax: { taxCalculationMethod: method },
    lineItems: input.lineItems.map(linePayload),
  };
  if (input.taxRateId?.trim()) attributes.taxRateId = input.taxRateId.trim();
  // Unissued draft. Never set issuedDate, and never call invoiceMarkAsSent.
  if ('issuedDate' in attributes) {
    throw new Error('Invoice drafts must not set issuedDate');
  }
  return attributes;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function parseInvoiceLineDrafts(value: unknown, field: string): InvoiceLineDraft[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error(`${field} must be a non-empty array`);
  }
  return value.map((item, index) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const quantity = asFiniteNumber(row.quantity);
    const unitPrice = asFiniteNumber(row.unitPrice);
    if (!name) throw new Error(`${field}[${index}].name is required`);
    if (quantity == null || quantity <= 0) {
      throw new Error(`${field}[${index}].quantity must be a positive number`);
    }
    if (unitPrice == null) throw new Error(`${field}[${index}].unitPrice must be a number`);
    return {
      name,
      description: typeof row.description === 'string' ? row.description : undefined,
      quantity,
      unitPrice,
      taxable: row.taxable === false ? false : true,
    };
  });
}

export function parseInvoiceLineUpdates(value: unknown): InvoiceLineUpdate[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('updateLineItems must be a non-empty array');
  }
  return value.map((item, index) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const lineItemId = typeof row.lineItemId === 'string' ? row.lineItemId.trim() : '';
    if (!lineItemId) throw new Error(`updateLineItems[${index}].lineItemId is required`);
    const update: InvoiceLineUpdate = { lineItemId };
    if (typeof row.name === 'string') {
      const name = row.name.trim();
      if (!name) throw new Error(`updateLineItems[${index}].name cannot be empty`);
      update.name = name;
    }
    if (typeof row.description === 'string') update.description = row.description;
    if ('quantity' in row && row.quantity != null && row.quantity !== '') {
      const quantity = asFiniteNumber(row.quantity);
      if (quantity == null || quantity <= 0) {
        throw new Error(`updateLineItems[${index}].quantity must be a positive number`);
      }
      update.quantity = quantity;
    }
    if ('unitPrice' in row && row.unitPrice != null && row.unitPrice !== '') {
      const unitPrice = asFiniteNumber(row.unitPrice);
      if (unitPrice == null) throw new Error(`updateLineItems[${index}].unitPrice must be a number`);
      update.unitPrice = unitPrice;
    }
    if ('taxable' in row && row.taxable != null && row.taxable !== '') {
      if (typeof row.taxable !== 'boolean') {
        throw new Error(`updateLineItems[${index}].taxable must be a boolean`);
      }
      update.taxable = row.taxable;
    }
    const changes = Object.keys(update).filter((key) => key !== 'lineItemId');
    if (!changes.length) {
      throw new Error(`updateLineItems[${index}] needs name, description, quantity, unitPrice, or taxable`);
    }
    return update;
  });
}

export function parseRemoveLineItemIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('removeLineItemIds must be a non-empty array');
  }
  return value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`removeLineItemIds[${index}] must be a line item id`);
    }
    return item.trim();
  });
}

export function normalizeInvoiceTaxMethod(value: string | null | undefined): InvoiceTaxMethod {
  const normalized = (value || 'EXCLUSIVE').trim().toUpperCase();
  if (normalized === 'INCLUSIVE' || normalized === 'EXCLUSIVE') return normalized;
  throw new Error('taxCalculationMethod must be EXCLUSIVE or INCLUSIVE');
}

function userErrorText(payload: { userErrors?: Array<{ message?: string }> } | null | undefined): string {
  return jobberUserErrors(payload).join('; ');
}

export async function editInvoice(
  input: {
    invoiceId?: string | null;
    invoiceNumber?: string | null;
    addLineItems?: InvoiceLineDraft[];
    updateLineItems?: InvoiceLineUpdate[];
    removeLineItemIds?: string[];
    taxRateId?: string | null;
    allowCardPayments?: boolean | null;
    allowAchPayments?: boolean | null;
    allowPartialPayments?: boolean | null;
  },
  deps?: JobberDeps
): Promise<JobberInvoiceSummary> {
  const attributes = buildInvoiceEditInput(input);
  const existing = await getInvoice(
    {
      invoiceId: input.invoiceId,
      invoiceNumber: input.invoiceNumber,
      includeLineItems: true,
    },
    deps
  );
  const edited = await graphql(INVOICE_EDIT, { invoiceId: existing.id, input: attributes }, deps);
  assertNoJobberErrors(edited, 'invoiceEdit');
  const payload = edited.data?.invoiceEdit;
  const message = userErrorText(payload);
  if (message) throw new Error(message);
  if (!payload?.invoice?.id) throw new Error('Jobber invoiceEdit returned no invoice');
  return getInvoice({ invoiceId: existing.id, includeLineItems: true }, deps);
}

async function loadJobLineItems(jobId: string, deps?: JobberDeps): Promise<InvoiceLineDraft[]> {
  let result = await graphql(JOB_LINES, { id: jobId }, deps);
  if (result.errors?.length && /taxable/i.test(result.errors.map((error) => error.message || '').join(' '))) {
    result = await graphql(JOB_LINES_NO_TAXABLE, { id: jobId }, deps);
  }
  assertNoJobberErrors(result, 'job line items');
  const nodes = (result.data?.job?.lineItems?.nodes || []) as JobLineNode[];
  const lines: InvoiceLineDraft[] = [];
  for (const node of nodes) {
    const name = node?.name?.trim() || '';
    const quantity = asFiniteNumber(node?.quantity);
    const unitPrice = asFiniteNumber(node?.unitPrice);
    if (!name || quantity == null || quantity <= 0 || unitPrice == null) continue;
    lines.push({
      name,
      description: node.description?.trim() || undefined,
      quantity,
      unitPrice,
      taxable: node.taxable === false ? false : true,
    });
  }
  return lines;
}

export async function createInvoiceDraftFromJob(
  input: {
    jobId?: string | null;
    jobNumber?: string | null;
    subject?: string | null;
    lineItems?: InvoiceLineDraft[];
    taxRateId?: string | null;
    taxCalculationMethod?: InvoiceTaxMethod;
    dueDate?: string | null;
    invoiceNet?: number | null;
  },
  deps?: JobberDeps
): Promise<{ invoice: JobberInvoiceSummary; invoiceStatus: string | null }> {
  const job = await getJob({ jobId: input.jobId, jobNumber: input.jobNumber }, deps);
  const clientId = job.client?.id?.trim();
  if (!clientId) throw new Error(`Job ${job.jobNumber ?? job.id} has no client id`);
  const lineItems = input.lineItems?.length ? input.lineItems : await loadJobLineItems(job.id, deps);
  if (!lineItems.length) {
    throw new Error('Pass lineItems. This job has no line items the API can copy onto an invoice.');
  }
  const subject =
    input.subject?.trim() ||
    (job.title?.trim() ? job.title.trim() : '') ||
    `Invoice for job ${job.jobNumber ?? job.id}`;
  const attributes = buildUnsentInvoiceCreateInput({
    clientId,
    jobId: job.id,
    subject,
    lineItems,
    taxRateId: input.taxRateId,
    taxCalculationMethod: input.taxCalculationMethod,
    dueDate: input.dueDate,
    invoiceNet: input.invoiceNet,
  });
  const created = await graphql(INVOICE_CREATE, { input: attributes }, deps);
  assertNoJobberErrors(created, 'invoiceCreate');
  const payload = created.data?.invoiceCreate;
  const message = userErrorText(payload);
  if (message) throw new Error(message);
  const invoiceId = payload?.invoice?.id as string | undefined;
  if (!invoiceId) throw new Error('Jobber invoiceCreate returned no invoice');
  const invoice = await getInvoice({ invoiceId, includeLineItems: true }, deps);
  return { invoice, invoiceStatus: invoice.invoiceStatus };
}
