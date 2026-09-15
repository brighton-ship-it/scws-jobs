import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertUnsentQuoteAttributes,
  buildUnsentQuoteAttributes,
  createUnsentQuote,
  findExistingClient,
  findExistingPropertyId,
  findLiveQuoteForJob,
  isLiveQuote,
  jobberClientProperties,
  loadJobByIdOrNumber,
  quoteCreateUsedForbiddenFields,
  searchClients,
} from './quotes.ts';

const PROPERTY = { id: 'prop-1', address: { street1: '100 Oak Rd', city: 'Ramona' } };

const CLIENT = {
  id: 'client-1',
  name: 'Pat Example',
  emails: [{ address: 'pat@example.com' }],
  phones: [{ number: '7605550100' }],
  properties: [PROPERTY],
};

function assertPropertiesIsPropertyList(query: string) {
  assert.equal(/properties\s*\(\s*first\s*:/.test(query), false);
  assert.equal(/properties\s*\{\s*nodes/.test(query), false);
  assert.match(query, /properties\s*\{\s*id/);
}

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

  it('refuses to put GP FLAG math on the client-facing message', async () => {
    await assert.rejects(
      () =>
        createUnsentQuote(
          {
            clientId: 'client-1',
            title: 'Replace pressure tank — FLAG under 60% GP',
            message: 'FLAG PM260 street $1370 vs cost $616.50 = 55% GP (60% would be $1541 — not applied)',
            lineItems: [{ name: '86-gal Promax PM260', quantity: 1, unitPrice: 1370, taxable: true }],
          },
          {
            fetchImpl: async () =>
              new Response(JSON.stringify({ data: {} }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            token: 'test',
          }
        ),
      /Customer-facing quote message must not contain GP FLAG/
    );
  });
});

describe('live quote reuse', () => {
  it('treats draft/sent as live and archived as dead', () => {
    assert.equal(isLiveQuote({ id: 'q1', quoteStatus: 'draft', sentAt: null }), true);
    assert.equal(isLiveQuote({ id: 'q2', quoteStatus: 'archived' }), false);
  });

  it('finds an existing live quote on the same job, including a tank swap', () => {
    const found = findLiveQuoteForJob(
      [{ id: 'q-live', title: 'Replace pressure tank (job 3266)', quoteStatus: 'draft' }],
      { jobNumber: 3266, property: { id: 'prop-1' } }
    );
    assert.equal(found?.id, 'q-live');
  });
});

describe('Jobber client search GraphQL (2025-04-16)', () => {
  it('selects properties as a Property list, not a connection', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body || ''));
      return jsonResponse({ data: { clients: { nodes: [] } } });
    };

    await searchClients('Pat Example', { fetchImpl, token: 'test' });

    const query =
      (JSON.parse(bodies.find((body) => body.includes('ClientSearch')) || '{}') as { query?: string })
        .query || '';
    assert.match(query, /ClientSearch/);
    assertPropertiesIsPropertyList(query);
    assert.match(query, /quotes\s*\(\s*first:\s*25\s*\)/);
  });
});

describe('jobberClientProperties', () => {
  it('reads the live array shape and leftover connection shape', () => {
    assert.deepEqual(jobberClientProperties([PROPERTY]).map((property) => property.id), ['prop-1']);
    assert.deepEqual(
      jobberClientProperties({ nodes: [PROPERTY] }).map((property) => property.id),
      ['prop-1']
    );
    assert.deepEqual(jobberClientProperties(null), []);
  });
});

describe('client search never invents a duplicate', () => {
  it('matches existing phone / street', () => {
    assert.equal(findExistingClient([CLIENT], { phone: '(760) 555-0100' })?.id, 'client-1');
    assert.equal(findExistingClient([CLIENT], { street: '100 Oak Road' })?.id, 'client-1');
    assert.equal(findExistingClient([CLIENT], { street: '999 Other St' }), null);
    assert.equal(
      findExistingClient([{ ...CLIENT, properties: { nodes: [PROPERTY] } }], { street: '100 Oak Road' })
        ?.id,
      'client-1'
    );
    assert.equal(findExistingPropertyId(CLIENT, '100 Oak Road'), 'prop-1');
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
    const jobQuery =
      (JSON.parse(bodies.find((body) => body.includes('JobsSearch')) || '{}') as { query?: string })
        .query || '';
    assertPropertiesIsPropertyList(jobQuery);

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
    const createQuery =
      (
        JSON.parse(
          bodies.find((body) => {
            const query = (JSON.parse(body) as { query?: string }).query || '';
            return query.includes('mutation') && query.includes('quoteCreate') && !query.includes('LineItems');
          }) || '{}'
        ) as { query?: string }
      ).query || '';
    assert.match(createQuery, /quoteCreate\s*\(\s*attributes:/);
    assert.equal(/quoteCreate\s*\(\s*input:/.test(createQuery), false);
    assert.ok(bodies.some((body) => body.includes('quoteCreate')));
    assert.ok(bodies.every((body) => !quoteCreateUsedForbiddenFields(body)));
  });

  it('falls back to quoteCreate(input: { attributes }) when the 2025-04-16 shape is rejected', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const parsed = JSON.parse(body || '{}') as { query?: string };
      const query = parsed.query || '';
      if (query.includes('quoteCreate(attributes:')) {
        return jsonResponse({
          errors: [{ message: "Field 'quoteCreate' is missing required arguments: input" }],
        });
      }
      if (query.includes('quoteCreate(input: { attributes: $attributes })')) {
        return jsonResponse({
          data: {
            quoteCreate: {
              quote: {
                id: 'quote-legacy',
                quoteNumber: 4302,
                title: 'Pull well pump and evaluate',
                sentAt: null,
                quoteStatus: 'draft',
              },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes('QuoteCreateLineItems') || query.includes('quoteCreateLineItems')) {
        return jsonResponse({
          data: { quoteCreateLineItems: { createdLineItems: [{ id: 'li-1' }], userErrors: [] } },
        });
      }
      return jsonResponse({ data: {} });
    };

    const quote = await createUnsentQuote(
      {
        clientId: 'client-1',
        title: 'Pull well pump and evaluate',
        message: 'Proposal to pull the well pump and evaluate the pumping system.',
        lineItems: [{ name: 'BT2', quantity: 1, unitPrice: 600, taxable: false }],
      },
      { fetchImpl, token: 'test' }
    );
    assert.equal(quote.id, 'quote-legacy');
    const createQueries = bodies
      .map((body) => (JSON.parse(body) as { query?: string }).query || '')
      .filter((query) => query.includes('mutation') && query.includes('quoteCreate') && !query.includes('LineItems'));
    assert.match(createQueries[0] || '', /quoteCreate\s*\(\s*attributes:/);
    assert.match(createQueries[1] || '', /quoteCreate\s*\(\s*input:\s*\{\s*attributes:/);
  });
});
