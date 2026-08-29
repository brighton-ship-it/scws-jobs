import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeCronRequest,
  getCronSecret,
  isVercelCronRequest,
  readAuthorizationHeader,
} from './cron-auth.ts';

function headers(init?: Record<string, string>): Headers {
  return new Headers(init);
}

describe('getCronSecret', () => {
  it('returns null when missing or blank', () => {
    assert.equal(getCronSecret({}), null);
    assert.equal(getCronSecret({ CRON_SECRET: '' }), null);
    assert.equal(getCronSecret({ CRON_SECRET: '   ' }), null);
  });

  it('trims whitespace from the Production env value', () => {
    assert.equal(getCronSecret({ CRON_SECRET: ' secret-value \n' }), 'secret-value');
  });
});

describe('isVercelCronRequest', () => {
  it('detects x-vercel-cron and x-vercel-cron-schedule', () => {
    assert.equal(isVercelCronRequest(headers()), false);
    assert.equal(isVercelCronRequest(headers({ 'x-vercel-cron': '1' })), true);
    assert.equal(isVercelCronRequest(headers({ 'x-vercel-cron-schedule': '*/15 * * * *' })), true);
  });
});

describe('readAuthorizationHeader', () => {
  it('reads Authorization directly', () => {
    assert.equal(
      readAuthorizationHeader(headers({ authorization: 'Bearer abc' })),
      'Bearer abc'
    );
  });

  it('recovers Authorization from x-vercel-sc-headers', () => {
    assert.equal(
      readAuthorizationHeader(
        headers({
          'x-vercel-sc-headers': JSON.stringify({ Authorization: 'Bearer recovered' }),
        })
      ),
      'Bearer recovered'
    );
  });
});

describe('authorizeCronRequest', () => {
  it('401s when CRON_SECRET is missing — never public without a secret', () => {
    const request = { headers: headers({ 'x-vercel-cron': '1', authorization: 'Bearer anything' }) };
    assert.deepEqual(authorizeCronRequest(request, {}), { ok: false, reason: 'missing_secret' });
  });

  it('accepts Authorization: Bearer ${CRON_SECRET}', () => {
    const request = { headers: headers({ authorization: 'Bearer prod-secret' }) };
    assert.deepEqual(authorizeCronRequest(request, { CRON_SECRET: 'prod-secret' }), { ok: true });
  });

  it('accepts a real Vercel Cron (x-vercel-cron) when CRON_SECRET exists', () => {
    const request = { headers: headers({ 'x-vercel-cron': '1' }) };
    assert.deepEqual(authorizeCronRequest(request, { CRON_SECRET: 'prod-secret' }), { ok: true });
  });

  it('accepts Bearer recovered from x-vercel-sc-headers', () => {
    const request = {
      headers: headers({
        'x-vercel-sc-headers': JSON.stringify({ Authorization: 'Bearer prod-secret' }),
      }),
    };
    assert.deepEqual(authorizeCronRequest(request, { CRON_SECRET: 'prod-secret' }), { ok: true });
  });

  it('rejects a spoofed Bearer when CRON_SECRET is set and this is not a platform cron', () => {
    const request = { headers: headers({ authorization: 'Bearer wrong' }) };
    assert.deepEqual(authorizeCronRequest(request, { CRON_SECRET: 'prod-secret' }), {
      ok: false,
      reason: 'unauthorized',
    });
  });
});
