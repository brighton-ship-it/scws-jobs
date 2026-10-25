/**
 * edit_property: update one Jobber property address with propertyEdit.
 *
 * Schema (public introspection, hightreequency/jobberschema jobberapischema.json,
 * extensions.versioning.version 2025-01-20). The gateway still sends
 * X-JOBBER-GRAPHQL-VERSION 2025-04-16. That changelog does not change
 * propertyEdit.
 *
 * Mutation.propertyEdit(propertyId: EncodedId!, input: PropertyEditInput!)
 * returns { property, userErrors }. PropertyEditInput is address
 * (AddressAttributes), customFields, and taxRateId. This module sends
 * address only. AddressAttributes fields are optional strings: street1,
 * street2, city, province, postalCode, country.
 *
 * Jobber has no property primary input. Property.isBillingAddress is
 * read-only. ClientEditInput.propertiesToEdit (PropertyEditAttributes) also
 * has no primary flag. clientEdit is not called, including billingAddress.
 *
 * The current property is read first. Supplied address fields are merged
 * onto that address so omitted fields stay. dryRun defaults to true and does
 * not call propertyEdit. Optional clientId is not a mutation argument; when
 * set, the property's client id must match or the tool refuses.
 *
 * Nothing emails, texts, or notifies the client.
 */
import { assertNoJobberErrors, jobberGraphql, jobberUserErrors } from './client.ts';
import { assertNoClientNotification, assertWriteDoesNotDeliver } from './mcp-notify.ts';
import type { JobberDeps } from './quotes.ts';

export const ADDRESS_FIELDS = ['street1', 'street2', 'city', 'province', 'postalCode', 'country'] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

export type PropertyAddress = Record<AddressField, string | null>;

export type EditPropertyInput = {
  propertyId: string;
  clientId: string | null;
  address: Partial<Record<AddressField, string>>;
  dryRun: boolean;
};

export type PropertyEditVariables = {
  propertyId: string;
  input: { address: Record<string, string> };
};

export type EditPropertyResult = {
  dryRun: boolean;
  mutated: boolean;
  status: 'would_update' | 'updated' | 'unchanged';
  mutation: 'propertyEdit';
  propertyId: string;
  clientId: string | null;
  isBillingAddress: boolean | null;
  before: PropertyAddress;
  after: PropertyAddress;
  would_update: PropertyEditVariables | null;
  input: PropertyEditVariables['input'] | null;
  notified: false;
};

const ARG_KEYS = new Set<string>(['propertyId', 'clientId', 'dryRun', 'primary', ...ADDRESS_FIELDS]);

const PROPERTY_READ = `
  query McpPropertyForEdit($id: EncodedId!) {
    property(id: $id) {
      id
      isBillingAddress
      street1
      street2
      city
      province
      postalCode
      country
      client { id }
      address { street1 street2 city province postalCode country }
    }
  }
`;

export const PROPERTY_EDIT_MUTATION = `
  mutation McpPropertyEdit($propertyId: EncodedId!, $input: PropertyEditInput!) {
    propertyEdit(propertyId: $propertyId, input: $input) {
      property { id }
      userErrors { message path }
    }
  }
`;

type PropertyNode = {
  id?: string | null;
  isBillingAddress?: boolean | null;
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  client?: { id?: string | null } | null;
  address?: Partial<Record<AddressField, string | null>> | null;
};

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function graphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  assertWriteDoesNotDeliver(query);
  assertNoClientNotification(variables);
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

export function parseEditPropertyArgs(args: Record<string, unknown>): EditPropertyInput {
  if ('primary' in args) {
    throw new Error(
      'Jobber propertyEdit has no primary flag. Property.isBillingAddress is read-only, and clientEdit.billingAddress is the client billing address, not a property primary. This tool only updates the property address.'
    );
  }
  const extra = Object.keys(args).filter((key) => !ARG_KEYS.has(key));
  if (extra.length) throw new Error(`Unsupported fields: ${extra.join(', ')}`);
  const propertyId = typeof args.propertyId === 'string' ? args.propertyId.trim() : '';
  if (!propertyId) throw new Error('propertyId is required');
  let clientId: string | null = null;
  if ('clientId' in args && args.clientId != null) {
    if (typeof args.clientId !== 'string' || !args.clientId.trim()) {
      throw new Error('clientId must be a non-empty string');
    }
    clientId = args.clientId.trim();
  }
  if ('dryRun' in args && args.dryRun != null && typeof args.dryRun !== 'boolean') {
    throw new Error('dryRun must be a boolean');
  }
  const address: Partial<Record<AddressField, string>> = {};
  for (const field of ADDRESS_FIELDS) {
    if (!(field in args) || args[field] == null) continue;
    if (typeof args[field] !== 'string') throw new Error(`${field} must be a string`);
    const trimmed = (args[field] as string).trim();
    if (!trimmed) throw new Error(`${field} cannot be empty`);
    address[field] = trimmed;
  }
  if (!Object.keys(address).length) {
    throw new Error(
      'At least one address field is required: street1, street2, city, province, postalCode, or country. Jobber has no property primary flag.'
    );
  }
  return { propertyId, clientId, address, dryRun: args.dryRun !== false };
}

export function propertyAddressFromNode(node: PropertyNode): PropertyAddress {
  const address: PropertyAddress = {
    street1: null,
    street2: null,
    city: null,
    province: null,
    postalCode: null,
    country: null,
  };
  for (const field of ADDRESS_FIELDS) {
    address[field] = textOrNull(node.address?.[field]) ?? textOrNull(node[field]);
  }
  return address;
}

export function mergePropertyAddress(
  before: PropertyAddress,
  patch: Partial<Record<AddressField, string>>
): PropertyAddress {
  const after: PropertyAddress = { ...before };
  for (const field of ADDRESS_FIELDS) {
    if (patch[field] !== undefined) after[field] = patch[field];
  }
  return after;
}

export function buildPropertyEditInput(address: PropertyAddress): { address: Record<string, string> } {
  const row: Record<string, string> = {};
  for (const field of ADDRESS_FIELDS) {
    const value = address[field];
    if (value) row[field] = value;
  }
  if (!Object.keys(row).length) throw new Error('propertyEdit address is empty');
  return { address: row };
}

function sameAddress(left: PropertyAddress, right: PropertyAddress): boolean {
  return ADDRESS_FIELDS.every((field) => left[field] === right[field]);
}

async function readProperty(propertyId: string, deps?: JobberDeps) {
  const result = await graphql(PROPERTY_READ, { id: propertyId }, deps);
  assertNoJobberErrors(result, 'property');
  const property = result.data?.property as PropertyNode | null | undefined;
  if (!property?.id) throw new Error(`Jobber property ${propertyId} not found`);
  return {
    id: property.id,
    clientId: textOrNull(property.client?.id),
    isBillingAddress: typeof property.isBillingAddress === 'boolean' ? property.isBillingAddress : null,
    address: propertyAddressFromNode(property),
  };
}

export async function editProperty(input: EditPropertyInput, deps?: JobberDeps): Promise<EditPropertyResult> {
  const before = await readProperty(input.propertyId, deps);
  if (input.clientId && before.clientId !== input.clientId) {
    throw new Error(
      `Property ${input.propertyId} belongs to client ${before.clientId || '(none)'}, not ${input.clientId}. propertyEdit was not called.`
    );
  }
  const after = mergePropertyAddress(before.address, input.address);
  const base = {
    mutation: 'propertyEdit' as const,
    propertyId: before.id,
    clientId: before.clientId,
    isBillingAddress: before.isBillingAddress,
    before: before.address,
    notified: false as const,
  };
  if (sameAddress(before.address, after)) {
    return {
      ...base,
      dryRun: input.dryRun,
      mutated: false,
      status: 'unchanged',
      after,
      would_update: null,
      input: null,
    };
  }
  const editInput = buildPropertyEditInput(after);
  const preview: PropertyEditVariables = { propertyId: before.id, input: editInput };
  if (input.dryRun) {
    return {
      ...base,
      dryRun: true,
      mutated: false,
      status: 'would_update',
      after,
      would_update: preview,
      input: editInput,
    };
  }
  const edited = await graphql(PROPERTY_EDIT_MUTATION, preview, deps);
  assertNoJobberErrors(edited, 'propertyEdit');
  const errors = jobberUserErrors(edited.data?.propertyEdit);
  if (errors.length) throw new Error(errors.join('; '));
  const fresh = await readProperty(input.propertyId, deps);
  return {
    ...base,
    clientId: fresh.clientId,
    isBillingAddress: fresh.isBillingAddress,
    dryRun: false,
    mutated: true,
    status: 'updated',
    after: fresh.address,
    would_update: null,
    input: editInput,
  };
}
