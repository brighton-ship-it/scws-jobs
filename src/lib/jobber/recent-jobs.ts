/**
 * Read-only Jobber GraphQL helper for recently updated jobs.
 * Does not touch receptionist / vendor / Sarah code.
 */

export const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
export const DEFAULT_JOBBER_GRAPHQL_VERSION = '2025-04-16';
export const JOB_POLL_LOOKBACK_MS = 45 * 60 * 1000;

export interface JobberJobNode {
  id: string;
  jobNumber?: number | null;
  jobStatus?: string | null;
  startAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  total?: number | null;
  client?: {
    id?: string;
    emails?: Array<{ address?: string | null } | null> | null;
    phones?: Array<{ number?: string | null } | null> | null;
  } | null;
  visits?: { nodes?: Array<{ startAt?: string | null } | null> | null } | null;
}

const RECENT_JOBS_QUERY = `
  query RecentlyUpdatedJobs($first: Int!, $after: String, $updatedAfter: ISO8601DateTime!) {
    jobs(first: $first, after: $after, filter: { updatedAt: { after: $updatedAfter } }) {
      nodes {
        id
        jobNumber
        jobStatus
        startAt
        createdAt
        updatedAt
        total
        client {
          id
          emails { address }
          phones { number }
        }
        visits(first: 5) {
          nodes { startAt }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const FALLBACK_JOBS_QUERY = `
  query RecentJobsFallback($first: Int!, $after: String) {
    jobs(first: $first, after: $after) {
      nodes {
        id
        jobNumber
        jobStatus
        startAt
        createdAt
        updatedAt
        total
        client {
          id
          emails { address }
          phones { number }
        }
        visits(first: 5) {
          nodes { startAt }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export function getJobberAccessToken(): string | null {
  return process.env.JOBBER_ACCESS_TOKEN?.trim() || null;
}

function jobberHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-JOBBER-GRAPHQL-VERSION':
      process.env.JOBBER_GRAPHQL_VERSION?.trim() || DEFAULT_JOBBER_GRAPHQL_VERSION,
  };
}

async function jobberGraphql(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<{ data?: any; errors?: Array<{ message?: string }> }> {
  const response = await fetchImpl(JOBBER_GRAPHQL_URL, {
    method: 'POST',
    headers: jobberHeaders(token),
    body: JSON.stringify({ query, variables }),
  });

  const json = (await response.json()) as {
    data?: any;
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok) {
    throw new Error(`Jobber GraphQL HTTP ${response.status}`);
  }

  return json;
}

export async function fetchRecentlyUpdatedJobs(options?: {
  lookbackMs?: number;
  now?: Date;
  pageSize?: number;
  maxPages?: number;
  fetchImpl?: typeof fetch;
  token?: string | null;
}): Promise<JobberJobNode[]> {
  const token = options?.token ?? getJobberAccessToken();
  if (!token) {
    throw new Error('JOBBER_ACCESS_TOKEN is not set');
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  const now = options?.now ?? new Date();
  const lookbackMs = options?.lookbackMs ?? JOB_POLL_LOOKBACK_MS;
  const updatedAfter = new Date(now.getTime() - lookbackMs).toISOString();
  const pageSize = options?.pageSize ?? 50;
  const maxPages = options?.maxPages ?? 4;

  const jobs: JobberJobNode[] = [];
  let after: string | null = null;
  let useFallback = false;

  for (let page = 0; page < maxPages; page++) {
    const result = await jobberGraphql(
      token,
      useFallback ? FALLBACK_JOBS_QUERY : RECENT_JOBS_QUERY,
      useFallback
        ? { first: pageSize, after }
        : { first: pageSize, after, updatedAfter },
      fetchImpl
    );

    if (result.errors?.length && !useFallback && page === 0) {
      console.warn(
        '[book_job] Jobber updatedAt filter failed; falling back to recent jobs page',
        result.errors[0]?.message
      );
      useFallback = true;
      page -= 1;
      continue;
    }

    if (result.errors?.length) {
      throw new Error(result.errors[0]?.message || 'Jobber GraphQL error');
    }

    const connection = result.data?.jobs;
    const nodes = (connection?.nodes ?? []) as JobberJobNode[];
    jobs.push(...nodes);

    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) {
      break;
    }
    after = connection.pageInfo.endCursor;
  }

  if (useFallback) {
    const cutoff = now.getTime() - lookbackMs;
    return jobs.filter((job) => {
      const stamp = Date.parse(job.updatedAt || job.createdAt || '');
      return Number.isFinite(stamp) && stamp >= cutoff;
    });
  }

  return jobs;
}
