import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertUnsentQuoteAttributes,
  buildUnsentQuoteAttributes,
  createUnsentQuote,
  findExistingClient,
  findLiveQuoteForJob,
  isLiveQuote,
  loadJobByIdOrNumber,
  quoteCreateUsedForbiddenFields,
} from './quotes.ts';

const CLIENT = {
  id: 'client-1',
  name: 'Pat Example',
  emails: [{ address: 'pat@example.com' }],
  phones: [{ number: '7605550100' }],
  properties: {
    nodes: [{ id: 'prop-1', address: { street1: '100 Oak Rd', city: 'Ramona' } }],
  },
};

describe('unsent quote attributes', () => {
  it('builds attributes without transitionQuoteTo or sentAt', () => {
    const attributes = buildUnsentQuoteAttributes({
      clientId: 'client-1',
      propertyId: 'prop-1',
      title: 'Pull well pump and evaluate',
      message: 'Proposal to pull the well pump and evaluate the pumping system.',
      salespersonId: 'brighton-1',
      taxRateId: 'sd-tax',
    });
    assert.equal(attributes.clientId, 'client-1');
    assert.equal(attributes.taxRateId, 'sd-tax');
    assert.ok(!('transitionQuoteTo' in attributes));
    assert.ok(!('sentAt' in attributes));
    assertUnsentQuoteAttributes(attributes);
  });

  it('throws if someone tries to send the quote', () => {
    assert.throws(
      () => assertUnsentQuoteAttributes({ clientId: 'x', transitionQuoteTo: 'sent' }),
      /transitionQuoteTo/
    );
  });
});

describe('live quote reuse', () => {
  it('treats draft/sent as live and archived as dead', () => {
    assert.equal(isLiveQuote({ id: 'q1', quoteStatus: 'draft', sentAt: null }), true);
    assert.equal(isLiveQuote({ id: 'q2', quoteStatus: 'archived' }), false);
  });

  it('finds an existing pull-and-eval on the same job', () => {
    const found = findLiveQuoteForJob(
      [{ id: 'q-live', title: 'Pull well pump and evaluate (job 8801)', quoteStatus: 'draft' }],
      { jobNumber: 8801, property: { id: 'prop-1' } }
    );
    assert.equal(found?.id, 'q-live');
  });
});

describe('client search never invents a duplicate', () => {
  it('matches existing phone / street', () => {
    assert.equal(findExistingClient([CLIENT], { phone: '(760) 555-0100' })?.id, 'client-1');
    assert.equal(findExistingClient([CLIENT], { street: '100 Oak Road' })?.id, 'client-1');
    assert.equal(findExistingClient([CLIENT], { street: '999 Other St' }), null);
  });
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Jobber quote create (mocked)', () => {
  it('loads a job by number and creates an unsent draft', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const parsed = JSON.parse(body || '{}') as { query?: string };
      if (parsed.query?.includes('JobsSearch')) {
        return jsonResponse({
          data: {
            jobs: {
              nodes: [
                {
                  id: 'job-1',
                  jobNumber: 8801,
                  client: CLIENT,
                  property: { id: 'prop-1', address: { city: 'Ramona' } },
                  quotes: { nodes: [] },
                },
              ],
            },
          },
        });
      }
      if (parsed.query?.includes('QuoteCreate') && parsed.query?.includes('mutation')) {
        return jsonResponse({
          data: {
            quoteCreate: {
              quote: {
                id: 'quote-1',
                quoteNumber: 4301,
                title: 'Pull well pump and evaluate',
                sentAt: null,
                quoteStatus: 'draft',
              },
              userErrors: [],
            },
          },
        });
      }
      if (parsed.query?.includes('QuoteCreateLineItems')) {
        return jsonResponse({
          data: { quoteCreateLineItems: { createdLineItems: [{ id: 'li-1' }], userErrors: [] } },
        });
      }
      return jsonResponse({ data: {} });
    };

    const job = await loadJobByIdOrNumber({ jobNumber: 8801 }, { fetchImpl, token: 'test' });
    assert.equal(job.jobNumber, 8801);
    assert.equal(job.client?.id, 'client-1');

    const quote = await createUnsentQuote(
      {
        clientId: 'client-1',
        title: 'Pull well pump and evaluate',
        message: 'Proposal to pull the well pump and evaluate the pumping system.',
        lineItems: [{ name: 'BT2', quantity: 1, unitPrice: 600, taxable: false }],
      },
      { fetchImpl, token: 'test' }
    );
    assert.equal(quote.sentAt, null);
    assert.equal(quote.quoteNumber, 4301);
    assert.ok(bodies.some((body) => body.includes('quoteCreate')));
    assert.ok(bodies.every((body) => !quoteCreateUsedForbiddenFields(body)));
  });
});
