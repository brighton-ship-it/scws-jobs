import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOBBER_OAUTH_TOKEN_URL,
  getJobberOAuthCredentials,
  getValidJobberAccessToken,
  parseJobberTokenResponse,
  persistJobberTokens,
  refreshJobberTokens,
  resetJobberAuthCache,
} from './auth.ts';
import { fetchRecentlyUpdatedJobs } from './recent-jobs.ts';
import { JOBBER_GRAPHQL_URL, jobberGraphql } from './client.ts';

const NOW_MS = Date.parse('2026-09-15T16:00:00.000Z');

function oauthEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    JOBBER_ACCESS_TOKEN: 'stale-access',
    JOBBER_REFRESH_TOKEN: 'refresh-1',
    JOBBER_CLIENT_ID: 'client-id',
    JOBBER_CLIENT_SECRET: 'client-secret',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  resetJobberAuthCache();
});

describe('getJobberOAuthCredentials', () => {
  it('is null unless refresh token and client id/secret are all present', () => {
    assert.equal(getJobberOAuthCredentials({}), null);
    assert.equal(
      getJobberOAuthCredentials({
        JOBBER_CLIENT_ID: 'id',
        JOBBER_CLIENT_SECRET: 'secret',
      }),
      null
    );
    assert.deepEqual(getJobberOAuthCredentials(oauthEnv()), {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-1',
    });
  });
});

describe('parseJobberTokenResponse', () => {
  it('reads access, rotated refresh, and expires_in without requiring extras', () => {
    const tokens = parseJobberTokenResponse(
      { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 },
      { nowMs: NOW_MS }
    );
    assert.equal(tokens.accessToken, 'access-2');
    assert.equal(tokens.refreshToken, 'refresh-2');
    assert.equal(tokens.expiresAtMs, NOW_MS + 3600 * 1000);
  });

  it('keeps the previous refresh token when Jobber omits a rotation', () => {
    const tokens = parseJobberTokenResponse(
      { access_token: 'access-2', expires_in: 1800 },
      { nowMs: NOW_MS, previousRefreshToken: 'refresh-1' }
    );
    assert.equal(tokens.refreshToken, 'refresh-1');
    assert.equal(tokens.expiresAtMs, NOW_MS + 1800 * 1000);
  });

  it('fails clearly without echoing payload fields', () => {
    assert.throws(
      () => parseJobberTokenResponse({ error: 'invalid_grant', hint: 'leaked-secret-value' }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /no access_token/);
        assert.equal(error.message.includes('leaked-secret-value'), false);
        return true;
      }
    );
  });
});

describe('refreshJobberTokens', () => {
  it('exchanges the refresh token and persists access + rotated refresh', async () => {
    const env = oauthEnv();
    let tokenCalls = 0;

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      tokenCalls += 1;
      assert.equal(String(input), JOBBER_OAUTH_TOKEN_URL);
      assert.equal(init?.method, 'POST');
      const body = String(init?.body || '');
      assert.match(body, /grant_type=refresh_token/);
      assert.match(body, /refresh_token=refresh-1/);
      assert.match(body, /client_id=client-id/);
      return jsonResponse({
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        expires_in: 3600,
      });
    }) as typeof fetch;

    const tokens = await refreshJobberTokens({ env, fetchImpl, nowMs: NOW_MS });
    assert.equal(tokenCalls, 1);
    assert.equal(tokens.accessToken, 'access-2');
    assert.equal(tokens.refreshToken, 'refresh-2');
    assert.equal(env.JOBBER_ACCESS_TOKEN, 'access-2');
    assert.equal(env.JOBBER_REFRESH_TOKEN, 'refresh-2');
    assert.equal(getJobberOAuthCredentials(env)?.refreshToken, 'refresh-2');
  });

  it('throws HTTP status only when refresh fails — no token values', async () => {
    const env = oauthEnv();
    const fetchImpl = (async () =>
      jsonResponse(
        {
          error: 'invalid_grant',
          error_description: 'do-not-log-this-refresh-token',
          access_token: 'should-not-appear',
        },
        400
      )) as typeof fetch;

    await assert.rejects(
      () => refreshJobberTokens({ env, fetchImpl }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Jobber OAuth token refresh failed (HTTP 400)');
        assert.equal(error.message.includes('do-not-log-this-refresh-token'), false);
        assert.equal(error.message.includes('should-not-appear'), false);
        assert.equal(error.message.includes('refresh-1'), false);
        return true;
      }
    );
  });
});

describe('getValidJobberAccessToken', () => {
  it('refreshes when token age is unknown instead of trusting the env access token', async () => {
    const env = oauthEnv();
    const fetchImpl = (async () =>
      jsonResponse({
        access_token: 'access-fresh',
        refresh_token: 'refresh-2',
        expires_in: 3600,
      })) as typeof fetch;

    const stale = env.JOBBER_ACCESS_TOKEN;
    const token = await getValidJobberAccessToken({ env, fetchImpl, nowMs: NOW_MS });
    assert.equal(token, 'access-fresh');
    assert.equal(stale, 'stale-access');
    assert.notEqual(token, stale);
  });

  it('reuses a warm-lambda cache without calling OAuth again', async () => {
    persistJobberTokens(
      {
        accessToken: 'cached-access',
        refreshToken: 'refresh-2',
        expiresAtMs: NOW_MS + 50 * 60 * 1000,
      },
      oauthEnv()
    );

    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new Error('OAuth should not run while the cached token is fresh');
    }) as typeof fetch;

    const token = await getValidJobberAccessToken({
      env: oauthEnv(),
      fetchImpl,
      nowMs: NOW_MS,
    });
    assert.equal(token, 'cached-access');
    assert.equal(calls, 0);
  });

  it('keeps the existing JOBBER_ACCESS_TOKEN error when refresh is not configured', async () => {
    await assert.rejects(
      () => getValidJobberAccessToken({ env: {} }),
      /JOBBER_ACCESS_TOKEN is not set/
    );
  });
});

describe('jobberGraphql 401 retry', () => {
  it('refreshes once after GraphQL HTTP 401 and retries the request', async () => {
    const env = oauthEnv();
    const urls: string[] = [];
    const authHeaders: string[] = [];

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (url === JOBBER_OAUTH_TOKEN_URL) {
        return jsonResponse({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expires_in: 3600,
        });
      }
      assert.equal(url, JOBBER_GRAPHQL_URL);
      const headers = new Headers(init?.headers);
      authHeaders.push(headers.get('authorization') || '');
      if (headers.get('authorization') === 'Bearer stale-access') {
        return jsonResponse({ errors: [{ message: 'Unauthorized' }] }, 401);
      }
      assert.equal(headers.get('authorization'), 'Bearer access-2');
      return jsonResponse({ data: { ok: true } });
    }) as typeof fetch;

    const result = await jobberGraphql(
      'query { ok }',
      {},
      { token: 'stale-access', env, fetchImpl }
    );

    assert.deepEqual(result, { data: { ok: true } });
    assert.deepEqual(urls, [JOBBER_GRAPHQL_URL, JOBBER_OAUTH_TOKEN_URL, JOBBER_GRAPHQL_URL]);
    assert.deepEqual(authHeaders, ['Bearer stale-access', 'Bearer access-2']);
    assert.equal(env.JOBBER_ACCESS_TOKEN, 'access-2');
    assert.equal(env.JOBBER_REFRESH_TOKEN, 'refresh-2');
  });

  it('fails clearly when GraphQL is still 401 after the single refresh retry', async () => {
    const env = oauthEnv();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input) === JOBBER_OAUTH_TOKEN_URL) {
        return jsonResponse({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expires_in: 3600,
        });
      }
      return jsonResponse({}, 401);
    }) as typeof fetch;

    await assert.rejects(
      () => jobberGraphql('query { ok }', {}, { token: 'stale-access', env, fetchImpl }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Jobber GraphQL HTTP 401 after token refresh');
        assert.equal(error.message.includes('access-2'), false);
        assert.equal(error.message.includes('refresh-2'), false);
        return true;
      }
    );
  });
});

describe('fetchRecentlyUpdatedJobs', () => {
  it('does not send the invalid updatedAt JobFilterAttributes field', async () => {
    const now = new Date('2026-09-15T16:00:00.000Z');
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as {
        query?: string;
        variables?: Record<string, unknown>;
      };
      assert.equal((body.query || '').includes('updatedAt:'), false);
      assert.equal((body.query || '').includes('JobFilterAttributes'), false);
      assert.equal('updatedAfter' in (body.variables || {}), false);
      return jsonResponse({
        data: {
          jobs: {
            nodes: [
              {
                id: 'fresh',
                updatedAt: '2026-09-15T15:40:00.000Z',
                createdAt: '2026-09-15T15:40:00.000Z',
              },
              {
                id: 'stale',
                updatedAt: '2026-09-14T16:00:00.000Z',
                createdAt: '2026-09-14T16:00:00.000Z',
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    }) as typeof fetch;

    const jobs = await fetchRecentlyUpdatedJobs({
      token: 'test',
      fetchImpl,
      now,
      lookbackMs: 45 * 60 * 1000,
    });
    assert.deepEqual(
      jobs.map((job) => job.id),
      ['fresh']
    );
  });
});
