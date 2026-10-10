/**
 * Read-only Jobber queries for ads attribution.
 * Token refresh stays on the Production durable path inside jobberGraphql.
 * These functions never call the Jobber OAuth token endpoint themselves.
 */

import { assertNoJobberErrors, jobberGraphql, type JobberGraphqlOptions } from './client.ts';
import type { InvoiceAmountInput } from '../ads/invoice-value.ts';
import type { WonInvoiceInput } from '../ads/offline-import.ts';

export const ATTRIBUTION_INVOICES_QUERY = `
  query AttributionInvoices($first: Int!, $after: String) {
    invoices(first: $first, after: $after) {
      nodes {
        id
        invoiceStatus
        issuedDate
        createdAt
        amounts { subtotal total taxAmount }
        client {
          id
          emails { address }
          phones { number }
        }
        jobs(first: 5) {
          nodes { id }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const ATTRIBUTION_QUOTES_QUERY = `
  query AttributionQuotes($first: Int!) {
    quotes(first: $first) {
      nodes {
        id
        quoteStatus
        createdAt
        client {
          emails { address }
          phones { number }
        }
      }
    }
  }
`;

export const ATTRIBUTION_JOB_INVOICES_QUERY = `
  query AttributionJobInvoices($id: EncodedId!) {
    job(id: $id) {
      id
      invoices(first: 20) {
        nodes {
          id
          invoiceStatus
          issuedDate
          amounts { subtotal total taxAmount }
        }
      }
    }
  }
`;

export function assertAttributionQueryIsReadOnly(query: string): void {
  if (!/^\s*query\b/i.test(query)) {
    throw new Error('Jobber attribution query must be a read');
  }
  if (/\bmutation\b/i.test(query)) {
    throw new Error('Jobber attribution query must not mutate');
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function firstString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function amountsOf(record: Record<string, unknown> | null): InvoiceAmountInput['amounts'] {
  const amounts = asRecord(record?.amounts);
  if (!amounts) return null;
  const num = (key: string) => (typeof amounts[key] === 'number' ? (amounts[key] as number) : null);
  return { subtotal: num('subtotal'), total: num('total'), taxAmount: num('taxAmount') };
}

function contactOf(record: Record<string, unknown> | null): { phone: string | null; email: string | null } {
  const client = asRecord(record?.client);
  const phones = Array.isArray(client?.phones) ? client.phones : [];
  const emails = Array.isArray(client?.emails) ? client.emails : [];
  const phone = phones.map((entry) => firstString(asRecord(entry), 'number')).find(Boolean) ?? null;
  const email = emails.map((entry) => firstString(asRecord(entry), 'address')).find(Boolean) ?? null;
  return { phone, email };
}

export function mapInvoiceNode(node: unknown): WonInvoiceInput | null {
  const record = asRecord(node);
  if (!record) return null;
  const jobs = asRecord(record.jobs);
  const nodes = Array.isArray(jobs?.nodes) ? jobs.nodes : [];
  const contact = contactOf(record);
  return {
    id: firstString(record, 'id'),
    invoiceStatus: firstString(record, 'invoiceStatus'),
    issuedDate: firstString(record, 'issuedDate'),
    createdAt: firstString(record, 'createdAt'),
    amounts: amountsOf(record),
    jobIds: nodes.map((job) => firstString(asRecord(job), 'id')).filter((id): id is string => Boolean(id)),
    phone: contact.phone,
    email: contact.email,
  };
}

export function mapQuoteNode(node: unknown): { id: string; createdAt: string | null; phone: string | null; email: string | null } | null {
  const record = asRecord(node);
  const id = firstString(record, 'id');
  if (!id) return null;
  const contact = contactOf(record);
  return { id, createdAt: firstString(record, 'createdAt'), phone: contact.phone, email: contact.email };
}

export function mapJobInvoiceNodes(payload: unknown): InvoiceAmountInput[] {
  const job = asRecord(asRecord(payload)?.job);
  const invoices = asRecord(job?.invoices);
  const nodes = Array.isArray(invoices?.nodes) ? invoices.nodes : [];
  const mapped: InvoiceAmountInput[] = [];
  for (const node of nodes) {
    const record = asRecord(node);
    if (!record) continue;
    mapped.push({
      invoiceStatus: firstString(record, 'invoiceStatus'),
      issuedDate: firstString(record, 'issuedDate'),
      amounts: amountsOf(record),
    });
  }
  return mapped;
}

export async function fetchRecentInvoices(
  options?: JobberGraphqlOptions & { pageSize?: number; maxPages?: number }
): Promise<WonInvoiceInput[]> {
  assertAttributionQueryIsReadOnly(ATTRIBUTION_INVOICES_QUERY);
  const pageSize = options?.pageSize ?? 50;
  const maxPages = options?.maxPages ?? 8;
  const invoices: WonInvoiceInput[] = [];
  let after: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const result = await jobberGraphql(
      ATTRIBUTION_INVOICES_QUERY,
      { first: pageSize, after },
      options
    );
    assertNoJobberErrors(result, 'attribution invoices');
    const connection = asRecord(result.data?.invoices);
    const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
    for (const node of nodes) {
      const mapped = mapInvoiceNode(node);
      if (mapped) invoices.push(mapped);
    }
    const pageInfo = asRecord(connection?.pageInfo);
    if (!pageInfo?.hasNextPage || typeof pageInfo.endCursor !== 'string') break;
    after = pageInfo.endCursor;
  }

  return invoices;
}

export async function fetchRecentQuotes(
  options?: JobberGraphqlOptions & { first?: number }
): Promise<Array<{ id: string; createdAt: string | null; phone: string | null; email: string | null }>> {
  assertAttributionQueryIsReadOnly(ATTRIBUTION_QUOTES_QUERY);
  const result = await jobberGraphql(
    ATTRIBUTION_QUOTES_QUERY,
    { first: options?.first ?? 100 },
    options
  );
  assertNoJobberErrors(result, 'attribution quotes');
  const nodes = asRecord(result.data?.quotes)?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.map(mapQuoteNode).filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export async function fetchJobInvoiceAmounts(
  jobId: string,
  options?: JobberGraphqlOptions
): Promise<InvoiceAmountInput[]> {
  assertAttributionQueryIsReadOnly(ATTRIBUTION_JOB_INVOICES_QUERY);
  const result = await jobberGraphql(ATTRIBUTION_JOB_INVOICES_QUERY, { id: jobId }, options);
  assertNoJobberErrors(result, 'job invoices');
  return mapJobInvoiceNodes(result.data);
}
