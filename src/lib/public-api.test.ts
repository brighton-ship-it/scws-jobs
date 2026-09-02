import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCronApiPath, isOpsApiPath, isOpsPagePath, isPublicApiRoute } from './public-api.ts';

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
    assert.equal(isPublicApiRoute('GET', '/api/wells/nearby'), false);
    assert.equal(isPublicApiRoute('GET', '/api/wells/tracker'), false);
  });

  it('allows the Jobber book_job cron (self-authenticates with CRON_SECRET)', () => {
    assert.equal(isPublicApiRoute('GET', '/api/cron/sync-jobber-book-jobs'), true);
    assert.equal(isPublicApiRoute('POST', '/api/cron/sync-jobber-book-jobs'), true);
    assert.equal(isCronApiPath('/api/cron/sync-jobber-book-jobs'), true);
    assert.equal(isCronApiPath('/api/cron/process-automations'), true);
    assert.equal(isCronApiPath('/api/booking'), false);
  });

  it('allows Jobber unsent quote draft POSTs (self-authenticate with CRON_SECRET)', () => {
    assert.equal(isPublicApiRoute('POST', '/api/jobber/tech-note-quote'), true);
    assert.equal(isPublicApiRoute('POST', '/api/jobber/drill-quote'), true);
    assert.equal(isPublicApiRoute('GET', '/api/jobber/tech-note-quote'), false);
    assert.equal(isPublicApiRoute('POST', '/api/jobber/tech-note-quote/extra'), false);
  });

  it('lets the quote GP tracker past middleware (route still requires session or QUOTES_GP_KEY)', () => {
    assert.equal(isOpsApiPath('/api/ops/quotes-gp'), true);
    assert.equal(isOpsPagePath('/ops/quotes-gp'), true);
    assert.equal(isPublicApiRoute('GET', '/api/ops/quotes-gp'), true);
    assert.equal(isOpsApiPath('/api/quotes'), false);
    assert.equal(isOpsPagePath('/quotes'), false);
  });
});
