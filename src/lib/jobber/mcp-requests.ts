/**
 * Read-only Jobber request lookups.
 *
 * requests(searchTerm, filter, first, after) and request(id) were present on
 * the public introspection at API version 2025-01-20. The gateway pin stays
 * 2025-04-16. No mutations live here.
 */

import {
  assertNoJobberErrors,
  jobberGraphql,
  type JobberGraphqlResult,
} from './client.ts';
import type { JobberDeps } from './quotes.ts';

export const MCP_REQUEST_PAGE_SIZE = 15;
export const MCP_REQUEST_MAX_PAGE_SIZE = 25;

const READ_ONLY = /\bmutation\b|requestCreate|requestEdit|assessmentCreate|requestCreateNote/i;

const REQUEST_NODE = `
  id
  title
  requestStatus
  createdAt
  jobberWebUri
  isScheduled
  client { id name firstName lastName companyName }
  property { id address { street1 city province postalCode } }
  assessment {
    id
    startAt
    endAt
    instructions
    assignedUsers(first: 8) { nodes { id name { full } } }
  }
`;

const REQUEST_NODE_NO_ASSIGNEES = `
  id
  title
  requestStatus
  createdAt
  jobberWebUri
  isScheduled
  client { id name firstName lastName companyName }
  property { id address { street1 city province postalCode } }
  assessment { id startAt endAt instructions }
`;

const REQUEST_NODE_BARE = `
  id
  title
  requestStatus
  createdAt
  jobberWebUri
  isScheduled
  client { id name firstName lastName companyName }
  property { id address { street1 city province postalCode } }
`;

type RequestShape = 'full' | 'noAssignees' | 'bare';

const SHAPES: RequestShape[] = ['full', 'noAssignees', 'bare'];

function fieldsFor(shape: RequestShape): string {
  if (shape === 'full') return REQUEST_NODE;
  if (shape === 'noAssignees') return REQUEST_NODE_NO_ASSIGNEES;
  return REQUEST_NODE_BARE;
}

function graphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  if (READ_ONLY.test(query)) throw new Error('Request search is read-only');
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

function errorText(result: JobberGraphqlResult): string {
  return (result.errors || []).map((error) => error.message || '').join(' ');
}

export function pageSize(first?: number): number {
  const n = first ?? MCP_REQUEST_PAGE_SIZE;
  if (!Number.isFinite(n) || n < 1) return MCP_REQUEST_PAGE_SIZE;
  return Math.min(Math.floor(n), MCP_REQUEST_MAX_PAGE_SIZE);
}

export type RequestAssignee = { id: string | null; name: string | null };

export type RequestSummary = {
  id: string;
  title: string | null;
  requestStatus: string | null;
  createdAt: string | null;
  jobberWebUri: string | null;
  isScheduled: boolean | null;
  client: { id: string | null; name: string | null } | null;
  property: { id: string | null; city: string | null; street1: string | null } | null;
  assessment: {
    id: string | null;
    startAt: string | null;
    endAt: string | null;
    instructions: string | null;
    assignees: RequestAssignee[];
  } | null;
};

export type SearchRequestsInput = {
  query?: string | null;
  clientId?: string | null;
  status?: string | null;
  first?: number;
  after?: string | null;
};

export type SearchRequestsResult = {
  requests: RequestSummary[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

type RequestNode = {
  id?: string | null;
  title?: string | null;
  requestStatus?: string | null;
  createdAt?: string | null;
  jobberWebUri?: string | null;
  isScheduled?: boolean | null;
  client?: { id?: string | null; name?: string | null; firstName?: string | null; lastName?: string | null } | null;
  property?: {
    id?: string | null;
    address?: { street1?: string | null; city?: string | null } | null;
  } | null;
  assessment?: {
    id?: string | null;
    startAt?: string | null;
    endAt?: string | null;
    instructions?: string | null;
    assignedUsers?: { nodes?: Array<{ id?: string | null; name?: { full?: string | null } | null } | null> | null } | null;
  } | null;
};

export function summarizeRequest(node: RequestNode | null | undefined): RequestSummary | null {
  if (!node?.id) return null;
  const clientName =
    node.client?.name ||
    [node.client?.firstName, node.client?.lastName].filter(Boolean).join(' ') ||
    null;
  const assignees = (node.assessment?.assignedUsers?.nodes || [])
    .filter((user): user is NonNullable<typeof user> => Boolean(user?.id || user?.name))
    .map((user) => ({
      id: user.id ?? null,
      name: user.name?.full ?? null,
    }));
  return {
    id: node.id,
    title: node.title ?? null,
    requestStatus: node.requestStatus ?? null,
    createdAt: node.createdAt ?? null,
    jobberWebUri: node.jobberWebUri ?? null,
    isScheduled: typeof node.isScheduled === 'boolean' ? node.isScheduled : null,
    client: node.client?.id ? { id: node.client.id, name: clientName } : node.client ? { id: null, name: clientName } : null,
    property: node.property
      ? {
          id: node.property.id ?? null,
          city: node.property.address?.city ?? null,
          street1: node.property.address?.street1 ?? null,
        }
      : null,
    assessment: node.assessment?.id
      ? {
          id: node.assessment.id,
          startAt: node.assessment.startAt ?? null,
          endAt: node.assessment.endAt ?? null,
          instructions: node.assessment.instructions ?? null,
          assignees,
        }
      : null,
  };
}

const REQUEST_STATUSES = new Set([
  'new',
  'completed',
  'converted',
  'archived',
  'upcoming',
  'overdue',
  'unscheduled',
  'assessment_completed',
  'today',
]);

export function normalizeRequestStatus(status: string | null | undefined): string | undefined {
  const normalized = (status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized || normalized === 'all') return undefined;
  if (!REQUEST_STATUSES.has(normalized)) {
    throw new Error(
      `status must be one of ${[...REQUEST_STATUSES].join(', ')} (or all)`
    );
  }
  return normalized;
}

function searchDocument(shape: RequestShape, withFilter: boolean): string {
  const filterDecl = withFilter ? ', $filter: RequestFilterAttributes' : '';
  const filterArg = withFilter ? ', filter: $filter' : '';
  return `
    query McpRequestsSearch($searchTerm: String, $first: Int!, $after: String${filterDecl}) {
      requests(searchTerm: $searchTerm, first: $first, after: $after${filterArg}) {
        nodes { ${fieldsFor(shape)} }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
}

function byIdDocument(shape: RequestShape): string {
  return `
    query McpRequestById($id: EncodedId!) {
      request(id: $id) { ${fieldsFor(shape)} }
    }
  `;
}

async function queryWithFallback(
  build: (shape: RequestShape) => string,
  variables: Record<string, unknown>,
  deps: JobberDeps | undefined
): Promise<JobberGraphqlResult> {
  let lastError = 'Jobber request query failed';
  for (const shape of SHAPES) {
    const result = await graphql(build(shape), variables, deps);
    if (!result.errors?.length) return result;
    lastError = errorText(result) || lastError;
  }
  throw new Error(lastError);
}

export async function searchRequests(
  input: SearchRequestsInput,
  deps?: JobberDeps
): Promise<SearchRequestsResult> {
  const filter: Record<string, unknown> = {};
  const clientId = input.clientId?.trim();
  if (clientId) filter.clientId = clientId;
  const status = normalizeRequestStatus(input.status);
  if (status) filter.status = status;
  const withFilter = Object.keys(filter).length > 0;
  const variables: Record<string, unknown> = {
    searchTerm: input.query?.trim() || null,
    first: pageSize(input.first),
    after: input.after?.trim() || null,
  };
  if (withFilter) variables.filter = filter;
  const result = await queryWithFallback((shape) => searchDocument(shape, withFilter), variables, deps);
  assertNoJobberErrors(result, 'requests');
  const pageInfo = result.data?.requests?.pageInfo as
    | { hasNextPage?: boolean; endCursor?: string | null }
    | undefined;
  const nodes = (result.data?.requests?.nodes || []) as RequestNode[];
  return {
    requests: nodes.map(summarizeRequest).filter((row): row is RequestSummary => Boolean(row)),
    pageInfo: {
      hasNextPage: Boolean(pageInfo?.hasNextPage),
      endCursor: pageInfo?.endCursor ?? null,
    },
  };
}

export async function getRequest(requestId: string, deps?: JobberDeps): Promise<RequestSummary> {
  const id = requestId.trim();
  if (!id) throw new Error('requestId is required');
  const result = await queryWithFallback(byIdDocument, { id }, deps);
  assertNoJobberErrors(result, 'request');
  const summary = summarizeRequest((result.data?.request || null) as RequestNode | null);
  if (!summary) throw new Error(`Jobber request ${id} not found`);
  return summary;
}
