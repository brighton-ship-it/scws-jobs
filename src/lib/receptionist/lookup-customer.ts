/**
 * Mike's lookupCustomer tool: find the caller in Jobber by phone and return
 * the address on file, so a "usual address" caller gets the real street and
 * town passed to checkServiceArea / checkSchedule (never the caller's name).
 */

import { getValidJobberAccessToken } from '../jobber/auth.ts';

export const LOOKUP_JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
const DEFAULT_VERSION = '2026-02-17';

export const SEARCH_CLIENTS_WITH_ADDRESS_QUERY = `
  query SearchClients($searchTerm: String!) {
    clients(searchTerm: $searchTerm, first: 5) {
      nodes {
        id
        name
        phones { number }
        billingAddress { street1 street2 city province postalCode }
        properties {
          address { street1 street2 city province postalCode }
        }
      }
    }
  }
`;

export type AddressOnFile = {
  street: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** "street, town" — ready to read back or pass to tools. */
  full: string;
};

export type LookupCustomerResult = {
  found: boolean;
  customerName?: string;
  address?: string;
  city?: string;
  zip?: string;
  addressOnFile?: AddressOnFile;
  /** Other properties on file (only when the client has more than one). */
  otherAddresses?: AddressOnFile[];
  addressRule?: string;
  message: string;
  error?: string;
};

export type LookupCustomerDeps = {
  fetchFn?: typeof fetch;
  accessToken?: string | null;
  graphqlVersion?: string;
};

type RawAddress = {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
} | null | undefined;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function toAddressOnFile(raw: RawAddress): AddressOnFile | null {
  if (!raw) return null;
  const street = [clean(raw.street1), clean(raw.street2)].filter(Boolean).join(' ');
  if (!street) return null;
  const city = clean(raw.city) || null;
  return {
    street,
    city,
    state: clean(raw.province) || null,
    zip: clean(raw.postalCode) || null,
    full: city ? `${street}, ${city}` : street,
  };
}

function addressesForClient(client: any): AddressOnFile[] {
  const out: AddressOnFile[] = [];
  const seen = new Set<string>();
  const push = (a: AddressOnFile | null) => {
    if (!a) return;
    const key = a.full.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  };
  const props = Array.isArray(client?.properties)
    ? client.properties
    : Array.isArray(client?.properties?.nodes)
      ? client.properties.nodes
      : [];
  for (const p of props) push(toAddressOnFile(p?.address));
  // Billing address only as a fallback when no service property is on file.
  if (!out.length) push(toAddressOnFile(client?.billingAddress));
  return out;
}

export const ADDRESS_ON_FILE_RULE =
  'If the caller says "usual", "same" or "my" address, use addressOnFile (street and city) for checkServiceArea, checkSchedule and book_job. Confirm it once: "Is this about [street], [town]?" Never use the caller\'s name as the town.';

export async function handleLookupCustomer(
  phone: string,
  deps: LookupCustomerDeps = {}
): Promise<{ result: LookupCustomerResult }> {
  const normalized = String(phone || '').replace(/\D/g, '').slice(-10);
  const notFound = {
    result: {
      found: false,
      message: "I don't see this number in our system yet - no problem! Can I get your name?",
    },
  };
  if (normalized.length < 10) return notFound;

  const token = deps.accessToken?.trim() || (await getValidJobberAccessToken());
  const fetchFn = deps.fetchFn ?? fetch;
  const version =
    deps.graphqlVersion ?? process.env.JOBBER_GRAPHQL_VERSION?.trim() ?? DEFAULT_VERSION;

  const response = await fetchFn(LOOKUP_JOBBER_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-JOBBER-GRAPHQL-VERSION': version,
    },
    body: JSON.stringify({
      query: SEARCH_CLIENTS_WITH_ADDRESS_QUERY,
      variables: { searchTerm: normalized.slice(-7) },
    }),
  });

  const data = (await response.json()) as any;
  if (data?.errors?.length && !data?.data?.clients) {
    throw new Error(data.errors[0]?.message || 'Jobber GraphQL error');
  }
  const clients = data?.data?.clients?.nodes || [];

  for (const client of clients) {
    for (const phoneObj of client.phones || []) {
      const clientPhone = String(phoneObj?.number || '').replace(/\D/g, '').slice(-10);
      if (clientPhone !== normalized) continue;

      const addresses = addressesForClient(client);
      const primary = addresses[0];
      const result: LookupCustomerResult = {
        found: true,
        customerName: client.name,
        message: `Welcome back, ${client.name}! I have your account pulled up. How can I help you today?`,
      };
      if (primary) {
        result.address = primary.street;
        if (primary.city) result.city = primary.city;
        if (primary.zip) result.zip = primary.zip;
        result.addressOnFile = primary;
        if (addresses.length > 1) result.otherAddresses = addresses.slice(1, 4);
        result.addressRule = ADDRESS_ON_FILE_RULE;
      }
      return { result };
    }
  }

  return notFound;
}
