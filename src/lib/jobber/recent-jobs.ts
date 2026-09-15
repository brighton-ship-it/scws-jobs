/**
 * Read-only Jobber GraphQL helper for recently updated jobs.
 * Does not touch receptionist / vendor / Sarah code.
 *
 * JobFilterAttributes has no updatedAt field, so we page recent jobs
 * and apply the lookback cutoff on updatedAt/createdAt in this process.
 */

import {
  DEFAULT_JOBBER_GRAPHQL_VERSION,
  JOBBER_GRAPHQL_URL,
  getJobberAccessToken,
  jobberGraphql,
} from './client.ts';
import { getJobberOAuthCredentials } from './auth.ts';

export { DEFAULT_JOBBER_GRAPHQL_VERSION, JOBBER_GRAPHQL_URL, getJobberAccessToken };

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
  query RecentJobs($first: Int!, $after: String) {
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

export async function fetchRecentlyUpdatedJobs(options?: {
  lookbackMs?: number;
  now?: Date;
  pageSize?: number;
  maxPages?: number;
  fetchImpl?: typeof fetch;
  token?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<JobberJobNode[]> {
  const env = options?.env ?? process.env;
  if (!options?.token && !getJobberAccessToken(env) && !getJobberOAuthCredentials(env)) {
    throw new Error('JOBBER_ACCESS_TOKEN is not set');
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  const now = options?.now ?? new Date();
  const lookbackMs = options?.lookbackMs ?? JOB_POLL_LOOKBACK_MS;
  const pageSize = options?.pageSize ?? 50;
  const maxPages = options?.maxPages ?? 4;

  const jobs: JobberJobNode[] = [];
  let after: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const result = await jobberGraphql(
      RECENT_JOBS_QUERY,
      { first: pageSize, after },
      { token: options?.token, fetchImpl, env }
    );

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

  const cutoff = now.getTime() - lookbackMs;
  return jobs.filter((job) => {
    const stamp = Date.parse(job.updatedAt || job.createdAt || '');
    return Number.isFinite(stamp) && stamp >= cutoff;
  });
}
