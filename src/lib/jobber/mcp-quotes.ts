/**
 * Jobber reads + draft-only quote edits for the MCP gateway.
 * Reuses the shared GraphQL client and unsent-quote helpers.
 *
 * Mutations that send, approve, convert, or delete quotes must never live here.
 */

import { mentionsGpFlag } from './gross-profit.ts';
import {
  assertNoJobberErrors,
  jobberGraphql,
  jobberUserErrors,
} from './client.ts';
import {
  assertUnsentQuoteAttributes,
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
    nodes { id name description quantity unitPrice }
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

const PRODUCTS_SEARCH = `
  query McpProductsAndServices($searchTerm: String!) {
    productsAndServices(searchTerm: $searchTerm, first: 15) {
      nodes { id name defaultUnitCost }
    }
  }
`;

const QUOTE_EDIT = `
  mutation McpQuoteEdit($quoteId: EncodedId!, $attributes: QuoteEditAttributes!) {
    quoteEdit(input: { quoteId: $quoteId, attributes: $attributes }) {
      quote { id quoteNumber title quoteStatus sentAt jobberWebUri }
      userErrors { message path }
    }
  }
`;

const QUOTE_EDIT_ALT = `
  mutation McpQuoteEditAlt($quoteId: EncodedId!, $attributes: QuoteEditAttributes!) {
    quoteEdit(quoteId: $quoteId, attributes: $attributes) {
      quote { id quoteNumber title quoteStatus sentAt jobberWebUri }
      userErrors { message path }
    }
  }
`;

const QUOTE_EDIT_ALT2 = `
  mutation McpQuoteEditAlt2($quoteId: EncodedId!, $attributes: QuoteEditAttributes!) {
    quoteEdit(quoteId: $quoteId, input: { attributes: $attributes }) {
      quote { id quoteNumber title quoteStatus sentAt jobberWebUri }
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

export type JobberQuoteLine = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
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

export type JobberProductSummary = {
  id: string;
  name?: string | null;
  defaultUnitCost?: number | null;
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
): Promise<JobberProductSummary[]> {
  const term = searchTerm.trim();
  if (!term) return [];
  const result = await graphql(PRODUCTS_SEARCH, { searchTerm: term }, deps);
  if (result.errors?.length) return [];
  return ((result.data?.productsAndServices?.nodes || []) as JobberProductSummary[]).filter(
    (node) => Boolean(node?.id)
  );
}

export async function updateUnsentQuoteDraft(
  input: {
    quoteId: string;
    title?: string | null;
    message?: string | null;
    taxRateId?: string | null;
    salespersonId?: string | null;
    addLineItems?: QuoteLineDraft[];
  },
  deps?: JobberDeps
): Promise<JobberQuoteDetail> {
  const quoteId = input.quoteId.trim();
  if (!quoteId) throw new Error('quoteId is required');

  const existing = await getQuoteById(quoteId, deps);
  assertQuoteIsDraftUnsent(existing);

  const attributes = buildDraftQuoteEditAttributes(input);
  if (Object.keys(attributes).length) {
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
    const lineItems = toJobberLineItems(input.addLineItems);
    const linesResult = await graphql(QUOTE_LINE_ITEMS, { quoteId, lineItems }, deps);
    assertNoJobberErrors(linesResult, 'quoteCreateLineItems');
    const lineErrors = jobberUserErrors(linesResult.data?.quoteCreateLineItems);
    if (lineErrors.length) throw new Error(lineErrors.join('; '));
  }

  return getQuoteById(quoteId, deps);
}

export function quoteEditUsedForbiddenFields(body: string): boolean {
  return /transitionQuoteTo/.test(body) || /"sentAt"\s*:/.test(body);
}
