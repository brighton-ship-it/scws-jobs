/**
 * Tiny shared Jobber GraphQL client.
 * Receptionist / book_job call sites are not rewritten; recent-jobs imports this.
 */

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

export async function jobberGraphql<T = any>(
  query: string,
  variables: Record<string, unknown> = {},
  options?: {
    token?: string | null;
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
  }
): Promise<JobberGraphqlResult<T>> {
  const env = options?.env ?? process.env;
  const token = options?.token ?? getJobberAccessToken(env);
  if (!token) {
    throw new Error('JOBBER_ACCESS_TOKEN is not set');
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  const response = await fetchImpl(JOBBER_GRAPHQL_URL, {
    method: 'POST',
    headers: jobberHeaders(token, env),
    body: JSON.stringify({ query, variables }),
  });

  const json = (await response.json()) as JobberGraphqlResult<T>;

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
