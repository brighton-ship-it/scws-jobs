/**
 * Jobber reads + draft-only quote edits for the MCP gateway.
 * Reuses the shared GraphQL client and unsent-quote helpers.
 *
 * Mutations that send, approve, or convert a quote must never live here.
 * deleteUnsentQuoteDraft may call quoteDelete, or quoteArchive only when
 * quoteDelete is absent from the schema, and only after the quote is an
 * unsent draft. quoteDeleteLineItems removes line items on an unsent draft
 * only; it does not delete the quote. setQuoteSalesperson is the exception
 * that may call quoteEdit on a quote in any status, and only with salespersonId.
 */

import { mentionsGpFlag } from './gross-profit.ts';
import {
  assertNoJobberErrors,
  jobberGraphql,
  jobberUserErrors,
} from './client.ts';
import { listUsers } from './mcp-client-writes.ts';
import { looksLikeJobberEncodedId } from './mcp-jobs.ts';
import { assertNoClientNotification, assertWriteDoesNotDeliver } from './mcp-notify.ts';
import { searchJobberProducts, type ProductSearchResult } from './products.ts';
import {
  assertQuoteSalespersonApplied,
  assertUnsentQuoteAttributes,
  jobberSalespersonId,
  searchClients,
  toJobberLineItems,
  type JobberAddress,
  type JobberClient,
  type JobberDeps,
  type JobberQuoteSummary,
} from './quotes.ts';
import type { QuoteLineDraft } from './shop-book.ts';

export const MCP_QUOTE_PAGE_SIZE = 15;
export const MCP_QUOTE_MAX_PAGE_SIZE = 25;

const CLIENT_FIELDS = `
  id
  name
  firstName
  lastName
  companyName
  emails { address }
  phones { number }
  properties {
    id
    address { street1 street2 city province postalCode }
  }
  quotes(first: 25) {
    nodes {
      id
      quoteNumber
      title
      quoteStatus
      sentAt
      jobberWebUri
      property { id }
      salesperson { id name { full } }
    }
  }
`;

const QUOTE_FIELDS = `
  id
  quoteNumber
  title
  quoteStatus
  sentAt
  createdAt
  jobberWebUri
  salesperson { id name { full } }
  amounts { subtotal total }
  client {
    id
    name
    firstName
    lastName
    companyName
    emails { address }
    phones { number }
  }
  property {
    id
    address { street1 street2 city province postalCode }
  }
  lineItems(first: 80) {
    nodes { id name description quantity unitPrice taxable optional recommended }
  }
`;

const QUOTE_FIELDS_WITH_MESSAGE = `
  ${QUOTE_FIELDS}
  message
`;

const CLIENT_BY_ID = `
  query McpClientById($id: EncodedId!) {
    client(id: $id) { ${CLIENT_FIELDS} }
  }
`;

const QUOTE_BY_ID = `
  query McpQuoteById($id: EncodedId!) {
    quote(id: $id) { ${QUOTE_FIELDS_WITH_MESSAGE} }
  }
`;

const QUOTE_BY_ID_NO_MESSAGE = `
  query McpQuoteByIdNoMessage($id: EncodedId!) {
    quote(id: $id) { ${QUOTE_FIELDS} }
  }
`;

const QUOTES_SEARCH = `
  query McpQuotesSearch($searchTerm: String!, $first: Int!) {
    quotes(first: $first, searchTerm: $searchTerm) {
      nodes { ${QUOTE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const QUOTES_FILTER = `
  query McpQuotesFilter($first: Int!, $filter: QuoteFilterAttributes) {
    quotes(first: $first, filter: $filter) {
      nodes { ${QUOTE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** Prefer top-level quoteId + attributes (same 2025-04-16 shape as quoteCreate). */
const QUOTE_EDIT = `
  mutation McpQuoteEdit($quoteId: EncodedId!, $attributes: QuoteEditAttributes!) {
    quoteEdit(quoteId: $quoteId, attributes: $attributes) {
      quote { id quoteNumber title quoteStatus sentAt jobberWebUri salesperson { id name { full } } }
      userErrors { message path }
    }
  }
`;

const QUOTE_EDIT_ALT = `
  mutation McpQuoteEditAlt($quoteId: EncodedId!, $attributes: QuoteEditAttributes!) {
    quoteEdit(input: { quoteId: $quoteId, attributes: $attributes }) {
      quote { id quoteNumber title quoteStatus sentAt jobberWebUri salesperson { id name { full } } }
      userErrors { message path }
    }
  }
`;

const QUOTE_EDIT_ALT2 = `
  mutation McpQuoteEditAlt2($quoteId: EncodedId!, $attributes: QuoteEditAttributes!) {
    quoteEdit(quoteId: $quoteId, input: { attributes: $attributes }) {
      quote { id quoteNumber title quoteStatus sentAt jobberWebUri salesperson { id name { full } } }
      userErrors { message path }
    }
  }
`;

const QUOTE_LINE_ITEMS = `
  mutation McpQuoteCreateLineItems($quoteId: EncodedId!, $lineItems: [QuoteCreateLineItemAttributes!]!) {
    quoteCreateLineItems(quoteId: $quoteId, lineItems: $lineItems) {
      createdLineItems { id name quantity }
      userErrors { message path }
    }
  }
`;

/**
 * QuoteEditLineItemAttributes requires lineItemId and has no
 * saveToProductsAndServices (that field is only on create). quoteEdit does
 * not take line items.
 */
const QUOTE_EDIT_LINE_ITEMS = `
  mutation McpQuoteEditLineItems($quoteId: EncodedId!, $lineItems: [QuoteEditLineItemAttributes!]!) {
    quoteEditLineItems(quoteId: $quoteId, lineItems: $lineItems) {
      modifiedLineItems { id name }
      userErrors { message path }
    }
  }
`;

const QUOTE_DELETE_LINE_ITEMS = `
  mutation McpQuoteDeleteLineItems($quoteId: EncodedId!, $lineItemIds: [EncodedId!]!) {
    quoteDeleteLineItems(quoteId: $quoteId, lineItemIds: $lineItemIds) {
      deletedLineItems { id name }
      userErrors { message path }
    }
  }
`;

/**
 * quoteDelete is not on the public 2025-01-20 schema. These documents are
 * tried anyway: a live API may have added the field. Argument shape follows
 * other deletes (quoteId), then an input wrapper. Payload selection drops
 * deletedQuote when that field is unknown. Nothing here sets sentAt or
 * transitionQuoteTo.
 */
const QUOTE_DELETE = `
  mutation McpQuoteDelete($quoteId: EncodedId!) {
    quoteDelete(quoteId: $quoteId) {
      deletedQuote { id }
      userErrors { message path }
    }
  }
`;

const QUOTE_DELETE_BARE = `
  mutation McpQuoteDeleteBare($quoteId: EncodedId!) {
    quoteDelete(quoteId: $quoteId) {
      userErrors { message path }
    }
  }
`;

const QUOTE_DELETE_INPUT = `
  mutation McpQuoteDeleteInput($quoteId: EncodedId!) {
    quoteDelete(input: { quoteId: $quoteId }) {
      deletedQuote { id }
      userErrors { message path }
    }
  }
`;

const QUOTE_DELETE_INPUT_BARE = `
  mutation McpQuoteDeleteInputBare($quoteId: EncodedId!) {
    quoteDelete(input: { quoteId: $quoteId }) {
      userErrors { message path }
    }
  }
`;

/** Same argument pattern as requestArchive. Used only when quoteDelete is absent. */
const QUOTE_ARCHIVE = `
  mutation McpQuoteArchive($quoteId: EncodedId!) {
    quoteArchive(quoteId: $quoteId) {
      quote { id quoteStatus }
      userErrors { message path }
    }
  }
`;

const QUOTE_ARCHIVE_BARE = `
  mutation McpQuoteArchiveBare($quoteId: EncodedId!) {
    quoteArchive(quoteId: $quoteId) {
      userErrors { message path }
    }
  }
`;

const QUOTE_ARCHIVE_INPUT = `
  mutation McpQuoteArchiveInput($quoteId: EncodedId!) {
    quoteArchive(input: { quoteId: $quoteId }) {
      quote { id quoteStatus }
      userErrors { message path }
    }
  }
`;

const QUOTE_ARCHIVE_INPUT_BARE = `
  mutation McpQuoteArchiveInputBare($quoteId: EncodedId!) {
    quoteArchive(input: { quoteId: $quoteId }) {
      userErrors { message path }
    }
  }
`;

export type JobberQuoteLine = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  taxable?: boolean | null;
  optional?: boolean | null;
  recommended?: boolean | null;
};

/** Partial edit of one existing quote line. Omitted fields are left unchanged. */
export type QuoteLineItemEdit = {
  lineItemId: string;
  name?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  taxable?: boolean;
  optional?: boolean;
  recommended?: boolean;
};

export type JobberQuoteDetail = JobberQuoteSummary & {
  createdAt?: string | null;
  message?: string | null;
  amounts?: { subtotal?: number | null; total?: number | null } | null;
  client?: {
    id?: string | null;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    emails?: Array<{ address?: string | null } | null> | null;
    phones?: Array<{ number?: string | null } | null> | null;
  } | null;
  property?: { id?: string | null; address?: JobberAddress | null } | null;
  lineItems?: { nodes?: Array<JobberQuoteLine | null> | null } | null;
};

function graphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

function pageSize(first?: number): number {
  const n = first ?? MCP_QUOTE_PAGE_SIZE;
  if (!Number.isFinite(n) || n < 1) return MCP_QUOTE_PAGE_SIZE;
  return Math.min(Math.floor(n), MCP_QUOTE_MAX_PAGE_SIZE);
}

export function normalizeMcpQuoteStatus(status: string | null | undefined): string {
  return (status || 'draft').trim().toLowerCase().replace(/-/g, '_');
}

export function isDraftUnsentQuote(quote: Pick<JobberQuoteDetail, 'quoteStatus' | 'sentAt'>): boolean {
  if (quote.sentAt) return false;
  const status = normalizeMcpQuoteStatus(quote.quoteStatus);
  return status === 'draft' || status === '';
}

export function assertQuoteIsDraftUnsent(quote: JobberQuoteDetail): void {
  if (!isDraftUnsentQuote(quote)) {
    throw new Error(
      `Refusing to edit Jobber quote ${quote.quoteNumber ?? quote.id}: only unsent drafts can be updated (status=${quote.quoteStatus || 'unknown'}, sentAt=${quote.sentAt || 'null'})`
    );
  }
}

export function assertUnsentDraftDeletable(quote: JobberQuoteDetail): void {
  if (!isDraftUnsentQuote(quote)) {
    throw new Error(
      `Refusing to delete Jobber quote ${quote.quoteNumber ?? quote.id}: only an unsent draft can be deleted (status=${quote.quoteStatus || 'unknown'}, sentAt=${quote.sentAt || 'null'}). Sent, approved, converted, and archived quotes are left untouched.`
    );
  }
}

export function quoteLineIds(quote: JobberQuoteDetail): string[] {
  return (quote.lineItems?.nodes || [])
    .map((line) => (line?.id ? String(line.id) : ''))
    .filter(Boolean);
}

/**
 * Draft line edits must name lines that are on the quote. Deleting every
 * line is refused: Jobber rejects a blank quote ("Quote can't be blank").
 * Adds in the same call count toward the lines that would remain, and the
 * caller creates those lines before deleting.
 */
export function assertDraftQuoteLineEdits(
  quote: JobberQuoteDetail,
  input: { updates?: QuoteLineItemEdit[]; removes?: string[]; addCount?: number }
): void {
  const ids = new Set(quoteLineIds(quote));
  const label = quote.quoteNumber ?? quote.id;
  const updates = input.updates || [];
  const removes = input.removes || [];
  const removeSet = new Set(removes);
  for (const id of removes) {
    if (!ids.has(id)) throw new Error(`Line item ${id} is not on quote ${label}`);
  }
  for (const line of updates) {
    if (!ids.has(line.lineItemId)) throw new Error(`Line item ${line.lineItemId} is not on quote ${label}`);
    if (removeSet.has(line.lineItemId)) {
      throw new Error(`Line item ${line.lineItemId} cannot be edited and deleted in the same update`);
    }
  }
  const remaining = ids.size - removes.length + (input.addCount || 0);
  if (ids.size > 0 && removes.length > 0 && remaining < 1) {
    throw new Error(
      `Refusing to delete every line item on quote ${label}. Jobber rejects a blank quote. Add a replacement line in the same update, or leave at least one line.`
    );
  }
}

/** QuoteEditLineItemAttributes. Never sends saveToProductsAndServices. */
export function toJobberEditLineItems(lines: QuoteLineItemEdit[]): Array<Record<string, unknown>> {
  return lines.map((line) => {
    const item: Record<string, unknown> = { lineItemId: line.lineItemId };
    if (line.name != null) item.name = line.name;
    if (line.description != null) item.description = line.description;
    if (line.quantity != null) item.quantity = line.quantity;
    if (line.unitPrice != null) item.unitPrice = line.unitPrice;
    if (typeof line.taxable === 'boolean') item.taxable = line.taxable;
    if (typeof line.optional === 'boolean') item.optional = line.optional;
    if (typeof line.recommended === 'boolean') item.recommended = line.recommended;
    return item;
  });
}

const QUOTE_LINE_EDIT_FIELDS = new Set([
  'lineItemId',
  'name',
  'description',
  'quantity',
  'unitPrice',
  'taxable',
  'optional',
  'recommended',
]);

export function parseQuoteLineEdits(value: unknown): QuoteLineItemEdit[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('updateLineItems must be a non-empty array');
  }
  return value.map((item, index) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    for (const key of Object.keys(row)) {
      if (!QUOTE_LINE_EDIT_FIELDS.has(key)) {
        throw new Error(`updateLineItems[${index}].${key} cannot be changed on a quote line`);
      }
    }
    const lineItemId = typeof row.lineItemId === 'string' ? row.lineItemId.trim() : '';
    if (!lineItemId) throw new Error(`updateLineItems[${index}].lineItemId is required`);
    const edit: QuoteLineItemEdit = { lineItemId };
    if ('name' in row) {
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (!name) throw new Error(`updateLineItems[${index}].name must be a non-empty string`);
      edit.name = name;
    }
    if ('description' in row) {
      if (typeof row.description !== 'string') {
        throw new Error(`updateLineItems[${index}].description must be a string`);
      }
      edit.description = row.description;
    }
    if ('quantity' in row) {
      const quantity = Number(row.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`updateLineItems[${index}].quantity must be a positive number`);
      }
      edit.quantity = quantity;
    }
    if ('unitPrice' in row) {
      const unitPrice = Number(row.unitPrice);
      if (!Number.isFinite(unitPrice)) throw new Error(`updateLineItems[${index}].unitPrice must be a number`);
      edit.unitPrice = unitPrice;
    }
    for (const key of ['taxable', 'optional', 'recommended'] as const) {
      if (!(key in row) || row[key] == null || row[key] === '') continue;
      const flag = row[key];
      if (typeof flag === 'boolean') {
        edit[key] = flag;
        continue;
      }
      if (typeof flag === 'string' && (flag.trim().toLowerCase() === 'true' || flag.trim().toLowerCase() === 'false')) {
        edit[key] = flag.trim().toLowerCase() === 'true';
        continue;
      }
      throw new Error(`updateLineItems[${index}].${key} must be a boolean`);
    }
    if (edit.recommended === true && edit.optional === false) {
      throw new Error(`updateLineItems[${index}] recommended lines must stay optional`);
    }
    if (Object.keys(edit).length === 1) {
      throw new Error(
        `updateLineItems[${index}] must change name, description, quantity, unitPrice, taxable, or optional`
      );
    }
    return edit;
  });
}

export function buildDraftQuoteEditAttributes(input: {
  title?: string | null;
  message?: string | null;
  taxRateId?: string | null;
  salespersonId?: string | null;
}): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  if (input.title?.trim()) attributes.title = input.title.trim();
  if (input.message != null) attributes.message = input.message;
  if (input.taxRateId?.trim()) attributes.taxRateId = input.taxRateId.trim();
  if (input.salespersonId?.trim()) attributes.salespersonId = input.salespersonId.trim();
  assertUnsentQuoteAttributes(attributes);
  if ('transitionQuoteTo' in attributes || 'sentAt' in attributes) {
    throw new Error('Draft edit must not send the quote');
  }
  if (typeof attributes.message === 'string' && mentionsGpFlag(attributes.message)) {
    throw new Error('Customer-facing quote message must not contain GP FLAG math');
  }
  if (typeof attributes.title === 'string' && mentionsGpFlag(attributes.title)) {
    throw new Error('Quote title must not contain GP FLAG math');
  }
  return attributes;
}

export async function getClientById(id: string, deps?: JobberDeps): Promise<JobberClient> {
  const clientId = id.trim();
  if (!clientId) throw new Error('client id is required');
  const result = await graphql(CLIENT_BY_ID, { id: clientId }, deps);
  assertNoJobberErrors(result, 'client');
  const client = result.data?.client as JobberClient | undefined;
  if (!client?.id) throw new Error(`Jobber client ${clientId} not found`);
  return client;
}

export async function getQuoteById(id: string, deps?: JobberDeps): Promise<JobberQuoteDetail> {
  const quoteId = id.trim();
  if (!quoteId) throw new Error('quote id is required');
  let result = await graphql(QUOTE_BY_ID, { id: quoteId }, deps);
  if (result.errors?.length && /message/i.test(result.errors.map((error) => error.message || '').join(' '))) {
    result = await graphql(QUOTE_BY_ID_NO_MESSAGE, { id: quoteId }, deps);
  }
  assertNoJobberErrors(result, 'quote');
  const quote = result.data?.quote as JobberQuoteDetail | undefined;
  if (!quote?.id) throw new Error(`Jobber quote ${quoteId} not found`);
  return quote;
}

function quoteMatchesNeedle(quote: JobberQuoteDetail, needle: string): boolean {
  const hay = [
    quote.quoteNumber,
    quote.title,
    quote.client?.name,
    quote.client?.companyName,
    quote.client?.firstName,
    quote.client?.lastName,
    quote.property?.address?.street1,
    quote.property?.address?.city,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

export async function searchQuotes(
  input: { searchTerm?: string | null; status?: string | null; first?: number },
  deps?: JobberDeps
): Promise<JobberQuoteDetail[]> {
  const first = pageSize(input.first);
  const searchTerm = input.searchTerm?.trim() || '';
  const status = input.status?.trim();
  const found = new Map<string, JobberQuoteDetail>();

  const add = (nodes: Array<JobberQuoteDetail | null | undefined>) => {
    for (const node of nodes) {
      if (node?.id) found.set(node.id, node);
    }
  };

  if (searchTerm) {
    try {
      const result = await graphql(QUOTES_SEARCH, { searchTerm, first }, deps);
      if (!result.errors?.length) {
        add((result.data?.quotes?.nodes || []) as JobberQuoteDetail[]);
      }
    } catch {
      // Fall through to client + filter search.
    }

    const clients = await searchClients(searchTerm, deps);
    for (const client of clients) {
      for (const quote of client.quotes?.nodes || []) {
        if (quote?.id) {
          found.set(quote.id, {
            ...quote,
            client: {
              id: client.id,
              name: client.name,
              firstName: client.firstName,
              lastName: client.lastName,
              companyName: client.companyName,
              emails: client.emails,
              phones: client.phones,
            },
          });
        }
      }
    }
  } else {
    const filter = status && status !== 'all' ? { status } : null;
    const variables: Record<string, unknown> = { first };
    if (filter) variables.filter = filter;
    const result = await graphql(QUOTES_FILTER, variables, deps);
    if (result.errors?.length && variables.filter) {
      const retry = await graphql(QUOTES_FILTER, { first }, deps);
      assertNoJobberErrors(retry, 'quotes');
      add((retry.data?.quotes?.nodes || []) as JobberQuoteDetail[]);
    } else {
      assertNoJobberErrors(result, 'quotes');
      add((result.data?.quotes?.nodes || []) as JobberQuoteDetail[]);
    }
  }

  let quotes = [...found.values()];
  if (searchTerm) {
    const needle = searchTerm.toLowerCase();
    const narrowed = quotes.filter((quote) => quoteMatchesNeedle(quote, needle));
    if (narrowed.length) quotes = narrowed;
  }
  if (status && status !== 'all') {
    const wanted = normalizeMcpQuoteStatus(status);
    quotes = quotes.filter((quote) => normalizeMcpQuoteStatus(quote.quoteStatus) === wanted);
  }
  return quotes.slice(0, first);
}

export async function searchProducts(
  searchTerm: string,
  deps?: JobberDeps
): Promise<ProductSearchResult> {
  return searchJobberProducts(searchTerm, deps, { includeInternalCost: false });
}

/**
 * quoteEdit(quoteId, attributes: QuoteEditAttributes) is the only mutation that
 * writes Quote.salesperson. Public schema 2025-01-20 (hightreequency/jobberschema)
 * puts salespersonId on QuoteEditAttributes and does not take a status argument.
 * QuoteStatusTypeEnum is draft, awaiting_response, archived, approved, converted,
 * changes_requested. The schema does not limit this field to drafts.
 * Attributes here are exactly { salespersonId }. No title, message, lines, tax,
 * clientViewOptions, transitionQuoteTo, or sentAt.
 */
export function buildSalespersonOnlyEditAttributes(salespersonId: string): { salespersonId: string } {
  const id = salespersonId.trim();
  if (!id) throw new Error('salespersonId is required');
  const attributes = { salespersonId: id };
  assertUnsentQuoteAttributes(attributes);
  const keys = Object.keys(attributes);
  if (keys.length !== 1 || keys[0] !== 'salespersonId') {
    throw new Error('Salesperson edit may set only salespersonId');
  }
  return attributes;
}

function quoteLineSignature(quote: JobberQuoteDetail): string {
  return JSON.stringify(
    (quote.lineItems?.nodes || []).map((line) =>
      line
        ? {
            id: line.id ?? null,
            name: line.name ?? null,
            description: line.description ?? null,
            quantity: line.quantity ?? null,
            unitPrice: line.unitPrice ?? null,
            optional: line.optional ?? null,
            recommended: line.recommended ?? null,
          }
        : null
    )
  );
}

export function assertQuoteUnchangedExceptSalesperson(
  before: JobberQuoteDetail,
  after: JobberQuoteDetail
): void {
  const changes: string[] = [];
  if (normalizeMcpQuoteStatus(before.quoteStatus) !== normalizeMcpQuoteStatus(after.quoteStatus)) {
    changes.push(`status ${before.quoteStatus || 'unknown'} -> ${after.quoteStatus || 'unknown'}`);
  }
  if ((before.sentAt || null) !== (after.sentAt || null)) changes.push('sentAt');
  if ((before.title || '') !== (after.title || '')) changes.push('title');
  if ((before.message ?? '') !== (after.message ?? '')) changes.push('message');
  const amounts = (quote: JobberQuoteDetail) =>
    `${quote.amounts?.subtotal ?? ''}|${quote.amounts?.total ?? ''}`;
  if (amounts(before) !== amounts(after)) changes.push('amounts');
  if (quoteLineSignature(before) !== quoteLineSignature(after)) changes.push('line items');
  if (!changes.length) return;
  throw new Error(
    `Jobber quoteEdit changed more than the salesperson on quote ${after.quoteNumber ?? after.id}: ${changes.join(', ')}. The request sent only salespersonId and did not send or notify the customer.`
  );
}

async function requireActiveSalesperson(salespersonId: string, deps?: JobberDeps): Promise<void> {
  const listed = await listUsers(null, deps);
  const user = listed.users.find((entry) => entry.id === salespersonId);
  if (!user) {
    throw new Error(
      listed.truncated
        ? `salespersonId ${salespersonId} was not found in list_users, and the user list was truncated. Pass an id from list_users.`
        : `salespersonId ${salespersonId} is not a Jobber user. Call list_users and pass an active user's id.`
    );
  }
  if ((user.status || '').toUpperCase() !== 'ACTIVATED') {
    const label = user.name || user.email || salespersonId;
    throw new Error(
      `salespersonId ${salespersonId} (${label}) is not an active Jobber user (status=${user.status || 'unknown'}). list_users must show ACTIVATED.`
    );
  }
}

export async function setQuoteSalesperson(
  input: { quoteId: string; salespersonId: string },
  deps?: JobberDeps
): Promise<{ quote: JobberQuoteDetail; changed: boolean }> {
  const quoteId = input.quoteId.trim();
  const salespersonId = input.salespersonId.trim();
  if (!quoteId) throw new Error('quoteId is required');
  if (!salespersonId) throw new Error('salespersonId is required');

  await requireActiveSalesperson(salespersonId, deps);
  const existing = await getQuoteById(quoteId, deps);
  if (jobberSalespersonId(existing.salesperson) === salespersonId) {
    return { quote: existing, changed: false };
  }

  const attributes = buildSalespersonOnlyEditAttributes(salespersonId);
  for (const document of [QUOTE_EDIT, QUOTE_EDIT_ALT, QUOTE_EDIT_ALT2]) {
    assertWriteDoesNotDeliver(document);
  }
  assertNoClientNotification(attributes);

  let edited = await graphql(QUOTE_EDIT, { quoteId, attributes }, deps);
  if (edited.errors?.length && /argument|QuoteEdit/i.test(edited.errors[0]?.message || '')) {
    edited = await graphql(QUOTE_EDIT_ALT, { quoteId, attributes }, deps);
  }
  if (edited.errors?.length && /argument|QuoteEdit/i.test(edited.errors[0]?.message || '')) {
    edited = await graphql(QUOTE_EDIT_ALT2, { quoteId, attributes }, deps);
  }
  assertNoJobberErrors(edited, 'quoteEdit');
  const editErrors = jobberUserErrors(edited.data?.quoteEdit);
  if (editErrors.length) {
    throw new Error(
      `Jobber quoteEdit refused to set the salesperson on quote ${existing.quoteNumber ?? quoteId} (status=${existing.quoteStatus || 'unknown'}): ${editErrors.join('; ')}. Only salespersonId was sent. The quote was not sent or resent.`
    );
  }

  const updated = await getQuoteById(quoteId, deps);
  assertQuoteUnchangedExceptSalesperson(existing, updated);
  assertQuoteSalespersonApplied(updated, salespersonId, 'quoteEdit');
  return { quote: updated, changed: true };
}

export async function updateUnsentQuoteDraft(
  input: {
    quoteId: string;
    title?: string | null;
    message?: string | null;
    taxRateId?: string | null;
    salespersonId?: string | null;
    addLineItems?: QuoteLineDraft[];
    updateLineItems?: QuoteLineItemEdit[];
    removeLineItemIds?: string[];
  },
  deps?: JobberDeps
): Promise<JobberQuoteDetail> {
  const quoteId = input.quoteId.trim();
  if (!quoteId) throw new Error('quoteId is required');

  const existing = await getQuoteById(quoteId, deps);
  assertQuoteIsDraftUnsent(existing);

  const updates = input.updateLineItems?.length ? input.updateLineItems : [];
  const removes = input.removeLineItemIds?.length ? [...new Set(input.removeLineItemIds)] : [];
  if (updates.length || removes.length) {
    assertDraftQuoteLineEdits(existing, {
      updates,
      removes,
      addCount: input.addLineItems?.length || 0,
    });
  }

  const attributes = buildDraftQuoteEditAttributes(input);
  if (Object.keys(attributes).length) {
    for (const document of [QUOTE_EDIT, QUOTE_EDIT_ALT, QUOTE_EDIT_ALT2]) {
      assertWriteDoesNotDeliver(document);
    }
    assertNoClientNotification(attributes);
    let edited = await graphql(QUOTE_EDIT, { quoteId, attributes }, deps);
    if (edited.errors?.length && /argument|QuoteEdit/i.test(edited.errors[0]?.message || '')) {
      edited = await graphql(QUOTE_EDIT_ALT, { quoteId, attributes }, deps);
    }
    if (edited.errors?.length && /argument|QuoteEdit/i.test(edited.errors[0]?.message || '')) {
      edited = await graphql(QUOTE_EDIT_ALT2, { quoteId, attributes }, deps);
    }
    assertNoJobberErrors(edited, 'quoteEdit');
    const payload = edited.data?.quoteEdit;
    const editErrors = jobberUserErrors(payload);
    if (editErrors.length) throw new Error(editErrors.join('; '));
    const quote = payload?.quote as JobberQuoteDetail | undefined;
    if (quote?.sentAt) {
      throw new Error('Jobber returned sentAt on a draft edit — aborting');
    }
  }

  if (input.addLineItems?.length) {
    assertWriteDoesNotDeliver(QUOTE_LINE_ITEMS);
    const lineItems = toJobberLineItems(input.addLineItems);
    const linesResult = await graphql(QUOTE_LINE_ITEMS, { quoteId, lineItems }, deps);
    assertNoJobberErrors(linesResult, 'quoteCreateLineItems');
    const lineErrors = jobberUserErrors(linesResult.data?.quoteCreateLineItems);
    if (lineErrors.length) throw new Error(lineErrors.join('; '));
  }

  if (updates.length) {
    assertWriteDoesNotDeliver(QUOTE_EDIT_LINE_ITEMS);
    const lineItems = toJobberEditLineItems(updates);
    assertNoClientNotification(lineItems);
    const linesResult = await graphql(QUOTE_EDIT_LINE_ITEMS, { quoteId, lineItems }, deps);
    assertNoJobberErrors(linesResult, 'quoteEditLineItems');
    const lineErrors = jobberUserErrors(linesResult.data?.quoteEditLineItems);
    if (lineErrors.length) throw new Error(lineErrors.join('; '));
  }

  if (removes.length) {
    assertWriteDoesNotDeliver(QUOTE_DELETE_LINE_ITEMS);
    const linesResult = await graphql(QUOTE_DELETE_LINE_ITEMS, { quoteId, lineItemIds: removes }, deps);
    assertNoJobberErrors(linesResult, 'quoteDeleteLineItems');
    const lineErrors = jobberUserErrors(linesResult.data?.quoteDeleteLineItems);
    if (lineErrors.length) throw new Error(lineErrors.join('; '));
  }

  const updated = await getQuoteById(quoteId, deps);
  if (input.salespersonId?.trim()) {
    assertQuoteSalespersonApplied(updated, input.salespersonId, 'quoteEdit');
  }
  return updated;
}

export function quoteEditUsedForbiddenFields(body: string): boolean {
  return /transitionQuoteTo/.test(body) || /"sentAt"\s*:/.test(body);
}

export type QuoteRemovalMethod = 'quoteDelete' | 'quoteArchive';

export type DeleteUnsentQuoteDraftResult = {
  method: QuoteRemovalMethod;
  deleted: boolean;
  archived: boolean;
  notified: false;
  sent: false;
  quoteId: string;
  quoteNumber: string | number | null;
  quoteStatus: string | null;
};

export class QuoteMutationUnavailable extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`${field} is not available on this Jobber schema`);
    this.name = 'QuoteMutationUnavailable';
    this.field = field;
  }
}

export function quoteNumbersMatch(
  left: string | number | null | undefined,
  right: string | number | null | undefined
): boolean {
  const a = String(left ?? '').trim().replace(/^#/, '');
  const b = String(right ?? '').trim().replace(/^#/, '');
  if (!a || !b) return false;
  if (a === b) return true;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return String(Number(a)) === String(Number(b));
  return false;
}

export function graphqlFieldMissing(message: string, field: string): boolean {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`cannot query field ['"]${escaped}['"]`, 'i').test(message) ||
    new RegExp(
      `field ['"]${escaped}['"].{0,120}(doesn't exist|does not exist|is undefined|unknown)`,
      'i'
    ).test(message)
  );
}

function graphqlErrorText(result: { errors?: Array<{ message?: string }> | null }): string {
  return (result.errors || []).map((error) => error.message || '').join(' ');
}

function removalArgumentError(message: string): boolean {
  return (
    /unknown argument|has no argument|was not provided|expected type/i.test(message) &&
    !/cannot query field/i.test(message)
  );
}

function assertRemovalDocument(document: string, operation: string): void {
  assertWriteDoesNotDeliver(document);
  if (/transitionQuoteTo|\bquoteSend\b|\bsentAt\b/.test(document)) {
    throw new Error(`${operation} must not send the quote`);
  }
}

async function invokeRemoval(
  document: string,
  quoteId: string,
  operation: string,
  deps?: JobberDeps
) {
  assertRemovalDocument(document, operation);
  return graphql(document, { quoteId }, deps);
}

/**
 * Try one argument shape, then the same shape without a payload field Jobber
 * does not have. Returns the successful result, or throws QuoteMutationUnavailable
 * when the mutation itself is absent. Other GraphQL errors are returned so the
 * caller can try the other argument shape or stop.
 */
async function invokeRemovalShape(
  withSelection: string,
  bare: string,
  selectionField: string,
  mutationField: string,
  quoteId: string,
  deps?: JobberDeps
): Promise<{ ok: true; result: Awaited<ReturnType<typeof graphql>> } | { ok: false; message: string }> {
  let result = await invokeRemoval(withSelection, quoteId, mutationField, deps);
  let message = graphqlErrorText(result);
  if (result.errors?.length && graphqlFieldMissing(message, mutationField)) {
    throw new QuoteMutationUnavailable(mutationField);
  }
  if (result.errors?.length && graphqlFieldMissing(message, selectionField)) {
    result = await invokeRemoval(bare, quoteId, mutationField, deps);
    message = graphqlErrorText(result);
    if (graphqlFieldMissing(message, mutationField)) throw new QuoteMutationUnavailable(mutationField);
  }
  if (result.errors?.length) return { ok: false, message: message || `${mutationField} Jobber GraphQL error` };
  return { ok: true, result };
}

function assertRemovalUserErrors(
  result: Awaited<ReturnType<typeof graphql>>,
  mutationField: QuoteRemovalMethod,
  quote: JobberQuoteDetail
): void {
  const errors = jobberUserErrors(result.data?.[mutationField]);
  if (!errors.length) return;
  throw new Error(
    `Jobber ${mutationField} refused quote ${quote.quoteNumber ?? quote.id}: ${errors.join('; ')}. No other mutation was tried. The quote was not sent.`
  );
}

async function runQuoteRemoval(
  mutationField: QuoteRemovalMethod,
  documents: { withSelection: string; bare: string; selectionField: string }[],
  quote: JobberQuoteDetail,
  deps?: JobberDeps
): Promise<void> {
  const quoteId = String(quote.id);
  let lastMessage = '';
  for (const document of documents) {
    const attempt = await invokeRemovalShape(
      document.withSelection,
      document.bare,
      document.selectionField,
      mutationField,
      quoteId,
      deps
    );
    if (!attempt.ok) {
      lastMessage = attempt.message;
      if (removalArgumentError(attempt.message)) continue;
      throw new Error(attempt.message);
    }
    assertRemovalUserErrors(attempt.result, mutationField, quote);
    return;
  }
  throw new Error(lastMessage || `${mutationField} Jobber GraphQL error`);
}

async function findQuoteByExactNumber(quoteNumber: string, deps?: JobberDeps): Promise<JobberQuoteDetail> {
  const wanted = quoteNumber.trim().replace(/^#/, '');
  if (!wanted) throw new Error('quoteNumber is required');
  const matches = await searchQuotes({ searchTerm: wanted, first: MCP_QUOTE_MAX_PAGE_SIZE }, deps);
  const exact = matches.filter((quote) => quoteNumbersMatch(quote.quoteNumber, wanted));
  if (!exact.length) throw new Error(`Jobber quote number ${wanted} not found`);
  if (exact.length > 1) {
    const ids = exact.map((quote) => quote.id).filter(Boolean).join(', ');
    throw new Error(
      `Jobber quote number ${wanted} matches ${exact.length} quotes (${ids}). Pass quoteId so the wrong draft is not deleted.`
    );
  }
  const id = exact[0]?.id;
  if (!id) throw new Error(`Jobber quote number ${wanted} not found`);
  return getQuoteById(id, deps);
}

export async function resolveQuoteForDraftDelete(
  input: { quoteId?: string | null; quoteNumber?: string | null },
  deps?: JobberDeps
): Promise<JobberQuoteDetail> {
  const quoteId = input.quoteId?.trim() || '';
  const quoteNumber = input.quoteNumber?.trim().replace(/^#/, '') || '';
  if (quoteId && quoteNumber) throw new Error('Pass quoteId or quoteNumber, not both');
  if (!quoteId && !quoteNumber) throw new Error('quoteId or quoteNumber is required');
  if (quoteId) {
    if (!looksLikeJobberEncodedId(quoteId)) {
      throw new Error('quoteId must be an encoded Jobber id. Pass quoteNumber to look up by number.');
    }
    return getQuoteById(quoteId, deps);
  }
  return findQuoteByExactNumber(quoteNumber, deps);
}

function quoteGoneMessage(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found/i.test(message);
}

/**
 * Delete an unsent draft. quoteDelete is tried first. quoteArchive runs only
 * when quoteDelete is not a field on Mutation. A userError from quoteDelete
 * does not fall through to archive, and nothing sets transitionQuoteTo or sentAt.
 */
export async function deleteUnsentQuoteDraft(
  input: { quoteId?: string | null; quoteNumber?: string | null },
  deps?: JobberDeps
): Promise<DeleteUnsentQuoteDraftResult> {
  const existing = await resolveQuoteForDraftDelete(input, deps);
  assertUnsentDraftDeletable(existing);
  const quoteId = String(existing.id);

  let method: QuoteRemovalMethod = 'quoteDelete';
  try {
    await runQuoteRemoval(
      'quoteDelete',
      [
        { withSelection: QUOTE_DELETE, bare: QUOTE_DELETE_BARE, selectionField: 'deletedQuote' },
        { withSelection: QUOTE_DELETE_INPUT, bare: QUOTE_DELETE_INPUT_BARE, selectionField: 'deletedQuote' },
      ],
      existing,
      deps
    );
  } catch (error) {
    if (!(error instanceof QuoteMutationUnavailable) || error.field !== 'quoteDelete') throw error;
    method = 'quoteArchive';
    try {
      await runQuoteRemoval(
        'quoteArchive',
        [
          { withSelection: QUOTE_ARCHIVE, bare: QUOTE_ARCHIVE_BARE, selectionField: 'quote' },
          { withSelection: QUOTE_ARCHIVE_INPUT, bare: QUOTE_ARCHIVE_INPUT_BARE, selectionField: 'quote' },
        ],
        existing,
        deps
      );
    } catch (archiveError) {
      if (archiveError instanceof QuoteMutationUnavailable) {
        throw new Error(
          `Jobber has no quoteDelete or quoteArchive mutation on this schema. Quote ${existing.quoteNumber ?? quoteId} was not changed and was not sent.`
        );
      }
      throw archiveError;
    }
  }

  let after: JobberQuoteDetail | null = null;
  try {
    after = await getQuoteById(quoteId, deps);
  } catch (error) {
    if (!quoteGoneMessage(error)) throw error;
    return {
      method,
      deleted: true,
      archived: false,
      notified: false,
      sent: false,
      quoteId,
      quoteNumber: existing.quoteNumber ?? null,
      quoteStatus: null,
    };
  }

  if (after.sentAt) {
    throw new Error(
      `${method} left sentAt set on quote ${after.quoteNumber ?? quoteId}. The gateway did not send the quote.`
    );
  }
  if (isDraftUnsentQuote(after)) {
    throw new Error(
      `${method} left quote ${after.quoteNumber ?? quoteId} as an unsent draft. It was not sent.`
    );
  }
  const status = normalizeMcpQuoteStatus(after.quoteStatus);
  if (method === 'quoteArchive' && status === 'archived') {
    return {
      method,
      deleted: false,
      archived: true,
      notified: false,
      sent: false,
      quoteId,
      quoteNumber: after.quoteNumber ?? existing.quoteNumber ?? null,
      quoteStatus: after.quoteStatus ?? 'archived',
    };
  }
  throw new Error(
    `${method} left quote ${after.quoteNumber ?? quoteId} in status ${after.quoteStatus || 'unknown'} instead of removing it. It was not sent.`
  );
}
