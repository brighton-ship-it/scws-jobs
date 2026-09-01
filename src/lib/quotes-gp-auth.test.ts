import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUOTES_GP_KEY_COOKIE,
  QUOTES_GP_KEY_HEADER,
  authorizeQuotesGpKey,
  getQuotesGpSecret,
  keyMatchesQuotesGpSecret,
  readQuotesGpKey,
} from './quotes-gp-auth.ts';

function headers(init?: Record<string, string>): Headers {
  return new Headers(init);
}

describe('getQuotesGpSecret', () => {
  it('prefers QUOTES_GP_KEY over ADMIN_SECRET', () => {
    assert.equal(getQuotesGpSecret({}), null);
    assert.equal(getQuotesGpSecret({ QUOTES_GP_KEY: '  office  ' }), 'office');
    assert.equal(
      getQuotesGpSecret({ QUOTES_GP_KEY: 'office', ADMIN_SECRET: 'admin' }),
      'office'
    );
    assert.equal(getQuotesGpSecret({ ADMIN_SECRET: 'admin' }), 'admin');
  });
});

describe('readQuotesGpKey', () => {
  it('reads header, bearer, query, then cookie', () => {
    assert.equal(
      readQuotesGpKey({ headers: headers({ [QUOTES_GP_KEY_HEADER]: 'from-header' }) }),
      'from-header'
    );
    assert.equal(
      readQuotesGpKey({ headers: headers({ authorization: 'Bearer from-bearer' }) }),
      'from-bearer'
    );
    assert.equal(
      readQuotesGpKey({
        headers: headers(),
        url: 'https://jobs.example/ops/quotes-gp?key=from-query',
      }),
      'from-query'
    );
    assert.equal(
      readQuotesGpKey(
        { headers: headers() },
        { get: (name) => (name === QUOTES_GP_KEY_COOKIE ? { value: 'from-cookie' } : undefined) }
      ),
      'from-cookie'
    );
  });
});

describe('authorizeQuotesGpKey', () => {
  const env = { QUOTES_GP_KEY: 'secret-office' };

  it('accepts a matching key and rejects a miss or empty secret', () => {
    assert.equal(keyMatchesQuotesGpSecret('secret-office', env), true);
    assert.equal(keyMatchesQuotesGpSecret('nope', env), false);
    assert.deepEqual(
      authorizeQuotesGpKey(
        { headers: headers({ [QUOTES_GP_KEY_HEADER]: 'secret-office' }) },
        { env }
      ),
      { ok: true, via: 'key' }
    );
    assert.deepEqual(
      authorizeQuotesGpKey({ headers: headers({ [QUOTES_GP_KEY_HEADER]: 'wrong' }) }, { env }),
      { ok: false, reason: 'unauthorized' }
    );
    assert.deepEqual(
      authorizeQuotesGpKey({ headers: headers() }, { env: {} }),
      { ok: false, reason: 'unauthorized' }
    );
  });
});
