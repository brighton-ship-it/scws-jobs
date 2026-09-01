import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clientDisplayName,
  fetchQuotesGpPage,
  jobberFilterFromInput,
  mapJobberQuote,
  normalizeQuoteStatus,
  quoteMatchesSearch,
  toQuoteLineDraft,
  uniqueProductSearchTerms,
  type JobberQuoteNode,
} from './quote-gp-tracker.ts';
import { mentionsGpFlag } from './gross-profit.ts';
import { PROMAX_PM260_NAME, PROMAX_PM260_PRICE } from './shop-book.ts';

const pm260Quote: JobberQuoteNode = {
  id: 'q-1',
  quoteNumber: 4253,
  title: 'Replace pressure tank',
  quoteStatus: 'draft',
  createdAt: '2026-08-01T12:00:00Z',
  sentAt: null,
  jobberWebUri: 'https://secure.getjobber.com/quotes/4253',
  amounts: { subtotal: 1695, total: 1695 },
  client: { name: 'Doug Villagrando' },
  property: { address: { city: 'Ramona', street1: '1 Main' } },
  lineItems: {
    nodes: [
      { name: PROMAX_PM260_NAME, quantity: 1, unitPrice: PROMAX_PM260_PRICE },
      { name: 'Plumbing package', quantity: 1, unitPrice: 125 },
      { name: 'Tank swap labor', quantity: 1, unitPrice: 200 },
    ],
  },
};

describe('mapJobberQuote', () => {
  it('maps a live Jobber node with FLAG costing and Ramona shop', () => {
    const row = mapJobberQuote(pm260Quote);
    assert.equal(row.quoteNumber, '4253');
    assert.equal(row.client, 'Doug Villagrando');
    assert.equal(row.city, 'Ramona');
    assert.equal(row.shop, 'ramona');
    assert.equal(row.status, 'draft');
    assert.equal(row.costStatus, 'partial');
    assert.equal(row.gpPercent, null);
    assert.equal(row.flaggedUnder60, true);
    assert.ok(row.flagTexts.some((text) => /PM260/.test(text) && /55% GP/.test(text)));
    assert.equal(row.jobberWebUri, 'https://secure.getjobber.com/quotes/4253');
    assert.ok(!row.flagTexts.some((text) => /95|137\.50|10738/.test(text)));
  });

  it('does not put GP FLAG math on the stored customer title field we display as-is', () => {
    const row = mapJobberQuote(pm260Quote);
    assert.equal(mentionsGpFlag(row.title), false);
    assert.equal(row.title, 'Replace pressure tank');
  });

  it('uses line unitCost from Jobber when present', () => {
    const row = mapJobberQuote({
      id: 'q-2',
      quoteNumber: '99',
      title: '1MS',
      quoteStatus: 'awaiting_response',
      amounts: { subtotal: 200 },
      client: { companyName: 'Acme Ranch' },
      property: { address: { city: 'Anza' } },
      lineItems: {
        nodes: [{ name: 'Service diagnostic', quantity: 1, unitPrice: 200, unitCost: 80 }],
      },
    });
    assert.equal(row.client, 'Acme Ranch');
    assert.equal(row.shop, 'anza');
    assert.equal(row.status, 'awaiting_response');
    assert.equal(row.costStatus, 'full');
    assert.equal(row.estimatedCost, 80);
    assert.equal(row.gpPercent, 60);
    assert.equal(row.flaggedUnder60, false);
  });
});

describe('fetchQuotesGpPage', () => {
  it('pages live Jobber quotes and scores with FLAG costs, not fixtures', async () => {
    const page = await fetchQuotesGpPage(
      { first: 25 },
      {
        token: 'test',
        productCosts: [],
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(String(init?.body || '{}')) as { query?: string };
          assert.match(body.query || '', /quotes\(/);
          assert.match(body.query || '', /pageInfo/);
          return new Response(
            JSON.stringify({
              data: {
                quotes: {
                  nodes: [pm260Quote],
                  pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
                  totalCount: 1307,
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        },
      }
    );
    assert.equal(page.quotes.length, 1);
    assert.equal(page.quotes[0]?.flaggedUnder60, true);
    assert.equal(page.quotes[0]?.gpPercent, null);
    assert.equal(page.pageInfo.hasNextPage, true);
    assert.equal(page.pageInfo.totalCount, 1307);
    assert.equal(page.summary.under60Count, 1);
  });
});

describe('helpers', () => {
  it('normalizes status and builds a Jobber filter', () => {
    assert.equal(normalizeQuoteStatus('AWAITING-RESPONSE'), 'awaiting_response');
    assert.equal(clientDisplayName({ firstName: 'Liz', lastName: 'B' }), 'Liz B');
    assert.deepEqual(jobberFilterFromInput({ status: 'draft' }), { status: 'draft' });
    assert.equal(jobberFilterFromInput({ status: 'all' }), null);
    const draft = toQuoteLineDraft({
      name: 'PM260',
      quantity: 1,
      unitPrice: 1370,
      unitCost: 616.5,
    });
    assert.equal(draft.unitCost, 616.5);
    assert.deepEqual(uniqueProductSearchTerms([pm260Quote]).includes('PM260') || uniqueProductSearchTerms([pm260Quote]).length > 0, true);
    assert.equal(quoteMatchesSearch(mapJobberQuote(pm260Quote), '4253'), true);
    assert.equal(quoteMatchesSearch(mapJobberQuote(pm260Quote), 'villagrando'), true);
    assert.equal(quoteMatchesSearch(mapJobberQuote(pm260Quote), 'nope'), false);
  });
});
