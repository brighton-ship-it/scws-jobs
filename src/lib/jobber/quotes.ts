import {
  assertNoJobberErrors,
  jobberGraphql,
  jobberUserErrors,
} from './client.ts';
import type { QuoteLineDraft } from './shop-book.ts';
import type { JobberTaxRate } from './tax.ts';

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

export type JobberQuoteSummary = {
  id: string;
  quoteNumber?: string | number | null;
  title?: string | null;
  quoteStatus?: string | null;
  sentAt?: string | null;
  jobberWebUri?: string | null;
  property?: { id?: string | null } | null;
};

export type JobberClient = {
  id: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  emails?: Array<{ address?: string | null } | null> | null;
  phones?: Array<{ number?: string | null } | null> | null;
  properties?: {
    nodes?: Array<{
      id: string;
      address?: JobberAddress | null;
    } | null> | null;
  } | null;
  quotes?: { nodes?: Array<JobberQuoteSummary | null> | null } | null;
};

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
    properties(first: 20) {
      nodes {
        id
        address { street1 street2 city province postalCode }
      }
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
        properties(first: 20) {
          nodes {
            id
            address { street1 street2 city province postalCode }
          }
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
      }
    }
  }
`;

const TAX_RATES = `
  query JobberTaxRates {
    taxRates {
      nodes { id name description }
    }
  }
`;

const USERS = `
  query JobberUsers {
    users(first: 50) {
      nodes { id name email }
    }
  }
`;

const QUOTE_CREATE = `
  mutation QuoteCreate($attributes: QuoteCreateAttributes!) {
    quoteCreate(input: { attributes: $attributes }) {
      quote {
        id
        quoteNumber
        title
        sentAt
        quoteStatus
        jobberWebUri
      }
      userErrors { message path }
    }
  }
`;

const QUOTE_CREATE_ALT = `
  mutation QuoteCreateAlt($quote: QuoteCreateAttributes!) {
    quoteCreate(quote: $quote) {
      quote {
        id
        quoteNumber
        title
        sentAt
        quoteStatus
        jobberWebUri
      }
      userErrors { message path }
    }
  }
`;

const QUOTE_LINE_ITEMS = `
  mutation QuoteCreateLineItems($quoteId: EncodedId!, $lineItems: [QuoteCreateLineItemAttributes!]!) {
    quoteCreateLineItems(quoteId: $quoteId, lineItems: $lineItems) {
      createdLineItems { id name quantity }
      userErrors { message path }
    }
  }
`;

export type JobberDeps = {
  fetchImpl?: typeof fetch;
  token?: string | null;
  env?: NodeJS.ProcessEnv;
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

export function buildUnsentQuoteAttributes(input: {
  clientId: string;
  propertyId?: string | null;
  title: string;
  message: string;
  salespersonId?: string | null;
  taxRateId?: string | null;
}): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    clientId: input.clientId,
    title: input.title,
    message: input.message,
  };
  if (input.propertyId) attributes.propertyId = input.propertyId;
  if (input.salespersonId) attributes.salespersonId = input.salespersonId;
  if (input.taxRateId) attributes.taxRateId = input.taxRateId;
  // Drafts stay unsent. Never set transitionQuoteTo or sentAt.
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
  return lines.map((line) => ({
    name: line.name,
    description: line.description || undefined,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxable: line.taxable,
    saveToProductsAndServices: false,
  }));
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
      for (const property of client.properties?.nodes || []) {
        if (normalizeStreet(property?.address?.street1) === street) return client;
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
  const needle = normalizeStreet(street);
  if (!needle) return client.properties?.nodes?.[0]?.id ?? null;
  for (const property of client.properties?.nodes || []) {
    if (property && normalizeStreet(property.address?.street1) === needle) {
      return property.id;
    }
  }
  return null;
}

export async function fetchTaxRates(deps?: JobberDeps): Promise<JobberTaxRate[]> {
  const result = await graphql(TAX_RATES, {}, deps);
  if (result.errors?.length) return [];
  return (result.data?.taxRates?.nodes || []) as JobberTaxRate[];
}

export async function findBrightonSalespersonId(deps?: JobberDeps): Promise<string | null> {
  const fromEnv = (deps?.env ?? process.env).JOBBER_SALESPERSON_ID?.trim();
  if (fromEnv) return fromEnv;

  const result = await graphql(USERS, {}, deps);
  if (result.errors?.length) return null;
  const users = (result.data?.users?.nodes || []) as Array<{
    id: string;
    name?: string | null;
    email?: string | null;
  }>;
  const brighton = users.find(
    (user) =>
      /brighton/i.test(user.name || '') || /brighton@/i.test(user.email || '')
  );
  return brighton?.id ?? null;
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
  },
  deps?: JobberDeps
): Promise<JobberQuoteSummary> {
  const attributes = buildUnsentQuoteAttributes(input);
  assertUnsentQuoteAttributes(attributes);

  let created = await graphql(QUOTE_CREATE, { attributes }, deps);
  if (created.errors?.length && /argument|QuoteCreate/i.test(created.errors[0]?.message || '')) {
    created = await graphql(QUOTE_CREATE_ALT, { quote: attributes }, deps);
  }
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

  const lineItems = toJobberLineItems(input.lineItems);
  const linesResult = await graphql(
    QUOTE_LINE_ITEMS,
    { quoteId: quote.id, lineItems },
    deps
  );
  assertNoJobberErrors(linesResult, 'quoteCreateLineItems');
  const lineErrors = jobberUserErrors(linesResult.data?.quoteCreateLineItems);
  if (lineErrors.length) {
    throw new Error(lineErrors.join('; '));
  }

  return quote;
}

export function quoteCreateUsedForbiddenFields(body: string): boolean {
  return /transitionQuoteTo/.test(body) || /"sentAt"\s*:/.test(body);
}
