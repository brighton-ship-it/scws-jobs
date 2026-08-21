import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchGbpRatings,
  gbpCorsHeaders,
  gbpRatingsHttp,
  getGbpShopConfig,
  isAllowedGbpOrigin,
  isGbpConfigured,
  parseGbpReviewAggregates,
  resetGbpTokenCache,
} from './gbp.ts';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetGbpTokenCache();
}

afterEach(() => {
  restoreEnv();
});

describe('isGbpConfigured', () => {
  it('is false when any of the three OAuth env vars is missing', () => {
    delete process.env.GBP_CLIENT_ID;
    delete process.env.GBP_CLIENT_SECRET;
    delete process.env.GBP_REFRESH_TOKEN;
    assert.equal(isGbpConfigured(), false);

    process.env.GBP_CLIENT_ID = 'client';
    process.env.GBP_CLIENT_SECRET = 'secret';
    assert.equal(isGbpConfigured(), false);
  });

  it('is true only when all three OAuth env vars are set', () => {
    process.env.GBP_CLIENT_ID = 'client';
    process.env.GBP_CLIENT_SECRET = 'secret';
    process.env.GBP_REFRESH_TOKEN = 'refresh';
    assert.equal(isGbpConfigured(), true);
  });
});

describe('isAllowedGbpOrigin / gbpCorsHeaders', () => {
  it('allows the marketing site and localhost, not arbitrary origins', () => {
    assert.equal(isAllowedGbpOrigin('https://scwellservice.com'), true);
    assert.equal(isAllowedGbpOrigin('https://www.scwellservice.com'), true);
    assert.equal(isAllowedGbpOrigin('http://localhost:3000'), true);
    assert.equal(isAllowedGbpOrigin('http://127.0.0.1:5173'), true);
    assert.equal(isAllowedGbpOrigin('https://evil.example'), false);
    assert.equal(isAllowedGbpOrigin(null), false);
  });

  it('echoes an allowed Origin and never reflects a stranger', () => {
    const allowed = gbpCorsHeaders(
      new Request('https://scws-jobs.vercel.app/api/gbp-ratings', {
        headers: { origin: 'https://scwellservice.com' },
      })
    );
    assert.equal(allowed['Access-Control-Allow-Origin'], 'https://scwellservice.com');
    assert.equal(allowed['Access-Control-Allow-Methods'], 'GET, OPTIONS');
    assert.equal(allowed.Vary, 'Origin');

    const blocked = gbpCorsHeaders(
      new Request('https://scws-jobs.vercel.app/api/gbp-ratings', {
        headers: { origin: 'https://evil.example' },
      })
    );
    assert.equal(blocked['Access-Control-Allow-Origin'], undefined);
  });
});

describe('parseGbpReviewAggregates', () => {
  it('reads rating + count and ignores review objects', () => {
    const parsed = parseGbpReviewAggregates({
      averageRating: 4.7,
      totalReviewCount: 61,
      reviews: [
        {
          reviewer: { displayName: 'Jane Doe' },
          comment: 'secret review text',
        },
      ],
    });
    assert.deepEqual(parsed, { rating: 4.7, count: 61 });
  });

  it('refuses to invent ratings when aggregates are missing', () => {
    assert.throws(() => parseGbpReviewAggregates({ reviews: [] }), /averageRating/);
    assert.throws(() => parseGbpReviewAggregates({ averageRating: 4.9 }), /totalReviewCount/);
  });
});

describe('getGbpShopConfig', () => {
  it('includes the known Ramona review URL and omits Anza when none is configured', () => {
    delete process.env.GBP_ANZA_REVIEW_URL;
    const shops = getGbpShopConfig();
    assert.equal(shops.ramona.url, 'https://g.page/r/CU9X_NG3TvP2EBM/review');
    assert.equal(shops.anza.url, undefined);
  });
});

describe('fetchGbpRatings', () => {
  it('returns rating + count only, even if Google sent review text', async () => {
    process.env.GBP_CLIENT_ID = 'client';
    process.env.GBP_CLIENT_SECRET = 'secret';
    process.env.GBP_REFRESH_TOKEN = 'refresh';

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'ya29.fake', expires_in: 3600 });
      }
      if (url.includes('/locations/8959939212840285363/reviews')) {
        return Response.json({
          averageRating: 4.7,
          totalReviewCount: 61,
          reviews: [{ comment: 'do not leak', reviewer: { displayName: 'PII' } }],
        });
      }
      if (url.includes('/locations/17699062318199230566/reviews')) {
        return Response.json({
          averageRating: 4.8,
          totalReviewCount: 94,
          reviews: [{ comment: 'also secret' }],
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const payload = await fetchGbpRatings(fetchImpl);
    assert.equal(payload.ramona.rating, 4.7);
    assert.equal(payload.ramona.count, 61);
    assert.equal(payload.ramona.url, 'https://g.page/r/CU9X_NG3TvP2EBM/review');
    assert.equal(payload.anza.rating, 4.8);
    assert.equal(payload.anza.count, 94);
    assert.equal('url' in payload.anza, false);
    assert.match(payload.updated, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal('reviews' in payload, false);
    assert.equal(JSON.stringify(payload).includes('do not leak'), false);
    assert.equal(JSON.stringify(payload).includes('PII'), false);
  });
});

describe('gbpRatingsHttp', () => {
  it('returns 503 gbp_unconfigured and does not invent ratings', async () => {
    delete process.env.GBP_CLIENT_ID;
    delete process.env.GBP_CLIENT_SECRET;
    delete process.env.GBP_REFRESH_TOKEN;

    const result = await gbpRatingsHttp(
      new Request('https://scws-jobs.vercel.app/api/gbp-ratings', {
        headers: { origin: 'https://scwellservice.com' },
      })
    );

    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: 'gbp_unconfigured' });
    assert.equal(result.headers['Access-Control-Allow-Origin'], 'https://scwellservice.com');
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal('ramona' in result.body, false);
  });

  it('sets one-hour CDN cache on a live payload', async () => {
    process.env.GBP_CLIENT_ID = 'client';
    process.env.GBP_CLIENT_SECRET = 'secret';
    process.env.GBP_REFRESH_TOKEN = 'refresh';

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'ya29.fake', expires_in: 3600 });
      }
      if (url.includes('/reviews')) {
        return Response.json({ averageRating: 4.7, totalReviewCount: 61 });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const result = await gbpRatingsHttp(
      new Request('https://scws-jobs.vercel.app/api/gbp-ratings', {
        headers: { origin: 'http://localhost:5173' },
      }),
      fetchImpl
    );

    assert.equal(result.status, 200);
    assert.equal(
      result.headers['Cache-Control'],
      'public, s-maxage=3600, stale-while-revalidate=86400'
    );
    assert.equal(result.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
  });
});
