/**
 * Client, property, and user reads/writes for the MCP gateway.
 *
 * Schema (public introspection, API version 2025-01-20; gateway pin stays
 * 2025-04-16). The 2025-04-16 changelog does not change these argument names.
 * - clientCreate(input: ClientCreateInput!)
 * - propertyCreate(clientId: EncodedId!, input: PropertyCreateInput!)
 *   PropertyCreateInput is { properties: [PropertyAttributes!] }, and each
 *   property requires address: AddressAttributes.
 * - users(first, after) → User.name is Name { full first last }, email is
 *   UserEmail { raw }.
 *
 * clientCreate sets receivesReminders and the follow-up flags false, and
 * every phone sets smsAllowed false. Those flags are not tool arguments.
 * This does not email or text the new client.
 */

import {
  assertNoJobberErrors,
  jobberGraphql,
  jobberUserErrors,
} from './client.ts';
import { assertNoClientNotification, assertWriteDoesNotDeliver } from './mcp-notify.ts';
import {
  jobberClientProperties,
  searchClients,
  type JobberClient,
  type JobberDeps,
} from './quotes.ts';

const EMAIL_DESCRIPTIONS = new Set(['MAIN', 'WORK', 'PERSONAL', 'OTHER']);
const PHONE_DESCRIPTIONS = new Set(['MAIN', 'WORK', 'MOBILE', 'HOME', 'FAX', 'OTHER']);

const CLIENT_CREATE = `
  mutation McpClientCreate($input: ClientCreateInput!) {
    clientCreate(input: $input) {
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
          address { street1 street2 city province postalCode country }
        }
      }
      userErrors { message path }
    }
  }
`;

const PROPERTY_CREATE = `
  mutation McpPropertyCreate($clientId: EncodedId!, $input: PropertyCreateInput!) {
    propertyCreate(clientId: $clientId, input: $input) {
      properties {
        id
        address { street1 street2 city province postalCode country }
      }
      userErrors { message path }
    }
  }
`;

const USERS = `
  query McpUsers($first: Int!, $after: String) {
    users(first: $first, after: $after) {
      nodes {
        id
        status
        name { full first last }
        email { raw }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const USERS_NO_EMAIL = `
  query McpUsersNoEmail($first: Int!, $after: String) {
    users(first: $first, after: $after) {
      nodes {
        id
        status
        name { full first last }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export type AddressInput = {
  street1: string;
  street2?: string;
  city: string;
  province: string;
  postalCode: string;
  country?: string;
};

export type ContactEmailInput = {
  address: string;
  description?: string;
  primary?: boolean;
};

export type ContactPhoneInput = {
  number: string;
  description?: string;
  primary?: boolean;
};

export type CreateClientInput = {
  firstName: string;
  lastName: string;
  companyName?: string;
  emails?: ContactEmailInput[];
  phones?: ContactPhoneInput[];
  billingAddress?: AddressInput;
  property?: AddressInput;
  force?: boolean;
};

export type ClientMatch = {
  matchedBy: 'email' | 'name';
  client: JobberClient;
};

export type CreateClientResult = {
  created: boolean;
  notified: false;
  client: JobberClient | null;
  matches: ClientMatch[];
  warning?: string;
};

export type JobberUserSummary = {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  status: string | null;
};

type UserNode = {
  id?: string | null;
  status?: string | null;
  name?: { full?: string | null; first?: string | null; last?: string | null } | string | null;
  email?: { raw?: string | null } | string | null;
};

function graphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  assertWriteDoesNotDeliver(query);
  assertNoClientNotification(variables);
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function buildAddressAttributes(address: AddressInput): Record<string, unknown> {
  const street1 = address.street1.trim();
  const city = address.city.trim();
  const province = address.province.trim();
  const postalCode = address.postalCode.trim();
  const country = (address.country || 'US').trim();
  if (!street1 || !city || !province || !postalCode) {
    throw new Error('Address needs street1, city, province, and postalCode');
  }
  const row: Record<string, unknown> = { street1, city, province, postalCode, country };
  const street2 = address.street2?.trim();
  if (street2) row.street2 = street2;
  return row;
}

function parseAddress(value: unknown, field: string): AddressInput | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an address object`);
  }
  const row = value as Record<string, unknown>;
  return {
    street1: requiredText(row.street1, `${field}.street1`),
    street2: optionalText(row.street2),
    city: requiredText(row.city, `${field}.city`),
    province: requiredText(row.province, `${field}.province`),
    postalCode: requiredText(row.postalCode, `${field}.postalCode`),
    country: optionalText(row.country),
  };
}

function descriptionOf(value: unknown, allowed: Set<string>, field: string, fallback: string): string {
  const text = optionalText(value);
  if (!text) return fallback;
  const normalized = text.toUpperCase().replace(/[\s-]+/g, '_');
  if (!allowed.has(normalized)) {
    throw new Error(`${field} must be one of ${[...allowed].join(', ')}`);
  }
  return normalized;
}

function parseEmails(value: unknown): ContactEmailInput[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('emails must be an array');
  return value.map((item, index) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return {
      address: requiredText(row.address, `emails[${index}].address`),
      description: descriptionOf(row.description, EMAIL_DESCRIPTIONS, `emails[${index}].description`, 'MAIN'),
      primary: row.primary === true,
    };
  });
}

function parsePhones(value: unknown): ContactPhoneInput[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('phones must be an array');
  return value.map((item, index) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return {
      number: requiredText(row.number, `phones[${index}].number`),
      description: descriptionOf(row.description, PHONE_DESCRIPTIONS, `phones[${index}].description`, 'MAIN'),
      primary: row.primary === true,
    };
  });
}

function optionalBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return value.trim().toLowerCase() === 'true';
}

export function parseCreateClientArgs(args: Record<string, unknown>): CreateClientInput {
  return {
    firstName: requiredText(args.firstName, 'firstName'),
    lastName: requiredText(args.lastName, 'lastName'),
    companyName: optionalText(args.companyName),
    emails: parseEmails(args.emails),
    phones: parsePhones(args.phones),
    billingAddress: parseAddress(args.billingAddress, 'billingAddress'),
    property: parseAddress(args.property, 'property'),
    force: optionalBoolean(args.force),
  };
}

export function parsePropertyAddressArgs(args: Record<string, unknown>): AddressInput {
  return {
    street1: requiredText(args.street1, 'street1'),
    street2: optionalText(args.street2),
    city: requiredText(args.city, 'city'),
    province: requiredText(args.province, 'province'),
    postalCode: requiredText(args.postalCode, 'postalCode'),
    country: optionalText(args.country),
  };
}

function normalizeName(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function clientDisplayName(client: JobberClient): string {
  return (
    client.name ||
    [client.firstName, client.lastName].filter(Boolean).join(' ') ||
    ''
  );
}

export function findClientDuplicates(
  clients: JobberClient[],
  input: Pick<CreateClientInput, 'firstName' | 'lastName' | 'emails'>
): ClientMatch[] {
  const emails = new Set(
    (input.emails || []).map((email) => email.address.trim().toLowerCase()).filter(Boolean)
  );
  const fullName = normalizeName(`${input.firstName} ${input.lastName}`);
  const matches: ClientMatch[] = [];
  const seen = new Set<string>();

  for (const client of clients) {
    if (!client?.id || seen.has(client.id)) continue;
    const clientEmails = (client.emails || [])
      .map((entry) => (entry?.address || '').trim().toLowerCase())
      .filter(Boolean);
    if (clientEmails.some((address) => emails.has(address))) {
      seen.add(client.id);
      matches.push({ matchedBy: 'email', client });
      continue;
    }
    const name = normalizeName(clientDisplayName(client));
    const parts = normalizeName(`${client.firstName || ''} ${client.lastName || ''}`);
    if (fullName && (name === fullName || parts === fullName)) {
      seen.add(client.id);
      matches.push({ matchedBy: 'name', client });
    }
  }
  return matches;
}

function withPrimary<T extends { primary?: boolean }>(rows: T[]): T[] {
  if (!rows.length) return rows;
  if (rows.some((row) => row.primary)) {
    const first = rows.findIndex((row) => row.primary);
    return rows.map((row, index) => ({ ...row, primary: index === first }));
  }
  return rows.map((row, index) => ({ ...row, primary: index === 0 }));
}

export function buildClientCreateInput(input: CreateClientInput): Record<string, unknown> {
  const emails = withPrimary(input.emails || []).map((email) => ({
    description: email.description || 'MAIN',
    address: email.address.trim(),
    primary: email.primary === true,
  }));
  const phones = withPrimary(input.phones || []).map((phone) => ({
    description: phone.description || 'MAIN',
    number: phone.number.trim(),
    primary: phone.primary === true,
    smsAllowed: false,
  }));
  const attributes: Record<string, unknown> = {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    receivesReminders: false,
    receivesFollowUps: false,
    receivesQuoteFollowUps: false,
    receivesInvoiceFollowUps: false,
  };
  if (input.companyName?.trim()) attributes.companyName = input.companyName.trim();
  if (emails.length) attributes.emails = emails;
  if (phones.length) attributes.phones = phones;
  if (input.billingAddress) attributes.billingAddress = buildAddressAttributes(input.billingAddress);
  if (input.property) {
    attributes.properties = [{ address: buildAddressAttributes(input.property) }];
  }
  assertNoClientNotification(attributes);
  return attributes;
}

export function buildPropertyCreateInput(address: AddressInput): Record<string, unknown> {
  return { properties: [{ address: buildAddressAttributes(address) }] };
}

const DUPLICATE_WARNING =
  'A client with the same email or name already exists. Pass force=true to create another. Nothing was created.';

export async function createClient(
  input: CreateClientInput,
  deps?: JobberDeps
): Promise<CreateClientResult> {
  const seen = new Map<string, JobberClient>();
  const terms = [
    ...(input.emails || []).map((email) => email.address.trim()),
    `${input.firstName} ${input.lastName}`.trim(),
  ].filter(Boolean);

  if (!input.force) {
    for (const term of terms) {
      const found = await searchClients(term, deps);
      for (const client of found) {
        if (client?.id) seen.set(client.id, client);
      }
    }
    const matches = findClientDuplicates([...seen.values()], input);
    if (matches.length) {
      return {
        created: false,
        notified: false,
        client: null,
        matches,
        warning: DUPLICATE_WARNING,
      };
    }
  }

  const variables = { input: buildClientCreateInput(input) };
  const created = await graphql(CLIENT_CREATE, variables, deps);
  assertNoJobberErrors(created, 'clientCreate');
  const payload = created.data?.clientCreate;
  const errors = jobberUserErrors(payload);
  if (errors.length) throw new Error(errors.join('; '));
  const client = payload?.client as JobberClient | undefined;
  if (!client?.id) throw new Error('Jobber clientCreate returned no client');
  return { created: true, notified: false, client, matches: [] };
}

export async function createProperty(
  input: { clientId: string; address: AddressInput },
  deps?: JobberDeps
): Promise<{ id: string; address: Record<string, unknown> | null }> {
  const clientId = input.clientId.trim();
  if (!clientId) throw new Error('clientId is required');
  const variables = { clientId, input: buildPropertyCreateInput(input.address) };
  const created = await graphql(PROPERTY_CREATE, variables, deps);
  assertNoJobberErrors(created, 'propertyCreate');
  const payload = created.data?.propertyCreate;
  const errors = jobberUserErrors(payload);
  if (errors.length) throw new Error(errors.join('; '));
  const property = (payload?.properties || [])[0] as
    | { id?: string; address?: Record<string, unknown> | null }
    | undefined;
  if (!property?.id) throw new Error('Jobber propertyCreate returned no property');
  return { id: property.id, address: property.address ?? null };
}

function userName(node: UserNode): { full: string | null; first: string | null; last: string | null } {
  if (typeof node.name === 'string') {
    return { full: node.name, first: null, last: null };
  }
  return {
    full: node.name?.full ?? null,
    first: node.name?.first ?? null,
    last: node.name?.last ?? null,
  };
}

function userEmail(node: UserNode): string | null {
  if (!node.email) return null;
  if (typeof node.email === 'string') return node.email;
  return node.email.raw ?? null;
}

function summarizeUser(node: UserNode): JobberUserSummary | null {
  if (!node?.id) return null;
  const name = userName(node);
  return {
    id: node.id,
    name: name.full,
    firstName: name.first,
    lastName: name.last,
    email: userEmail(node),
    status: node.status ?? null,
  };
}

export function userMatchesQuery(user: JobberUserSummary, query: string | null | undefined): boolean {
  const needle = (query || '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [user.name, user.firstName, user.lastName, user.email].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(needle);
}

export async function listUsers(
  query: string | null | undefined,
  deps?: JobberDeps
): Promise<{ users: JobberUserSummary[]; truncated: boolean }> {
  const users: JobberUserSummary[] = [];
  let after: string | null = null;
  let truncated = false;
  let document = USERS;
  for (let page = 0; page < 4; page += 1) {
    let result = await graphql(document, { first: 50, after }, deps);
    if (result.errors?.length && document === USERS && /email/i.test(result.errors[0]?.message || '')) {
      document = USERS_NO_EMAIL;
      result = await graphql(document, { first: 50, after }, deps);
    }
    assertNoJobberErrors(result, 'users');
    const connection = result.data?.users;
    for (const node of (connection?.nodes || []) as UserNode[]) {
      const summary = summarizeUser(node);
      if (summary && userMatchesQuery(summary, query)) users.push(summary);
    }
    const pageInfo = connection?.pageInfo as { hasNextPage?: boolean; endCursor?: string | null } | undefined;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) {
      truncated = false;
      break;
    }
    after = pageInfo.endCursor;
    truncated = page === 3;
  }
  return { users, truncated };
}

export function propertyIds(client: JobberClient): string[] {
  return jobberClientProperties(client.properties).map((property) => property.id);
}
