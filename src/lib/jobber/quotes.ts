import {
  assertNoJobberErrors,
  jobberGraphql,
  jobberUserErrors,
} from './client.ts';
import { mentionsGpFlag, type JobberProductCost } from './gross-profit.ts';
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

/** Last resort when the quote note mutations are missing. Private client note only. */
const CLIENT_NOTE_CREATE = `
  mutation ClientCreateNote($clientId: EncodedId!, $message: String!) {
    clientCreateNote(clientId: $clientId, input: { message: $message }) {
      clientNote { id }
      userErrors { message path }
    }
  }
`;

const CLIENT_NOTE_CREATE_ALT = `
  mutation ClientCreateNoteAlt($clientId: EncodedId!, $message: String!) {
    clientCreateNote(clientId: $clientId, input: { message: $message }) {
      note { id }
      userErrors { message path }
    }
  }
`;

export type QuoteNoteMethod = 'quoteCreateNote' | 'noteCreate' | 'clientCreateNote';

export type QuoteNoteAttachResult = {
  ok: boolean;
  noteId?: string;
  method?: QuoteNoteMethod;
  userErrors?: string[];
};

const PRODUCTS_SEARCH = `
  query ProductsAndServices($searchTerm: String!) {
    productsAndServices(searchTerm: $searchTerm, first: 15) {
      nodes { id name internalUnitCost defaultUnitCost }
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
  return lines.map((line) => ({
    name: line.name,
    description: line.description || undefined,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxable: line.taxable,
    saveToProductsAndServices: false,
  }));
}

type NotePayload = {
  quoteNote?: { id?: string | null } | null;
  note?: { id?: string | null } | null;
  clientNote?: { id?: string | null } | null;
  userErrors?: Array<{ message?: string; path?: unknown }>;
};

type NoteAttempt = {
  method: QuoteNoteMethod;
  query: string;
  variables: Record<string, unknown>;
  read: (data: Record<string, NotePayload | undefined> | undefined) => NotePayload | undefined;
  noteId: (payload: NotePayload) => string | null | undefined;
};

function rememberNoteErrors(bucket: string[], errors: Array<string | null | undefined>): void {
  for (const error of errors) {
    const message = error?.trim();
    if (message && !bucket.includes(message)) bucket.push(message);
  }
}

/**
 * Attach a private note. Tries quoteCreateNote, then noteCreate, then
 * clientCreateNote when a client id is available. Never edits the quote itself.
 * Blank notes are a no-op (`ok: false`) so draft create can ignore them.
 */
export async function attachInternalQuoteNote(
  quoteId: string,
  note: string,
  deps?: JobberDeps,
  clientId?: string | null
): Promise<QuoteNoteAttachResult> {
  const message = note.trim();
  const linkedQuoteId = quoteId.trim();
  if (!message || !linkedQuoteId) return { ok: false };

  const userErrors: string[] = [];
  const attempts: NoteAttempt[] = [
    {
      method: 'quoteCreateNote',
      query: QUOTE_NOTE_CREATE,
      variables: { quoteId: linkedQuoteId, message },
      read: (data) => data?.quoteCreateNote,
      noteId: (payload) => payload.quoteNote?.id,
    },
    {
      method: 'noteCreate',
      query: QUOTE_NOTE_CREATE_ALT,
      variables: { quoteId: linkedQuoteId, message },
      read: (data) => data?.noteCreate,
      noteId: (payload) => payload.note?.id,
    },
  ];

  const linkedClientId = clientId?.trim();
  if (linkedClientId) {
    attempts.push(
      {
        method: 'clientCreateNote',
        query: CLIENT_NOTE_CREATE,
        variables: { clientId: linkedClientId, message },
        read: (data) => data?.clientCreateNote,
        noteId: (payload) => payload.clientNote?.id,
      },
      {
        method: 'clientCreateNote',
        query: CLIENT_NOTE_CREATE_ALT,
        variables: { clientId: linkedClientId, message },
        read: (data) => data?.clientCreateNote,
        noteId: (payload) => payload.note?.id,
      }
    );
  }

  for (const attempt of attempts) {
    try {
      const result = await graphql(attempt.query, attempt.variables, deps);
      if (result.errors?.length) {
        rememberNoteErrors(
          userErrors,
          result.errors.map((error) => error.message)
        );
        continue;
      }
      const payload = attempt.read(result.data);
      const errors = jobberUserErrors(payload);
      if (errors.length) {
        rememberNoteErrors(userErrors, errors);
        continue;
      }
      const noteId = payload ? attempt.noteId(payload) : undefined;
      if (noteId) return { ok: true, noteId, method: attempt.method };
    } catch (error) {
      // Schema mismatch — title suffix + API JSON still carry the FLAG.
      rememberNoteErrors(userErrors, [
        error instanceof Error ? error.message : 'Jobber note request failed',
      ]);
    }
  }

  return {
    ok: false,
    userErrors: userErrors.length ? userErrors : ['Jobber did not attach a note'],
  };
}

export async function fetchProductCosts(
  searchTerms: string[],
  deps?: JobberDeps
): Promise<JobberProductCost[]> {
  if (deps?.productCosts) return deps.productCosts;
  const found: JobberProductCost[] = [];
  const seen = new Set<string>();
  for (const term of searchTerms.filter(Boolean)) {
    try {
      const result = await graphql(PRODUCTS_SEARCH, { searchTerm: term }, deps);
      if (result.errors?.length) continue;
      for (const node of (result.data?.productsAndServices?.nodes || []) as JobberProductCost[]) {
        const key = `${node.name || ''}|${node.sku || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(node);
      }
    } catch {
      // Live catalog is optional — vendor nets in this repo still score.
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

  if (input.internalNote) {
    await attachInternalQuoteNote(quote.id, input.internalNote, deps);
  }

  return quote;
}

export function quoteCreateUsedForbiddenFields(body: string): boolean {
  return /transitionQuoteTo/.test(body) || /"sentAt"\s*:/.test(body);
}
