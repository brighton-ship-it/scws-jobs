import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicApiRoute } from './public-api.ts';

describe('isPublicApiRoute', () => {
  it('allows GET /api/gbp-ratings for the marketing-site widget', () => {
    assert.equal(isPublicApiRoute('GET', '/api/gbp-ratings'), true);
    assert.equal(isPublicApiRoute('OPTIONS', '/api/gbp-ratings'), true);
  });

  it('does not open POST or neighboring paths on the ratings route', () => {
    assert.equal(isPublicApiRoute('POST', '/api/gbp-ratings'), false);
    assert.equal(isPublicApiRoute('GET', '/api/gbp-ratings/extra'), false);
  });

  it('keeps staff CRM GETs private', () => {
    assert.equal(isPublicApiRoute('GET', '/api/customers'), false);
    assert.equal(isPublicApiRoute('GET', '/api/jobs'), false);
    assert.equal(isPublicApiRoute('GET', '/api/booking'), false);
  });
});
