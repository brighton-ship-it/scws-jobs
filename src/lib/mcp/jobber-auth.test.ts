import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeJobberMcpRequest,
  matchJobberMcpApiKey,
  parseJobberMcpApiKeys,
  readMcpBearerToken,
} from './jobber-auth.ts';

function headers(init?: Record<string, string>): Headers {
  return new Headers(init);
}

describe('parseJobberMcpApiKeys', () => {
  it('is empty when the env var is missing or blank', () => {
    assert.deepEqual(parseJobberMcpApiKeys({}), []);
    assert.deepEqual(parseJobberMcpApiKeys({ JOBBER_MCP_API_KEYS: '   ' }), []);
  });

  it('reads a JSON map of named keys', () => {
    assert.deepEqual(
      parseJobberMcpApiKeys({
        JOBBER_MCP_API_KEYS: '{"travis":" trav-key ","damien":"dam-key"}',
      }),
      [
        { name: 'travis', key: 'trav-key' },
        { name: 'damien', key: 'dam-key' },
      ]
    );
  });

  it('reads named CSV pairs and bare keys', () => {
    assert.deepEqual(
      parseJobberMcpApiKeys({ JOBBER_MCP_API_KEYS: 'travis:trav-key,damien:dam-key' }),
      [
        { name: 'travis', key: 'trav-key' },
        { name: 'damien', key: 'dam-key' },
      ]
    );
    assert.deepEqual(parseJobberMcpApiKeys({ JOBBER_MCP_API_KEYS: 'solo-key,second-key' }), [
      { name: 'key-1', key: 'solo-key' },
      { name: 'key-2', key: 'second-key' },
    ]);
  });
});

describe('readMcpBearerToken', () => {
  it('reads Bearer from Authorization and recovered platform headers', () => {
    assert.equal(readMcpBearerToken(headers({ authorization: 'Bearer shop-key' })), 'shop-key');
    assert.equal(
      readMcpBearerToken(
        headers({
          'x-vercel-sc-headers': JSON.stringify({ Authorization: 'Bearer recovered-key' }),
        })
      ),
      'recovered-key'
    );
    assert.equal(readMcpBearerToken(headers()), null);
    assert.equal(readMcpBearerToken(headers({ authorization: 'Basic nope' })), null);
  });
});

describe('authorizeJobberMcpRequest', () => {
  const env = { JOBBER_MCP_API_KEYS: '{"travis":"trav-secret","brighton":"office-secret"}' };

  it('401s when no keys are configured — never public without a secret', () => {
    assert.deepEqual(authorizeJobberMcpRequest({ headers: headers({ authorization: 'Bearer x' }) }, {}), {
      ok: false,
      reason: 'missing_secret',
    });
  });

  it('401s when the Bearer key is missing or wrong', () => {
    assert.deepEqual(authorizeJobberMcpRequest({ headers: headers() }, env), {
      ok: false,
      reason: 'missing_key',
    });
    assert.deepEqual(
      authorizeJobberMcpRequest({ headers: headers({ authorization: 'Bearer nope' }) }, env),
      { ok: false, reason: 'unauthorized' }
    );
  });

  it('accepts a matching named key and returns the client name, not the secret', () => {
    assert.deepEqual(
      authorizeJobberMcpRequest({ headers: headers({ authorization: 'Bearer trav-secret' }) }, env),
      { ok: true, name: 'travis' }
    );
    assert.deepEqual(
      authorizeJobberMcpRequest({ headers: headers({ authorization: 'Bearer office-secret' }) }, env),
      { ok: true, name: 'brighton' }
    );
    assert.equal(matchJobberMcpApiKey('trav-secret', env)?.name, 'travis');
    assert.equal(matchJobberMcpApiKey('trav-secret', env)?.key, 'trav-secret');
  });
});
