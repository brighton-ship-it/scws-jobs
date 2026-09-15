/**
 * Tiny shared Jobber GraphQL client.
 * Receptionist / book_job call sites are not rewritten; recent-jobs imports this.
 */

import {
  getJobberOAuthCredentials,
  getValidJobberAccessToken,
  refreshJobberTokens,
} from './auth.ts';

export const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
export const DEFAULT_JOBBER_GRAPHQL_VERSION = '2025-04-16';

export function getJobberAccessToken(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  return env.JOBBER_ACCESS_TOKEN?.trim() || null;
}

export function jobberGraphqlVersion(
  env: NodeJS.ProcessEnv = process.env
): string {
  return env.JOBBER_GRAPHQL_VERSION?.trim() || DEFAULT_JOBBER_GRAPHQL_VERSION;
}

export function jobberHeaders(
  token: string,
  env: NodeJS.ProcessEnv = process.env
): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-JOBBER-GRAPHQL-VERSION': jobberGraphqlVersion(env),
  };
}

export type JobberGraphqlResult<T = any> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

export type JobberGraphqlOptions = {
  token?: string | null;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

async function readGraphqlJson<T>(response: Response): Promise<JobberGraphqlResult<T>> {
  try {
    return (await response.json()) as JobberGraphqlResult<T>;
  } catch {
    return {};
  }
}

export async function jobberGraphql<T = any>(
  query: string,
  variables: Record<string, unknown> = {},
  options?: JobberGraphqlOptions
): Promise<JobberGraphqlResult<T>> {
  const env = options?.env ?? process.env;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const authDeps = { env, fetchImpl };

  let token = await getValidJobberAccessToken({
    ...authDeps,
    token: options?.token,
  });

  const requestOnce = async (accessToken: string) => {
    const response = await fetchImpl(JOBBER_GRAPHQL_URL, {
      method: 'POST',
      headers: jobberHeaders(accessToken, env),
      body: JSON.stringify({ query, variables }),
    });
    const json = await readGraphqlJson<T>(response);
    return { response, json };
  };

  let { response, json } = await requestOnce(token);

  if (response.status === 401 && getJobberOAuthCredentials(env)) {
    token = (await refreshJobberTokens(authDeps)).accessToken;
    ({ response, json } = await requestOnce(token));
    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? 'Jobber GraphQL HTTP 401 after token refresh'
          : `Jobber GraphQL HTTP ${response.status}`
      );
    }
    return json;
  }

  if (!response.ok) {
    throw new Error(`Jobber GraphQL HTTP ${response.status}`);
  }

  return json;
}

export function jobberUserErrors(
  payload: { userErrors?: Array<{ message?: string; path?: unknown }> } | null | undefined
): string[] {
  return (payload?.userErrors ?? [])
    .map((error) => error.message?.trim())
    .filter((message): message is string => Boolean(message));
}

export function assertNoJobberErrors(
  result: JobberGraphqlResult,
  operation: string
): void {
  if (result.errors?.length) {
    throw new Error(result.errors[0]?.message || `${operation} Jobber GraphQL error`);
  }
}
