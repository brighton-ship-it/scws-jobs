/**
 * Read-only Jobber invoice lookups for the MCP gateway.
 * Reuses the shared GraphQL client (same OAuth path as quotes).
 *
 * No send, create, edit, or payment mutations live here.
 */

import {
  assertNoJobberErrors,
  jobberGraphql,
  type JobberGraphqlResult,
} from './client.ts';
import { searchClients, type JobberDeps } from './quotes.ts';

export const MCP_INVOICE_PAGE_SIZE = 15;
export const MCP_INVOICE_MAX_PAGE_SIZE = 25;
export const MCP_INVOICE_MAX_SCAN_PAGES = 6;
export const MCP_INVOICE_CLIENT_LIMIT = 5;

export const UNPAID_INVOICE_STATUSES = ['awaiting_payment', 'past_due', 'bad_debt'] as const;

const READ_ONLY_INVOICE_QUERY = /\bmutation\b|invoiceCreate|invoiceEdit|invoiceSend|invoiceDelete|sendInvoice|recordPayment|paymentCreate/i;

export type JobberInvoiceAmounts = {
  subtotal?: number | null;
  discountAmount?: number | null;
  taxAmount?: number | null;
  total?: number | null;
  paymentsTotal?: number | null;
  invoiceBalance?: number | null;
  outstanding?: number | null;
};

export type JobberInvoiceClient = {
  id?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  emails?: Array<{ address?: string | null } | null> | null;
};

export type JobberInvoiceLine = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
};

export type JobberInvoiceDetail = {
  id: string;
  invoiceNumber?: string | number | null;
  subject?: string | null;
  invoiceStatus?: string | null;
  issuedDate?: string | null;
  dueDate?: string | null;
  createdAt?: string | null;
  clientHubUri?: string | null;
  jobberWebUri?: string | null;
  amounts?: JobberInvoiceAmounts | null;
  client?: JobberInvoiceClient | null;
  lineItems?: { nodes?: Array<JobberInvoiceLine | null> | null } | null;
};

export type JobberInvoicePageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

export type JobberInvoiceSummary = {
  id: string;
  invoiceNumber: string | number | null;
  subject: string | null;
  invoiceStatus: string | null;
  issuedDate: string | null;
  dueDate: string | null;
  createdAt: string | null;
  total: number | null;
  balance: number | null;
  amounts: {
    subtotal: number | null;
    discountAmount: number | null;
    taxAmount: number | null;
    total: number | null;
    paymentsTotal: number | null;
    invoiceBalance: number | null;
    balance: number | null;
  };
  publicUrl: string | null;
  paymentUrl: string | null;
  jobberWebUri: string | null;
  client: {
    id: string | null;
    name: string | null;
    companyName: string | null;
    emails: string[];
  } | null;
  unpaid: boolean;
  overdue: boolean;
  lineItems?: Array<{
    id: string | null;
    name: string | null;
    description: string | null;
    quantity: number | null;
    unitPrice: number | null;
  }>;
};

export type SearchInvoicesInput = {
  query?: string | null;
  status?: string | null;
  unpaid?: boolean;
  overdue?: boolean;
  issuedBefore?: string | null;
  first?: number;
  after?: string | null;
  includeLineItems?: boolean;
};

export type SearchInvoicesResult = {
  invoices: JobberInvoiceSummary[];
  pageInfo: JobberInvoicePageInfo;
  note?: string;
};

export type InvoiceServerFilter = {
  status?: string;
  invoiceStatus?: string[];
  issuedDate?: { before: string };
};

type InvoiceEdge = {
  cursor: string | null;
  node: JobberInvoiceDetail;
};

type QueryShape = {
  searchTerm: boolean;
  edges: boolean;
  invoiceBalance: boolean;
  paymentsTotal: boolean;
  clientHubUri: boolean;
  lineDescription: boolean;
  lines: boolean;
  statusUpper: boolean;
};

function graphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  assertReadOnlyInvoiceQuery(query);
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

export function assertReadOnlyInvoiceQuery(query: string): void {
  if (READ_ONLY_INVOICE_QUERY.test(query)) {
    throw new Error('Invoice tools are read-only');
  }
}

function errorText(result: JobberGraphqlResult): string {
  return (result.errors || []).map((error) => error.message || '').join(' ');
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function pageSize(first?: number): number {
  const n = first ?? MCP_INVOICE_PAGE_SIZE;
  if (!Number.isFinite(n) || n < 1) return MCP_INVOICE_PAGE_SIZE;
  return Math.min(Math.floor(n), MCP_INVOICE_MAX_PAGE_SIZE);
}

export function normalizeInvoiceStatus(status: string | null | undefined): string {
  return (status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function normalizeInvoiceNumber(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/^inv-?/, '');
}

export function isInvoiceNumberQuery(query: string): boolean {
  return /^(?:invoice\s*)?#?(?:inv-?)?\d+$/i.test(query.trim());
}

export function parseIssuedBefore(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('issuedBefore is empty');
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) throw new Error('issuedBefore must be an ISO date');
  return parsed.toISOString();
}

function parseInstant(value: string | null | undefined, endOfDay: boolean): Date | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function invoiceBalanceAmount(invoice: Pick<JobberInvoiceDetail, 'amounts'>): number | null {
  const amounts = invoice.amounts;
  const explicit = asNumber(amounts?.invoiceBalance);
  if (explicit != null) return explicit;
  const outstanding = asNumber(amounts?.outstanding);
  if (outstanding != null) return outstanding;
  const total = asNumber(amounts?.total);
  const paid = asNumber(amounts?.paymentsTotal);
  if (total != null && paid != null) return total - paid;
  return null;
}

export function isUnpaidInvoice(invoice: JobberInvoiceDetail): boolean {
  const balance = invoiceBalanceAmount(invoice);
  if (balance != null) return balance > 0.009;
  const status = normalizeInvoiceStatus(invoice.invoiceStatus);
  return (UNPAID_INVOICE_STATUSES as readonly string[]).includes(status);
}

export function isOverdueInvoice(invoice: JobberInvoiceDetail, now = new Date()): boolean {
  const status = normalizeInvoiceStatus(invoice.invoiceStatus);
  if (status === 'paid' || status === 'draft') return false;
  if (status === 'past_due') return true;
  if (!isUnpaidInvoice(invoice)) return false;
  if (status === 'bad_debt') return true;
  const due = parseInstant(invoice.dueDate, true);
  if (!due) return false;
  return due.getTime() < now.getTime();
}

export function invoiceMatchesQuery(invoice: JobberInvoiceDetail, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (isInvoiceNumberQuery(query)) {
    return normalizeInvoiceNumber(invoice.invoiceNumber) === normalizeInvoiceNumber(query);
  }
  const hay = [
    invoice.invoiceNumber,
    invoice.subject,
    invoice.client?.name,
    invoice.client?.companyName,
    invoice.client?.firstName,
    invoice.client?.lastName,
  ]
    .filter((part) => part != null && String(part).trim())
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

export function invoiceMatchesSearchFilters(
  invoice: JobberInvoiceDetail,
  input: SearchInvoicesInput,
  options?: { skipQuery?: boolean; now?: Date }
): boolean {
  const query = input.query?.trim() || '';
  if (query && !options?.skipQuery && !invoiceMatchesQuery(invoice, query)) return false;

  const status = normalizeInvoiceStatus(input.status);
  if (status && status !== 'all' && status !== 'unpaid' && status !== 'overdue') {
    if (normalizeInvoiceStatus(invoice.invoiceStatus) !== status) return false;
  }

  const wantsUnpaid = Boolean(input.unpaid) || status === 'unpaid';
  if (wantsUnpaid && !isUnpaidInvoice(invoice)) return false;

  const wantsOverdue = Boolean(input.overdue) || status === 'overdue';
  if (wantsOverdue && !isOverdueInvoice(invoice, options?.now)) return false;

  if (input.issuedBefore?.trim()) {
    const bound = new Date(parseIssuedBefore(input.issuedBefore));
    const issued = parseInstant(invoice.issuedDate || invoice.createdAt, false);
    if (!issued || issued.getTime() >= bound.getTime()) return false;
  }

  return true;
}

export function buildInvoiceServerFilter(input: SearchInvoicesInput): InvoiceServerFilter | null {
  const filter: InvoiceServerFilter = {};
  const status = normalizeInvoiceStatus(input.status);
  const wantsUnpaid =
    Boolean(input.unpaid) || status === 'unpaid' || Boolean(input.overdue) || status === 'overdue';

  if (status && status !== 'all' && status !== 'unpaid' && status !== 'overdue') {
    filter.status = status;
  } else if (wantsUnpaid) {
    filter.invoiceStatus = [...UNPAID_INVOICE_STATUSES];
  }

  if (input.issuedBefore?.trim()) {
    filter.issuedDate = { before: parseIssuedBefore(input.issuedBefore) };
  }

  if (!filter.status && !filter.invoiceStatus?.length && !filter.issuedDate) return null;
  return filter;
}

function cloneFilter(filter: InvoiceServerFilter | null): InvoiceServerFilter | null {
  if (!filter) return null;
  return {
    status: filter.status,
    invoiceStatus: filter.invoiceStatus ? [...filter.invoiceStatus] : undefined,
    issuedDate: filter.issuedDate ? { before: filter.issuedDate.before } : undefined,
  };
}

function filterIsEmpty(filter: InvoiceServerFilter | null): boolean {
  return !filter?.status && !filter?.invoiceStatus?.length && !filter?.issuedDate;
}

function invoiceNodeFields(shape: QueryShape): string {
  const amounts = [
    'subtotal',
    'discountAmount',
    'taxAmount',
    'total',
    shape.paymentsTotal ? 'paymentsTotal' : '',
    shape.invoiceBalance ? 'invoiceBalance' : '',
  ]
    .filter(Boolean)
    .join('\n      ');
  const lines = shape.lines
    ? `
    lineItems(first: 40) {
      nodes { id name ${shape.lineDescription ? 'description' : ''} quantity unitPrice }
    }`
    : '';
  return `
    id
    invoiceNumber
    subject
    invoiceStatus
    issuedDate
    dueDate
    createdAt
    ${shape.clientHubUri ? 'clientHubUri' : ''}
    jobberWebUri
    amounts {
      ${amounts}
    }
    client {
      id
      name
      firstName
      lastName
      companyName
      emails { address }
    }${lines}`;
}

function invoicesConnectionSelection(shape: QueryShape): string {
  const fields = invoiceNodeFields(shape);
  if (shape.edges) {
    return `edges { cursor node { ${fields} } }`;
  }
  return `nodes { ${fields} }`;
}

function invoicesQuery(shape: QueryShape): string {
  const searchDecl = shape.searchTerm ? ', $searchTerm: String' : '';
  const searchArg = shape.searchTerm ? ', searchTerm: $searchTerm' : '';
  return `
    query McpInvoices($first: Int!, $after: String, $filter: InvoiceFilterAttributes${searchDecl}) {
      invoices(first: $first, after: $after, filter: $filter${searchArg}) {
        ${invoicesConnectionSelection(shape)}
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
}

function invoiceByIdQuery(shape: QueryShape): string {
  return `
    query McpInvoiceById($id: EncodedId!) {
      invoice(id: $id) { ${invoiceNodeFields(shape)} }
    }
  `;
}

function clientInvoicesQuery(shape: QueryShape): string {
  return `
    query McpClientInvoices($id: EncodedId!, $first: Int!) {
      client(id: $id) {
        invoices(first: $first) {
          ${invoicesConnectionSelection(shape)}
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;
}

function applySchemaFallback(message: string, shape: QueryShape, filter: InvoiceServerFilter | null): boolean {
  let changed = false;
  if (shape.invoiceBalance && /invoiceBalance/i.test(message)) {
    shape.invoiceBalance = false;
    changed = true;
  }
  if (shape.paymentsTotal && /paymentsTotal/i.test(message)) {
    shape.paymentsTotal = false;
    changed = true;
  }
  if (shape.clientHubUri && /clientHubUri/i.test(message)) {
    shape.clientHubUri = false;
    changed = true;
  }
  if (shape.lineDescription && /InvoiceLineItem|field ['"]description['"]/i.test(message)) {
    shape.lineDescription = false;
    changed = true;
  }
  if (shape.edges && /field ['"]edges['"]/i.test(message)) {
    shape.edges = false;
    changed = true;
  }
  if (shape.searchTerm && /searchTerm/i.test(message)) {
    shape.searchTerm = false;
    changed = true;
  }
  if (
    filter?.invoiceStatus?.length &&
    /invoiceStatus/i.test(message) &&
    /argument|accept|unknown|defined|InvoiceFilter/i.test(message)
  ) {
    filter.invoiceStatus = undefined;
    changed = true;
  }
  if (
    filter?.issuedDate &&
    /issuedDate/i.test(message) &&
    /argument|accept|unknown|defined|InvoiceFilter/i.test(message)
  ) {
    filter.issuedDate = undefined;
    changed = true;
  }
  if (
    filter &&
    !shape.statusUpper &&
    /InvoiceStatusTypeEnum|invalid value/i.test(message) &&
    (filter.status || filter.invoiceStatus?.length)
  ) {
    if (filter.status) filter.status = filter.status.toUpperCase();
    if (filter.invoiceStatus?.length) {
      filter.invoiceStatus = filter.invoiceStatus.map((status) => status.toUpperCase());
    }
    shape.statusUpper = true;
    changed = true;
  }
  return changed;
}

function filterPayload(filter: InvoiceServerFilter | null): Record<string, unknown> | null {
  if (!filter || filterIsEmpty(filter)) return null;
  const payload: Record<string, unknown> = {};
  if (filter.status) payload.status = filter.status;
  if (filter.invoiceStatus?.length) payload.invoiceStatus = filter.invoiceStatus;
  if (filter.issuedDate) payload.issuedDate = filter.issuedDate;
  return Object.keys(payload).length ? payload : null;
}

async function queryWithFallback(
  build: (shape: QueryShape) => string,
  variablesFor: (shape: QueryShape, filter: InvoiceServerFilter | null) => Record<string, unknown>,
  shape: QueryShape,
  filter: InvoiceServerFilter | null,
  deps: JobberDeps | undefined,
  operation: string
): Promise<JobberGraphqlResult> {
  let current = cloneFilter(filter);
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await graphql(build(shape), variablesFor(shape, current), deps);
    if (!result.errors?.length) {
      if (filter) {
        filter.status = current?.status;
        filter.invoiceStatus = current?.invoiceStatus;
        filter.issuedDate = current?.issuedDate;
      }
      return result;
    }
    const changed = applySchemaFallback(errorText(result), shape, current);
    if (!changed) assertNoJobberErrors(result, operation);
  }
  throw new Error(`Jobber ${operation} query failed`);
}

function readConnection(connection: {
  edges?: Array<{ cursor?: string | null; node?: JobberInvoiceDetail | null } | null> | null;
  nodes?: Array<JobberInvoiceDetail | null> | null;
  pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
} | null | undefined): { edges: InvoiceEdge[]; pageInfo: JobberInvoicePageInfo } {
  const pageInfo: JobberInvoicePageInfo = {
    hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
    endCursor: connection?.pageInfo?.endCursor ?? null,
  };
  if (Array.isArray(connection?.edges)) {
    return {
      pageInfo,
      edges: connection.edges
        .filter((edge): edge is { cursor?: string | null; node: JobberInvoiceDetail } => Boolean(edge?.node?.id))
        .map((edge) => ({ cursor: edge.cursor ?? null, node: edge.node })),
    };
  }
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
  return {
    pageInfo,
    edges: nodes
      .filter((node): node is JobberInvoiceDetail => Boolean(node?.id))
      .map((node) => ({ cursor: null, node })),
  };
}

function clientDisplayName(client: JobberInvoiceClient | null | undefined): string | null {
  if (!client) return null;
  const name = client.name?.trim();
  if (name) return name;
  const parts = [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
  return parts || null;
}

export function summarizeInvoice(
  invoice: JobberInvoiceDetail,
  options?: { includeLineItems?: boolean; now?: Date }
): JobberInvoiceSummary {
  const balance = invoiceBalanceAmount(invoice);
  const total = asNumber(invoice.amounts?.total);
  const publicUrl = invoice.clientHubUri?.trim() || null;
  const summary: JobberInvoiceSummary = {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber ?? null,
    subject: invoice.subject ?? null,
    invoiceStatus: normalizeInvoiceStatus(invoice.invoiceStatus) || null,
    issuedDate: invoice.issuedDate ?? null,
    dueDate: invoice.dueDate ?? null,
    createdAt: invoice.createdAt ?? null,
    total,
    balance,
    amounts: {
      subtotal: asNumber(invoice.amounts?.subtotal),
      discountAmount: asNumber(invoice.amounts?.discountAmount),
      taxAmount: asNumber(invoice.amounts?.taxAmount),
      total,
      paymentsTotal: asNumber(invoice.amounts?.paymentsTotal),
      invoiceBalance: asNumber(invoice.amounts?.invoiceBalance),
      balance,
    },
    publicUrl,
    paymentUrl: publicUrl,
    jobberWebUri: invoice.jobberWebUri ?? null,
    client: invoice.client
      ? {
          id: invoice.client.id ?? null,
          name: clientDisplayName(invoice.client),
          companyName: invoice.client.companyName ?? null,
          emails: (invoice.client.emails || [])
            .map((entry) => entry?.address?.trim())
            .filter((address): address is string => Boolean(address)),
        }
      : null,
    unpaid: isUnpaidInvoice(invoice),
    overdue: isOverdueInvoice(invoice, options?.now),
  };
  if (options?.includeLineItems) {
    summary.lineItems = (invoice.lineItems?.nodes || [])
      .filter((line): line is JobberInvoiceLine => Boolean(line))
      .map((line) => ({
        id: line.id ?? null,
        name: line.name ?? null,
        description: line.description ?? null,
        quantity: line.quantity ?? null,
        unitPrice: line.unitPrice ?? null,
      }));
  }
  return summary;
}

function initialShape(input: SearchInvoicesInput): QueryShape {
  return {
    searchTerm: Boolean(input.query?.trim()),
    edges: true,
    invoiceBalance: true,
    paymentsTotal: true,
    clientHubUri: true,
    lineDescription: true,
    lines: Boolean(input.includeLineItems),
    statusUpper: false,
  };
}

async function fetchInvoicePage(
  input: {
    first: number;
    after: string | null;
    query: string;
    shape: QueryShape;
    filter: InvoiceServerFilter | null;
  },
  deps?: JobberDeps
): Promise<{ edges: InvoiceEdge[]; pageInfo: JobberInvoicePageInfo }> {
  const result = await queryWithFallback(
    invoicesQuery,
    (shape, filter) => {
      const variables: Record<string, unknown> = {
        first: input.first,
        after: input.after,
      };
      const payload = filterPayload(filter);
      if (payload) variables.filter = payload;
      if (shape.searchTerm && input.query) variables.searchTerm = input.query;
      return variables;
    },
    input.shape,
    input.filter,
    deps,
    'invoices'
  );
  return readConnection(result.data?.invoices);
}

async function invoicesFromClients(
  query: string,
  input: SearchInvoicesInput,
  shape: QueryShape,
  deps?: JobberDeps
): Promise<SearchInvoicesResult | null> {
  const clients = await searchClients(query, deps);
  const matches: JobberInvoiceDetail[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const client of clients.slice(0, MCP_INVOICE_CLIENT_LIMIT)) {
    if (!client?.id) continue;
    const result = await queryWithFallback(
      clientInvoicesQuery,
      (_shape, _filter) => ({ id: client.id, first: MCP_INVOICE_MAX_PAGE_SIZE }),
      shape,
      null,
      deps,
      'client invoices'
    );
    const page = readConnection(result.data?.client?.invoices);
    if (page.pageInfo.hasNextPage) truncated = true;
    for (const edge of page.edges) {
      if (!edge.node?.id || seen.has(edge.node.id)) continue;
      if (!invoiceMatchesSearchFilters(edge.node, input, { skipQuery: true })) continue;
      seen.add(edge.node.id);
      matches.push(edge.node);
    }
  }
  if (!matches.length) return null;
  const want = pageSize(input.first);
  const capped = matches.slice(0, want);
  return {
    invoices: capped.map((invoice) => summarizeInvoice(invoice, { includeLineItems: input.includeLineItems })),
    pageInfo: { hasNextPage: false, endCursor: null },
    note:
      truncated || matches.length > want
        ? 'Client-name fallback is capped (no invoice search cursor). Narrow the name to see the rest.'
        : undefined,
  };
}

export async function searchInvoices(
  input: SearchInvoicesInput,
  deps?: JobberDeps
): Promise<SearchInvoicesResult> {
  const query = input.query?.trim() || '';
  const want = pageSize(input.first);
  const shape = initialShape(input);
  const filter = buildInvoiceServerFilter(input);
  const collected: InvoiceEdge[] = [];
  let after: string | null = input.after?.trim() || null;
  let hasNextPage = false;
  let endCursor: string | null = null;
  let triedClients = false;

  for (let pages = 0; pages < MCP_INVOICE_MAX_SCAN_PAGES && collected.length < want; pages++) {
    const page = await fetchInvoicePage(
      { first: MCP_INVOICE_MAX_PAGE_SIZE, after, query, shape, filter },
      deps
    );

    if (!triedClients && query && !shape.searchTerm && !isInvoiceNumberQuery(query) && !input.after) {
      triedClients = true;
      const fromClients = await invoicesFromClients(query, input, shape, deps);
      if (fromClients) return fromClients;
    }

    const skipQuery = Boolean(query) && shape.searchTerm && !isInvoiceNumberQuery(query);
    let stoppedMidPage = false;
    for (let index = 0; index < page.edges.length; index++) {
      const edge = page.edges[index];
      if (!invoiceMatchesSearchFilters(edge.node, input, { skipQuery })) continue;
      if (collected.length >= want && edge.cursor) {
        stoppedMidPage = true;
        break;
      }
      collected.push(edge);
      if (edge.cursor) endCursor = edge.cursor;
    }

    const cursors = page.edges.length === 0 || page.edges.every((edge) => edge.cursor);
    if (stoppedMidPage) {
      hasNextPage = true;
      break;
    }
    if (!cursors && collected.length > want) {
      hasNextPage = page.pageInfo.hasNextPage;
      endCursor = page.pageInfo.endCursor;
      break;
    }
    if (collected.length >= want) {
      hasNextPage = page.pageInfo.hasNextPage;
      endCursor = endCursor || page.pageInfo.endCursor;
      break;
    }
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) {
      hasNextPage = false;
      endCursor = endCursor || page.pageInfo.endCursor;
      break;
    }
    after = page.pageInfo.endCursor;
    endCursor = after;
    if (pages + 1 >= MCP_INVOICE_MAX_SCAN_PAGES) {
      hasNextPage = true;
      break;
    }
  }

  const cursors = collected.length === 0 || collected.every((edge) => edge.cursor);
  const invoices = (cursors ? collected.slice(0, want) : collected).map((edge) =>
    summarizeInvoice(edge.node, { includeLineItems: input.includeLineItems })
  );

  return {
    invoices,
    pageInfo: { hasNextPage, endCursor },
  };
}

export function looksLikeJobberEncodedId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /^\d+$/.test(trimmed) || isInvoiceNumberQuery(trimmed)) return false;
  return /^[A-Za-z0-9+/_=-]{12,}$/.test(trimmed);
}

async function getInvoiceById(
  invoiceId: string,
  includeLineItems: boolean,
  deps?: JobberDeps
): Promise<JobberInvoiceDetail> {
  const shape = initialShape({ includeLineItems });
  const result = await queryWithFallback(
    invoiceByIdQuery,
    () => ({ id: invoiceId }),
    shape,
    null,
    deps,
    'invoice'
  );
  assertNoJobberErrors(result, 'invoice');
  const invoice = result.data?.invoice as JobberInvoiceDetail | undefined;
  if (!invoice?.id) throw new Error(`Jobber invoice ${invoiceId} not found`);
  return invoice;
}

export async function getInvoice(
  input: { invoiceId?: string | null; invoiceNumber?: string | null; includeLineItems?: boolean },
  deps?: JobberDeps
): Promise<JobberInvoiceSummary> {
  const invoiceId = input.invoiceId?.trim() || '';
  const invoiceNumber = input.invoiceNumber?.trim() || '';
  const includeLineItems = input.includeLineItems !== false;
  if (!invoiceId && !invoiceNumber) {
    throw new Error('invoiceId or invoiceNumber is required');
  }

  if (invoiceId && looksLikeJobberEncodedId(invoiceId)) {
    try {
      const invoice = await getInvoiceById(invoiceId, includeLineItems, deps);
      return summarizeInvoice(invoice, { includeLineItems });
    } catch (error) {
      if (!invoiceNumber) throw error;
    }
  }

  const number = invoiceNumber || invoiceId;
  const wanted = normalizeInvoiceNumber(number);
  if (!wanted) throw new Error('invoiceNumber is required');
  const page = await searchInvoices(
    { query: number, first: MCP_INVOICE_PAGE_SIZE, includeLineItems },
    deps
  );
  const match = page.invoices.find((invoice) => normalizeInvoiceNumber(invoice.invoiceNumber) === wanted);
  if (!match) throw new Error(`Jobber invoice ${number} not found`);
  return match;
}
