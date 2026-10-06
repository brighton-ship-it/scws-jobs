import {
  assertNoJobberErrors,
  jobberGraphql,
  jobberUserErrors,
} from './client.ts';
import { mentionsGpFlag, type JobberProductCost } from './gross-profit.ts';
import { searchJobberProducts, type ProductCatalogCache } from './products.ts';
import type { QuoteLineDraft } from './shop-book.ts';
import {
  summarizeJobberTaxRate,
  taxRateMatchesQuery,
  type JobberTaxRate,
  type JobberTaxRateSummary,
} from './tax.ts';

export const LIVE_QUOTE_STATUSES = new Set([
  'draft',
  'pending',
  'awaiting_response',
  'changes_requested',
  'sent',
  'approved',
]);

export const DEAD_QUOTE_STATUSES = new Set(['archived', 'rejected', 'converted']);

export type JobberAddress = {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
};

/** Jobber User.name is Name { full first last }, not a string. User.email is UserEmail { raw }. */
export type JobberPersonName = {
  full?: string | null;
  first?: string | null;
  last?: string | null;
};

export type JobberSalesperson = {
  id?: string | null;
  name?: string | JobberPersonName | null;
  email?: string | { raw?: string | null } | null;
};

export type JobberQuoteSummary = {
  id: string;
  quoteNumber?: string | number | null;
  title?: string | null;
  quoteStatus?: string | null;
  sentAt?: string | null;
  jobberWebUri?: string | null;
  property?: { id?: string | null } | null;
  salesperson?: JobberSalesperson | null;
};

/** Brighton Scala, info@scwellservice.com. Used when env and user lookup do not yield an id. */
export const BRIGHTON_SALESPERSON_ID = 'Z2lkOi8vSm9iYmVyL1VzZXIvMjg0NDY4OQ==';
export const BRIGHTON_SALESPERSON_EMAIL = 'info@scwellservice.com';

export type JobberProperty = {
  id: string;
  address?: JobberAddress | null;
};

/** Jobber 2025-04-16 Client.properties is [Property!], not a Connection. */
export type JobberPropertiesConnection = {
  nodes?: Array<JobberProperty | null> | null;
};

export type JobberProperties =
  | Array<JobberProperty | null>
  | JobberPropertiesConnection
  | null
  | undefined;

export type JobberClient = {
  id: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  emails?: Array<{ address?: string | null } | null> | null;
  phones?: Array<{ number?: string | null } | null> | null;
  properties?: JobberProperties;
  quotes?: { nodes?: Array<JobberQuoteSummary | null> | null } | null;
};

export function jobberClientProperties(properties: JobberProperties): JobberProperty[] {
  if (!properties) return [];
  const list = Array.isArray(properties) ? properties : properties.nodes || [];
  return list.filter((property): property is JobberProperty => Boolean(property?.id));
}

export type JobberJob = {
  id: string;
  jobNumber?: number | string | null;
  title?: string | null;
  jobStatus?: string | null;
  client?: JobberClient | null;
  property?: { id: string; address?: JobberAddress | null } | null;
  quotes?: { nodes?: Array<JobberQuoteSummary | null> | null } | null;
};

const JOB_FIELDS = `
  id
  jobNumber
  title
  jobStatus
  client {
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
  }
  property {
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
    }
  }
`;

const JOB_BY_ID = `
  query JobById($id: EncodedId!) {
    job(id: $id) { ${JOB_FIELDS} }
  }
`;

const JOBS_SEARCH = `
  query JobsSearch($searchTerm: String!) {
    jobs(first: 10, searchTerm: $searchTerm) {
      nodes { ${JOB_FIELDS} }
    }
  }
`;

const CLIENT_SEARCH = `
  query ClientSearch($searchTerm: String!) {
    clients(searchTerm: $searchTerm, first: 10) {
      nodes {
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
      }
    }
  }
`;

const TAX_RATES = `
  query JobberTaxRates {
    taxRates {
      nodes { id name label tax default description }
    }
  }
`;

const USERS = `
  query JobberUsers {
    users(first: 50) {
      nodes {
        id
        name { full first last }
        email { raw }
      }
    }
  }
`;

const USERS_NO_EMAIL = `
  query JobberUsersNoEmail {
    users(first: 50) {
      nodes {
        id
        name { full first last }
      }
    }
  }
`;

/** Jobber 2025-04-16: quoteCreate takes top-level attributes only. Do not wrap in input. */
const QUOTE_CREATE = `
  mutation QuoteCreate($attributes: QuoteCreateAttributes!) {
    quoteCreate(attributes: $attributes) {
      quote {
        id
        quoteNumber
        title
        sentAt
        quoteStatus
        jobberWebUri
        salesperson { id name { full } }
      }
      userErrors { message path }
    }
  }
`;

/** Best-effort private note. Jobber's public schema dropped quoteNoteCreate; try both shapes. */
const QUOTE_NOTE_CREATE = `
  mutation QuoteCreateNote($quoteId: EncodedId!, $message: String!) {
    quoteCreateNote(quoteId: $quoteId, input: { message: $message }) {
      quoteNote { id }
      userErrors { message path }
    }
  }
`;

const QUOTE_NOTE_CREATE_ALT = `
  mutation NoteCreate($quoteId: EncodedId!, $message: String!) {
    noteCreate(input: { linkedTo: $quoteId, message: $message }) {
      note { id }
      userErrors { message path }
    }
  }
`;

export type JobberDeps = {
  fetchImpl?: typeof fetch;
  token?: string | null;
  env?: NodeJS.ProcessEnv;
  /** Optional Jobber product cost overlay for GP scoring (tests inject this). */
  productCosts?: JobberProductCost[];
};

export function isLiveQuote(quote: JobberQuoteSummary | null | undefined): boolean {
  if (!quote?.id) return false;
  const status = (quote.quoteStatus || 'draft').toLowerCase();
  if (DEAD_QUOTE_STATUSES.has(status)) return false;
  return LIVE_QUOTE_STATUSES.has(status) || !quote.quoteStatus;
}

export function findLiveQuoteForJob(
  quotes: Array<JobberQuoteSummary | null> | null | undefined,
  job: Pick<JobberJob, 'jobNumber' | 'property'>
): JobberQuoteSummary | null {
  const propertyId = job.property?.id;
  return (
    (quotes || []).find((quote) => {
      if (!isLiveQuote(quote) || !quote) return false;
      if (propertyId && quote.property?.id && quote.property.id !== propertyId) return false;
      return true;
    }) || null
  );
}

export function resolveQuoteCreatePropertyId(
  propertyId: string | null | undefined,
  properties?: JobberProperties
): string {
  const provided = propertyId?.trim();
  if (provided) return provided;

  const list = jobberClientProperties(properties);
  if (list.length === 1) return list[0].id;
  if (list.length === 0) {
    throw new Error(
      'propertyId is required: this client has no properties. Pass propertyId or add a property in Jobber first.'
    );
  }
  throw new Error(
    `propertyId is required: this client has ${list.length} properties. Pass propertyId to choose one.`
  );
}

export function buildUnsentQuoteAttributes(input: {
  clientId: string;
  propertyId?: string | null;
  title: string;
  message: string;
  salespersonId?: string | null;
  taxRateId?: string | null;
  lineItems?: QuoteLineDraft[];
}): Record<string, unknown> {
  const propertyId = resolveQuoteCreatePropertyId(input.propertyId);
  const attributes: Record<string, unknown> = {
    clientId: input.clientId,
    propertyId,
    title: input.title,
    message: input.message,
  };
  if (input.salespersonId) attributes.salespersonId = input.salespersonId;
  if (input.taxRateId) attributes.taxRateId = input.taxRateId;
  if (input.lineItems) attributes.lineItems = toJobberLineItems(input.lineItems);
  // Drafts stay unsent. Never set transitionQuoteTo or sentAt.
  // Never put GP FLAG math on message — that is the client-facing email body.
  return attributes;
}

export function assertUnsentQuoteAttributes(attributes: Record<string, unknown>): void {
  if ('transitionQuoteTo' in attributes) {
    throw new Error('Never set transitionQuoteTo — drafts must stay unsent');
  }
  if ('sentAt' in attributes) {
    throw new Error('Never set sentAt on quote create');
  }
}

export function toJobberLineItems(lines: QuoteLineDraft[]): Array<Record<string, unknown>> {
  return lines.map((line) => {
    const item: Record<string, unknown> = {
      name: line.name,
      description: line.description || undefined,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxable: line.taxable,
      saveToProductsAndServices: false,
    };
    if (typeof line.optional === 'boolean') item.optional = line.optional;
    if (typeof line.recommended === 'boolean') item.recommended = line.recommended;
    const productOrServiceId = line.productOrServiceId?.trim();
    if (productOrServiceId) item.productOrServiceId = productOrServiceId;
    return item;
  });
}

export async function attachInternalQuoteNote(
  quoteId: string,
  note: string,
  deps?: JobberDeps
): Promise<boolean> {
  if (!note.trim()) return false;
  for (const query of [QUOTE_NOTE_CREATE, QUOTE_NOTE_CREATE_ALT]) {
    try {
      const result = await graphql(query, { quoteId, message: note }, deps);
      if (result.errors?.length) continue;
      const payload = result.data?.quoteCreateNote || result.data?.noteCreate;
      if (jobberUserErrors(payload).length) continue;
      if (payload?.quoteNote?.id || payload?.note?.id) return true;
    } catch {
      // Schema mismatch — title suffix + API JSON still carry the FLAG.
    }
  }
  return false;
}

export async function fetchProductCosts(
  searchTerms: string[],
  deps?: JobberDeps
): Promise<JobberProductCost[]> {
  if (deps?.productCosts) return deps.productCosts;
  const found: JobberProductCost[] = [];
  const seen = new Set<string>();
  const catalogCache: ProductCatalogCache = {};
  for (const term of searchTerms) {
    const trimmed = term?.trim();
    if (!trimmed) continue;
    const result = await searchJobberProducts(trimmed, deps, {
      includeInternalCost: true,
      catalogCache,
    });
    for (const node of result.products) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      found.push({
        name: node.name,
        internalUnitCost: node.internalUnitCost ?? null,
        defaultUnitCost: node.defaultUnitCost,
      });
    }
  }
  return found;
}

function graphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

export async function loadJobByIdOrNumber(
  input: { jobId?: string | null; jobNumber?: string | number | null },
  deps?: JobberDeps
): Promise<JobberJob> {
  const jobId = input.jobId?.trim();
  if (jobId && (jobId.startsWith('Z2lk') || jobId.includes('Jobber') || jobId.length > 12)) {
    const result = await graphql(JOB_BY_ID, { id: jobId }, deps);
    assertNoJobberErrors(result, 'job');
    if (result.data?.job) return result.data.job as JobberJob;
  }

  const jobNumber = input.jobNumber != null ? String(input.jobNumber).trim() : jobId || '';
  if (!jobNumber) {
    throw new Error('jobNumber or jobId is required');
  }

  const result = await graphql(JOBS_SEARCH, { searchTerm: jobNumber }, deps);
  assertNoJobberErrors(result, 'jobs');
  const nodes = (result.data?.jobs?.nodes || []) as JobberJob[];
  const match =
    nodes.find((job) => String(job.jobNumber) === jobNumber) ||
    nodes.find((job) => job.id === jobId) ||
    nodes[0];
  if (!match) {
    throw new Error(`Jobber job ${jobNumber} not found`);
  }
  return match;
}

export async function searchClients(
  searchTerm: string,
  deps?: JobberDeps
): Promise<JobberClient[]> {
  const term = searchTerm.trim();
  if (!term) return [];
  const result = await graphql(CLIENT_SEARCH, { searchTerm: term }, deps);
  assertNoJobberErrors(result, 'clients');
  return (result.data?.clients?.nodes || []) as JobberClient[];
}

export function normalizeStreet(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|way|court|ct|boulevard|blvd)\b/g, '')
    .trim();
}

export function findExistingClient(
  clients: JobberClient[],
  needle: {
    phone?: string | null;
    email?: string | null;
    street?: string | null;
    name?: string | null;
  }
): JobberClient | null {
  const phone = (needle.phone || '').replace(/\D/g, '').slice(-10);
  const email = (needle.email || '').trim().toLowerCase();
  const street = normalizeStreet(needle.street);
  const name = (needle.name || '').trim().toLowerCase();

  for (const client of clients) {
    if (phone) {
      for (const entry of client.phones || []) {
        if ((entry?.number || '').replace(/\D/g, '').slice(-10) === phone) return client;
      }
    }
    if (email) {
      for (const entry of client.emails || []) {
        if ((entry?.address || '').trim().toLowerCase() === email) return client;
      }
    }
    if (street) {
      for (const property of jobberClientProperties(client.properties)) {
        if (normalizeStreet(property.address?.street1) === street) return client;
      }
    }
    if (name && (client.name || '').trim().toLowerCase() === name) return client;
  }
  return null;
}

export function findExistingPropertyId(
  client: JobberClient,
  street: string | null | undefined
): string | null {
  const properties = jobberClientProperties(client.properties);
  const needle = normalizeStreet(street);
  if (!needle) return properties[0]?.id ?? null;
  for (const property of properties) {
    if (normalizeStreet(property.address?.street1) === needle) {
      return property.id;
    }
  }
  return null;
}

export async function fetchTaxRates(deps?: JobberDeps): Promise<JobberTaxRate[]> {
  const result = await graphql(TAX_RATES, {}, deps);
  assertNoJobberErrors(result, 'taxRates');
  return ((result.data?.taxRates?.nodes || []) as JobberTaxRate[]).filter((rate) => Boolean(rate?.id));
}

export async function listTaxRates(
  query: string | null | undefined,
  deps?: JobberDeps
): Promise<JobberTaxRateSummary[]> {
  const rates = await fetchTaxRates(deps);
  return rates.filter((rate) => taxRateMatchesQuery(rate, query)).map(summarizeJobberTaxRate);
}

export function jobberSalespersonName(salesperson: JobberSalesperson | null | undefined): string | null {
  const name = salesperson?.name;
  if (!name) return null;
  if (typeof name === 'string') {
    const trimmed = name.trim();
    return trimmed || null;
  }
  const full = name.full?.trim();
  if (full) return full;
  const joined = [name.first, name.last]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ');
  return joined || null;
}

export function jobberSalespersonId(salesperson: JobberSalesperson | null | undefined): string | null {
  const id = salesperson?.id?.trim();
  return id || null;
}

function jobberSalespersonEmail(salesperson: JobberSalesperson | null | undefined): string {
  const email = salesperson?.email;
  if (!email) return '';
  if (typeof email === 'string') return email.trim().toLowerCase();
  return (email.raw || '').trim().toLowerCase();
}

function isBrightonSalesperson(user: JobberSalesperson): boolean {
  const name = jobberSalespersonName(user) || '';
  const email = jobberSalespersonEmail(user);
  return email === BRIGHTON_SALESPERSON_EMAIL || /brighton/i.test(name) || /brighton@/i.test(email);
}

export function summarizeJobberSalesperson(
  salesperson: JobberSalesperson | null | undefined
): { id: string; name: string | null } | null {
  const id = jobberSalespersonId(salesperson);
  if (!id) return null;
  return { id, name: jobberSalespersonName(salesperson) };
}

/**
 * quoteCreate and quoteEdit both accept salespersonId (QuoteCreateAttributes /
 * QuoteEditAttributes, public schema 2025-01-20; later changelogs do not remove it).
 * An empty userErrors list is not proof the salesperson changed, so callers re-read
 * Quote.salesperson. quoteEdit is the only mutation that writes it.
 */
export function assertQuoteSalespersonApplied(
  quote: {
    id?: string | null;
    quoteNumber?: string | number | null;
    salesperson?: JobberSalesperson | null;
  },
  requestedId: string,
  operation: 'quoteCreate' | 'quoteEdit'
): void {
  const wanted = requestedId.trim();
  if (!wanted) return;
  if (jobberSalespersonId(quote.salesperson) === wanted) return;

  const label = quote.quoteNumber ?? quote.id ?? 'unknown';
  const actualId = jobberSalespersonId(quote.salesperson);
  const actualName = jobberSalespersonName(quote.salesperson);
  const current = actualId ? `${actualName ? `${actualName} ` : ''}(${actualId})` : 'no salesperson';
  if (operation === 'quoteCreate') {
    throw new Error(
      `Jobber quoteCreate returned no errors, but quote ${label} salesperson is still ${current}. Requested salespersonId ${wanted} was not applied. The draft already exists${quote.id ? ` (${quote.id})` : ''}; do not create another copy.`
    );
  }
  throw new Error(
    `Jobber quoteEdit returned no errors, but quote ${label} salesperson is still ${current}. Requested salespersonId ${wanted} was not applied. quoteEdit is the only quote mutation that accepts salespersonId; change the salesperson in the Jobber UI if this persists.`
  );
}

export async function findBrightonSalespersonId(deps?: JobberDeps): Promise<string> {
  const fromEnv = (deps?.env ?? process.env).JOBBER_SALESPERSON_ID?.trim();
  if (fromEnv) return fromEnv;

  try {
    let result = await graphql(USERS, {}, deps);
    const errorText = () => (result.errors || []).map((error) => error.message || '').join(' ');
    if (result.errors?.length && /email/i.test(errorText())) {
      result = await graphql(USERS_NO_EMAIL, {}, deps);
    }
    if (!result.errors?.length) {
      const users = (result.data?.users?.nodes || []) as JobberSalesperson[];
      const byEmail = users.find((user) => jobberSalespersonEmail(user) === BRIGHTON_SALESPERSON_EMAIL);
      const brighton = byEmail || users.find((user) => isBrightonSalesperson(user));
      if (brighton?.id) return brighton.id;
    }
  } catch {
    // Lookup can fail. The known Brighton user id still attributes the quote.
  }
  return BRIGHTON_SALESPERSON_ID;
}

export async function createUnsentQuote(
  input: {
    clientId: string;
    propertyId?: string | null;
    title: string;
    message: string;
    salespersonId?: string | null;
    taxRateId?: string | null;
    lineItems: QuoteLineDraft[];
    internalNote?: string | null;
  },
  deps?: JobberDeps
): Promise<JobberQuoteSummary> {
  if (mentionsGpFlag(input.message)) {
    throw new Error('Customer-facing quote message must not contain GP FLAG math');
  }
  if (!input.lineItems?.length) {
    throw new Error(
      'lineItems is required to create a Jobber quote (QuoteCreateAttributes.lineItems is NON_NULL)'
    );
  }
  const attributes = buildUnsentQuoteAttributes({
    ...input,
    lineItems: input.lineItems,
  });
  assertUnsentQuoteAttributes(attributes);

  // 2025-04-16 rejects quoteCreate(input:). Do not retry that shape on field validation
  // errors such as missing lineItems — those mention QuoteCreateAttributes and used to
  // trip a false /argument|QuoteCreate/ fallback.
  const created = await graphql(QUOTE_CREATE, { attributes }, deps);
  assertNoJobberErrors(created, 'quoteCreate');
  const payload = created.data?.quoteCreate;
  const createErrors = jobberUserErrors(payload);
  if (createErrors.length) {
    throw new Error(createErrors.join('; '));
  }
  const quote = payload?.quote as JobberQuoteSummary | undefined;
  if (!quote?.id) {
    throw new Error('Jobber quoteCreate returned no quote');
  }
  if (quote.sentAt) {
    throw new Error('Jobber returned sentAt on a draft create — aborting');
  }
  if (input.salespersonId?.trim()) {
    assertQuoteSalespersonApplied(quote, input.salespersonId, 'quoteCreate');
  }

  if (input.internalNote) {
    await attachInternalQuoteNote(quote.id, input.internalNote, deps);
  }

  return quote;
}

export function quoteCreateUsedForbiddenFields(body: string): boolean {
  return /transitionQuoteTo/.test(body) || /"sentAt"\s*:/.test(body);
}
