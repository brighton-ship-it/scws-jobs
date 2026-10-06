import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BRIGHTON_SALESPERSON_ID } from '../jobber/quotes.ts';
import {
  FORBIDDEN_JOBBER_MCP_TOOLS,
  JOBBER_MCP_SERVER_VERSION,
  JOBBER_MCP_TOOLS,
  callJobberMcpTool,
} from './jobber-tools.ts';
import { handleJobberMcpRequest } from './jobber-http.ts';

const CLIENT = {
  id: 'client-1',
  name: 'Pat Example',
  firstName: 'Pat',
  lastName: 'Example',
  emails: [{ address: 'pat@example.com' }],
  phones: [{ number: '7605550100' }],
  properties: [{ id: 'prop-1', address: { street1: '100 Oak Rd', city: 'Ramona' } }],
  quotes: { nodes: [] },
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockJobberFetch(handlers: Array<(query: string, variables: Record<string, unknown>) => Response | null>) {
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = String(init?.body || '');
    bodies.push(body);
    const parsed = JSON.parse(body || '{}') as { query?: string; variables?: Record<string, unknown> };
    const query = parsed.query || '';
    for (const handler of handlers) {
      const match = handler(query, parsed.variables || {});
      if (match) return match;
    }
    return jsonResponse({ data: {} });
  };
  return { fetchImpl, bodies };
}

describe('JOBBER_MCP_TOOLS', () => {
  it('exposes quote + client + read-only invoice tools and none of the forbidden mutations', () => {
    const names = JOBBER_MCP_TOOLS.map((tool) => tool.name);
    assert.ok(names.includes('search_clients'));
    assert.ok(names.includes('search_quotes'));
    assert.ok(names.includes('search_invoices'));
    assert.ok(names.includes('get_invoice'));
    assert.ok(names.includes('search_jobs'));
    assert.ok(names.includes('get_job'));
    assert.ok(names.includes('create_quote_draft'));
    assert.ok(names.includes('update_quote_draft'));
    assert.ok(names.includes('edit_invoice'));
    assert.ok(names.includes('create_invoice_draft'));
    assert.ok(names.includes('close_job'));
    assert.ok(names.includes('list_tax_rates'));
    assert.ok(names.includes('search_products'));
    assert.equal(JOBBER_MCP_SERVER_VERSION, '1.6.0');
    for (const name of [
      'create_client',
      'create_property',
      'list_users',
      'search_requests',
      'get_request',
      'create_request',
      'create_job',
      'create_visit',
      'create_note',
    ]) {
      assert.ok(names.includes(name), name);
    }
    assert.equal(names.filter((name) => name === 'list_tax_rates').length, 1);
    const schema = JOBBER_MCP_TOOLS.find((tool) => tool.name === 'create_quote_draft')?.inputSchema as {
      properties?: { lineItems?: { items?: { properties?: Record<string, unknown> } } };
    };
    const lineProps = schema?.properties?.lineItems?.items?.properties;
    assert.ok(lineProps?.optional);
    assert.ok(lineProps?.recommended);
    assert.ok(lineProps?.productOrServiceId);
    for (const forbidden of FORBIDDEN_JOBBER_MCP_TOOLS) {
      assert.equal(names.includes(forbidden), false);
    }
  });
});

describe('callJobberMcpTool', () => {
  it('searches clients through the shared Jobber helper', async () => {
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) =>
        query.includes('ClientSearch')
          ? jsonResponse({ data: { clients: { nodes: [CLIENT] } } })
          : null,
    ]);

    const result = await callJobberMcpTool(
      'search_clients',
      { query: 'Pat Example' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /client-1/);
    assert.match(result.content[0].text, /Pat Example/);
    assert.match(result.content[0].text, /prop-1/);
    const query =
      (JSON.parse(bodies.find((body) => body.includes('ClientSearch')) || '{}') as { query?: string })
        .query || '';
    assert.equal(/properties\s*\(\s*first\s*:/.test(query), false);
    assert.equal(/properties\s*\{\s*nodes/.test(query), false);
    assert.match(query, /properties\s*\{\s*id/);
  });

  it('creates an unsent draft and never asks Jobber to send it', async () => {
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) =>
        query.includes('JobberUsers')
          ? jsonResponse({ data: { users: { nodes: [{ id: 'brighton-1', name: 'Brighton' }] } } })
          : null,
      (query) =>
        query.includes('QuoteCreate') && query.includes('mutation')
          ? jsonResponse({
              data: {
                quoteCreate: {
                  quote: {
                    id: 'quote-1',
                    quoteNumber: 4401,
                    title: 'Pull well pump and evaluate',
                    sentAt: null,
                    quoteStatus: 'draft',
                    salesperson: { id: 'brighton-1', name: { full: 'Brighton Scala' } },
                  },
                  userErrors: [],
                },
              },
            })
          : null,
      (query) =>
        query.includes('QuoteCreateLineItems')
          ? jsonResponse({
              data: { quoteCreateLineItems: { createdLineItems: [{ id: 'li-1' }], userErrors: [] } },
            })
          : null,
    ]);

    const result = await callJobberMcpTool(
      'create_quote_draft',
      {
        clientId: 'client-1',
        propertyId: 'prop-1',
        title: 'Pull well pump and evaluate',
        message: 'Proposal to pull the well pump and evaluate the pumping system.',
        lineItems: [{ name: 'BT2', quantity: 1, unitPrice: 600, taxable: false }],
      },
      { fetchImpl, token: 'test' }
    );

    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /quote-1/);
    assert.match(result.content[0].text, /"draft": true/);
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
    assert.match(createQuery, /salesperson\s*\{\s*id name \{ full \}\s*\}/);
    assert.equal(/quoteCreate\s*\(\s*input:/.test(createQuery), false);
    const createVars = JSON.parse(
      bodies.find((body) => {
        const query = (JSON.parse(body) as { query?: string }).query || '';
        return query.includes('mutation') && query.includes('quoteCreate') && !query.includes('LineItems');
      }) || '{}'
    ) as { variables?: { attributes?: { salespersonId?: string } } };
    assert.equal(createVars.variables?.attributes?.salespersonId, 'brighton-1');
    const usersQuery =
      (JSON.parse(bodies.find((body) => body.includes('JobberUsers')) || '{}') as { query?: string }).query || '';
    assert.match(usersQuery, /name\s*\{\s*full first last\s*\}/);
    assert.match(usersQuery, /email\s*\{\s*raw\s*\}/);
    const created = JSON.parse(result.content[0].text) as {
      quote: { salesperson: { id: string; name: string | null } | null };
    };
    assert.deepEqual(created.quote.salesperson, { id: 'brighton-1', name: 'Brighton Scala' });
    assert.ok(bodies.some((body) => body.includes('quoteCreate')));
    assert.ok(bodies.every((body) => !/transitionQuoteTo/.test(body)));
    assert.ok(bodies.every((body) => !/"sentAt"\s*:/.test(body)));
  });

  it('defaults propertyId when the client has exactly one property', async () => {
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) =>
        query.includes('McpClientById')
          ? jsonResponse({ data: { client: CLIENT } })
          : null,
      (query) =>
        query.includes('JobberUsers')
          ? jsonResponse({ data: { users: { nodes: [{ id: 'brighton-1', name: 'Brighton' }] } } })
          : null,
      (query) =>
        query.includes('QuoteCreate') && query.includes('mutation')
          ? jsonResponse({
              data: {
                quoteCreate: {
                  quote: {
                    id: 'quote-1',
                    quoteNumber: 4401,
                    title: 'Pull well pump and evaluate',
                    sentAt: null,
                    quoteStatus: 'draft',
                    salesperson: { id: 'brighton-1', name: { full: 'Brighton Scala' } },
                  },
                  userErrors: [],
                },
              },
            })
          : null,
    ]);

    const result = await callJobberMcpTool(
      'create_quote_draft',
      {
        clientId: 'client-1',
        title: 'Pull well pump and evaluate',
        message: 'Proposal to pull the well pump and evaluate the pumping system.',
        lineItems: [{ name: 'BT2', quantity: 1, unitPrice: 600, taxable: false }],
      },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const createBody = bodies.find((body) => {
      const query = (JSON.parse(body) as { query?: string }).query || '';
      return query.includes('mutation') && query.includes('quoteCreate') && !query.includes('quoteCreateLineItems');
    });
    const vars = JSON.parse(createBody || '{}') as {
      variables?: { attributes?: { propertyId?: string } };
    };
    assert.equal(vars.variables?.attributes?.propertyId, 'prop-1');
  });

  it('errors when propertyId is missing and the client has multiple properties', async () => {
    const { fetchImpl } = mockJobberFetch([
      (query) =>
        query.includes('McpClientById')
          ? jsonResponse({
              data: {
                client: {
                  ...CLIENT,
                  properties: [
                    { id: 'prop-1', address: { street1: '100 Oak Rd' } },
                    { id: 'prop-2', address: { street1: '200 Pine Rd' } },
                  ],
                },
              },
            })
          : null,
    ]);

    const result = await callJobberMcpTool(
      'create_quote_draft',
      {
        clientId: 'client-1',
        title: 'Pull well pump and evaluate',
        message: 'Proposal to pull the well pump and evaluate the pumping system.',
        lineItems: [{ name: 'BT2', quantity: 1, unitPrice: 600, taxable: false }],
      },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /propertyId is required: this client has 2 properties/);
  });

  it('refuses forbidden send/approve tools', async () => {
    const result = await callJobberMcpTool('send_quote', { quoteId: 'quote-1' }, { token: 'test' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /cannot send/i);
  });

  it('searches invoices through the same JSON text shape as quotes', async () => {
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) =>
        query.includes('McpInvoices')
          ? jsonResponse({
              data: {
                invoices: {
                  edges: [
                    {
                      cursor: 'c-inv-1',
                      node: {
                        id: 'inv-1',
                        invoiceNumber: '1042',
                        invoiceStatus: 'awaiting_payment',
                        issuedDate: '2026-01-02T00:00:00Z',
                        dueDate: '2026-01-16T00:00:00Z',
                        clientHubUri: 'https://clienthub.getjobber.com/invoices/1042',
                        amounts: { total: 500, paymentsTotal: 0, invoiceBalance: 500 },
                        client: {
                          id: 'client-1',
                          name: 'Pat Example',
                          emails: [{ address: 'pat@example.com' }],
                        },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: 'c-inv-1' },
                },
              },
            })
          : null,
    ]);

    const result = await callJobberMcpTool(
      'search_invoices',
      { query: '1042', unpaid: true },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as {
      count: number;
      invoices: Array<{ id: string; balance: number; publicUrl: string }>;
      pageInfo: { endCursor: string | null };
      draftOnly?: boolean;
    };
    assert.equal(payload.count, 1);
    assert.equal(payload.invoices[0].id, 'inv-1');
    assert.equal(payload.invoices[0].balance, 500);
    assert.equal(payload.invoices[0].publicUrl, 'https://clienthub.getjobber.com/invoices/1042');
    assert.equal(payload.pageInfo.endCursor, 'c-inv-1');
    assert.equal(payload.draftOnly, undefined);
    assert.equal(bodies.some((body) => /\bmutation\b/.test(body)), false);
  });

  it('searches jobs completed in a window and returns photo urls', async () => {
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) =>
        query.includes('McpJobs')
          ? jsonResponse({
              data: {
                jobs: {
                  edges: [
                    {
                      cursor: 'c-job-1',
                      node: {
                        id: 'job-1',
                        jobNumber: 4401,
                        title: 'Pull pump',
                        jobStatus: 'requires_invoicing',
                        completedAt: '2026-09-22T18:00:00.000Z',
                        createdAt: '2026-09-20T15:00:00.000Z',
                        client: { id: 'client-1', firstName: 'Pat', name: 'Pat Example' },
                        property: { id: 'prop-1', address: { city: 'Ramona' } },
                        noteAttachments: {
                          nodes: [
                            {
                              id: 'file-1',
                              fileName: 'well.jpg',
                              contentType: 'image/jpeg',
                              url: 'https://files.getjobber.com/well.jpg',
                            },
                          ],
                          pageInfo: { hasNextPage: false, endCursor: null },
                        },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: 'c-job-1' },
                },
              },
            })
          : null,
    ]);

    const result = await callJobberMcpTool(
      'search_jobs',
      { completedAfter: '2026-09-22T00:00:00.000Z', status: 'completed' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as {
      count: number;
      jobs: Array<{ id: string; city: string; photoUrls: string[]; client: { firstName: string } }>;
      pageInfo: { endCursor: string | null };
      completedAfter: string;
    };
    assert.equal(payload.count, 1);
    assert.equal(payload.completedAfter, '2026-09-22T00:00:00.000Z');
    assert.equal(payload.jobs[0].id, 'job-1');
    assert.equal(payload.jobs[0].city, 'Ramona');
    assert.equal(payload.jobs[0].client.firstName, 'Pat');
    assert.deepEqual(payload.jobs[0].photoUrls, ['https://files.getjobber.com/well.jpg']);
    assert.equal(payload.pageInfo.endCursor, 'c-job-1');
    assert.match(result.content[0].text, /Read-only/);
    assert.equal(bodies.some((body) => /\bmutation\b/.test(body)), false);
  });

  it('returns structured JSON when the completed window is empty', async () => {
    const { fetchImpl } = mockJobberFetch([
      (query) =>
        query.includes('McpJobs')
          ? jsonResponse({
              data: { jobs: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } },
            })
          : null,
    ]);
    const result = await callJobberMcpTool(
      'search_jobs',
      { completedAfter: '2026-09-22T00:00:00.000Z' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as {
      count: number;
      jobs: unknown[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
    assert.equal(payload.count, 0);
    assert.deepEqual(payload.jobs, []);
    assert.deepEqual(payload.pageInfo, { hasNextPage: false, endCursor: null });
  });

  it('loads one job by id', async () => {
    const { fetchImpl } = mockJobberFetch([
      (query) =>
        query.includes('McpJobById')
          ? jsonResponse({
              data: {
                job: {
                  id: 'job-1',
                  jobNumber: 4401,
                  title: 'Pull pump',
                  completedAt: '2026-09-22T18:00:00.000Z',
                  createdAt: '2026-09-20T15:00:00.000Z',
                  client: { id: 'client-1', firstName: 'Pat' },
                  property: { address: { city: 'Ramona' } },
                  noteAttachments: {
                    nodes: [
                      {
                        id: 'file-1',
                        contentType: 'image/jpeg',
                        url: 'https://files.getjobber.com/well.jpg',
                      },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            })
          : null,
    ]);
    const result = await callJobberMcpTool(
      'get_job',
      { jobId: 'Z2lkOi8vSm9iYmVyL0pvYi8x' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as {
      job: { id: string; photoUrls: string[] };
    };
    assert.equal(payload.job.id, 'job-1');
    assert.deepEqual(payload.job.photoUrls, ['https://files.getjobber.com/well.jpg']);
  });

  it('refuses job update, complete, and send', async () => {
    for (const name of ['update_job', 'complete_job', 'completeJob', 'send_job', 'booking_confirmation']) {
      const result = await callJobberMcpTool(name, { jobId: 'job-1' }, { token: 'test' });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /cannot send/i);
      const payload = JSON.parse(result.content[0].text) as { error: string; draftOnly: boolean };
      assert.equal(payload.draftOnly, true);
      assert.match(payload.error, /job/i);
    }
  });

  it('returns product matches and surfaces catalog GraphQL errors', async () => {
    const hit = mockJobberFetch([
      (query, variables) => {
        if (!query.includes('JobberProductsSearch')) return null;
        assert.equal(query.includes('internalUnitCost'), false);
        assert.equal(query.includes('productsAndServices'), false);
        assert.equal(variables.searchTerm, '25GBC');
        return jsonResponse({
          data: {
            products: {
              nodes: [
                {
                  id: 'prod-25gbc',
                  name: 'Goulds 25GBC',
                  description: '1 HP',
                  defaultUnitCost: 899,
                  taxable: true,
                  category: 'PRODUCT',
                  internalUnitCost: 410,
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      },
    ]);
    const found = await callJobberMcpTool('search_products', { query: '25GBC' }, { fetchImpl: hit.fetchImpl, token: 'test' });
    assert.equal(found.isError, undefined);
    const payload = JSON.parse(found.content[0].text) as {
      count: number;
      matchedBy: string;
      products: Array<{ id: string; internalUnitCost?: number }>;
    };
    assert.equal(payload.count, 1);
    assert.equal(payload.matchedBy, 'search');
    assert.equal(payload.products[0]?.id, 'prod-25gbc');
    assert.equal('internalUnitCost' in (payload.products[0] || {}), false);

    const failed = mockJobberFetch([
      (query) =>
        query.includes('JobberProducts')
          ? jsonResponse({ errors: [{ message: "Cannot query field 'products' on type 'Query'" }] })
          : null,
    ]);
    const error = await callJobberMcpTool(
      'search_products',
      { query: '25GBC' },
      { fetchImpl: failed.fetchImpl, token: 'test' }
    );
    assert.equal(error.isError, true);
    assert.match(error.content[0].text, /Cannot query field 'products'/);
    assert.equal(error.content[0].text.includes('"count": 0'), false);
  });

  it('lists tax rates with an optional query filter', async () => {
    const { fetchImpl } = mockJobberFetch([
      (query) =>
        query.includes('JobberTaxRates')
          ? jsonResponse({
              data: {
                taxRates: {
                  nodes: [
                    {
                      id: 'sd-tax',
                      name: 'San Diego Tax',
                      label: 'San Diego Tax (7.75%)',
                      tax: 7.75,
                      default: true,
                    },
                    { id: 'riv-tax', name: 'Riverside', label: 'Riverside (8.75%)', tax: 8.75, default: false },
                  ],
                },
              },
            })
          : null,
    ]);
    const result = await callJobberMcpTool('list_tax_rates', { query: '7.75' }, { fetchImpl, token: 'test' });
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as {
      count: number;
      taxRates: Array<{ id: string; label: string; rate: number; default: boolean }>;
    };
    assert.equal(payload.count, 1);
    assert.equal(payload.taxRates[0]?.id, 'sd-tax');
    assert.equal(payload.taxRates[0]?.label, 'San Diego Tax (7.75%)');
    assert.equal(payload.taxRates[0]?.rate, 7.75);
    assert.equal(payload.taxRates[0]?.default, true);
  });

  it('passes optional quote lines through create and returns them from get_quote', async () => {
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) =>
        query.includes('JobberUsers')
          ? jsonResponse({ data: { users: { nodes: [{ id: 'brighton-1', name: 'Brighton' }] } } })
          : null,
      (query) =>
        query.includes('QuoteCreate') && query.includes('mutation')
          ? jsonResponse({
              data: {
                quoteCreate: {
                  quote: {
                    id: 'quote-1',
                    quoteNumber: 4402,
                    title: 'Pump options',
                    sentAt: null,
                    quoteStatus: 'draft',
                    salesperson: { id: 'brighton-1', name: { full: 'Brighton Scala' } },
                  },
                  userErrors: [],
                },
              },
            })
          : null,
    ]);
    const created = await callJobberMcpTool(
      'create_quote_draft',
      {
        clientId: 'client-1',
        propertyId: 'prop-1',
        title: 'Pump options',
        message: 'Choose a pump.',
        lineItems: [
          {
            name: 'Goulds 25GBC',
            quantity: 1,
            unitPrice: 899,
            taxable: true,
            optional: true,
            recommended: false,
            productOrServiceId: 'prod-25gbc',
          },
        ],
      },
      { fetchImpl, token: 'test' }
    );
    assert.equal(created.isError, undefined);
    const createBody = bodies.find((body) => {
      const query = (JSON.parse(body) as { query?: string }).query || '';
      return query.includes('mutation') && query.includes('quoteCreate') && !query.includes('LineItems');
    });
    const vars = JSON.parse(createBody || '{}') as {
      variables?: {
        attributes?: {
          lineItems?: Array<{ optional?: boolean; recommended?: boolean; productOrServiceId?: string; sku?: string }>;
        };
      };
    };
    assert.deepEqual(vars.variables?.attributes?.lineItems, [
      {
        name: 'Goulds 25GBC',
        quantity: 1,
        unitPrice: 899,
        taxable: true,
        saveToProductsAndServices: false,
        optional: true,
        recommended: false,
        productOrServiceId: 'prod-25gbc',
      },
    ]);

    const loaded = mockJobberFetch([
      (query) => {
        if (!query.includes('McpQuoteById')) return null;
        assert.match(query, /optional/);
        assert.match(query, /recommended/);
        assert.match(query, /salesperson\s*\{\s*id name \{ full \}\s*\}/);
        return jsonResponse({
          data: {
            quote: {
              id: 'quote-1',
              quoteNumber: 4402,
              title: 'Pump options',
              quoteStatus: 'draft',
              sentAt: null,
              salesperson: { id: 'brighton-1', name: { full: 'Brighton Scala' } },
              lineItems: {
                nodes: [
                  {
                    id: 'li-1',
                    name: 'Goulds 25GBC',
                    description: '1 HP',
                    quantity: 1,
                    unitPrice: 899,
                    optional: true,
                    recommended: false,
                  },
                ],
              },
            },
          },
        });
      },
    ]);
    const quote = await callJobberMcpTool('get_quote', { quoteId: 'quote-1' }, { fetchImpl: loaded.fetchImpl, token: 'test' });
    assert.equal(quote.isError, undefined);
    const body = JSON.parse(quote.content[0].text) as {
      quote: {
        salesperson: { id: string; name: string | null } | null;
        lineItems: Array<{ optional: boolean; recommended: boolean }>;
      };
    };
    assert.equal(body.quote.lineItems[0]?.optional, true);
    assert.equal(body.quote.lineItems[0]?.recommended, false);
    assert.deepEqual(body.quote.salesperson, { id: 'brighton-1', name: 'Brighton Scala' });
  });

  it('defaults salesperson to the known Brighton id when the user lookup errors', async () => {
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) =>
        query.includes('JobberUsers')
          ? jsonResponse({ errors: [{ message: "Field 'name' must have a selection of subfields" }] })
          : null,
      (query) =>
        query.includes('QuoteCreate') && query.includes('mutation')
          ? jsonResponse({
              data: {
                quoteCreate: {
                  quote: {
                    id: 'quote-1',
                    quoteNumber: 4652,
                    title: 'Pull well pump and evaluate',
                    sentAt: null,
                    quoteStatus: 'draft',
                    salesperson: { id: BRIGHTON_SALESPERSON_ID, name: { full: 'Brighton Scala' } },
                  },
                  userErrors: [],
                },
              },
            })
          : null,
    ]);
    const result = await callJobberMcpTool(
      'create_quote_draft',
      {
        clientId: 'client-1',
        propertyId: 'prop-1',
        title: 'Pull well pump and evaluate',
        message: 'Proposal to pull the well pump and evaluate the pumping system.',
        lineItems: [{ name: 'BT2', quantity: 1, unitPrice: 600, taxable: false }],
      },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const vars = JSON.parse(
      bodies.find((body) => (JSON.parse(body) as { query?: string }).query?.includes('quoteCreate(')) || '{}'
    ) as { variables?: { attributes?: { salespersonId?: string } } };
    assert.equal(vars.variables?.attributes?.salespersonId, BRIGHTON_SALESPERSON_ID);
  });

  it('errors when quoteEdit leaves the previous salesperson in place', async () => {
    const fetchImpl = mockJobberFetch([
      (query) =>
        query.includes('McpQuoteById')
          ? jsonResponse({
              data: {
                quote: {
                  id: 'quote-4651',
                  quoteNumber: 4651,
                  title: 'Draft',
                  quoteStatus: 'draft',
                  sentAt: null,
                  salesperson: { id: 'brian', name: { full: 'Brian Schroeder' } },
                  lineItems: { nodes: [] },
                },
              },
            })
          : null,
      (query) =>
        query.includes('McpQuoteEdit')
          ? jsonResponse({
              data: {
                quoteEdit: {
                  quote: {
                    id: 'quote-4651',
                    quoteNumber: 4651,
                    quoteStatus: 'draft',
                    sentAt: null,
                    salesperson: { id: 'brian', name: { full: 'Brian Schroeder' } },
                  },
                  userErrors: [],
                },
              },
            })
          : null,
    ]).fetchImpl;
    const result = await callJobberMcpTool(
      'update_quote_draft',
      { quoteId: 'quote-4651', salespersonId: BRIGHTON_SALESPERSON_ID },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /salesperson is still Brian Schroeder/);
    assert.match(result.content[0].text, /4651/);
  });

  it('returns the new salesperson after quoteEdit applies it', async () => {
    let reads = 0;
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) => {
        if (!query.includes('McpQuoteById')) return null;
        reads += 1;
        const salesperson =
          reads === 1
            ? { id: 'brian', name: { full: 'Brian Schroeder' } }
            : { id: BRIGHTON_SALESPERSON_ID, name: { full: 'Brighton Scala' } };
        return jsonResponse({
          data: {
            quote: {
              id: 'quote-4651',
              quoteNumber: 4651,
              title: 'Draft',
              quoteStatus: 'draft',
              sentAt: null,
              salesperson,
              lineItems: { nodes: [] },
            },
          },
        });
      },
      (query) =>
        query.includes('McpQuoteEdit')
          ? jsonResponse({
              data: {
                quoteEdit: {
                  quote: {
                    id: 'quote-4651',
                    quoteNumber: 4651,
                    quoteStatus: 'draft',
                    sentAt: null,
                  },
                  userErrors: [],
                },
              },
            })
          : null,
    ]);
    const result = await callJobberMcpTool(
      'update_quote_draft',
      { quoteId: 'quote-4651', salespersonId: BRIGHTON_SALESPERSON_ID },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as {
      quote: { salesperson: { id: string; name: string | null } | null };
    };
    assert.deepEqual(payload.quote.salesperson, { id: BRIGHTON_SALESPERSON_ID, name: 'Brighton Scala' });
    const editBody = JSON.parse(
      bodies.find((body) => (JSON.parse(body) as { query?: string }).query?.includes('quoteEdit')) || '{}'
    ) as { variables?: { attributes?: { salespersonId?: string } } };
    assert.equal(editBody.variables?.attributes?.salespersonId, BRIGHTON_SALESPERSON_ID);
    assert.equal(/transitionQuoteTo/.test(bodies.join('\n')), false);
  });

  it('includes salesperson on search_quotes', async () => {
    const fetchImpl = mockJobberFetch([
      (query) =>
        query.includes('McpQuotesSearch')
          ? jsonResponse({
              data: {
                quotes: {
                  nodes: [
                    {
                      id: 'quote-4651',
                      quoteNumber: '4651',
                      title: 'Draft',
                      quoteStatus: 'draft',
                      sentAt: null,
                      salesperson: { id: BRIGHTON_SALESPERSON_ID, name: { full: 'Brighton Scala' } },
                      client: { id: 'client-1', name: 'Pat Example' },
                      lineItems: { nodes: [] },
                    },
                  ],
                },
              },
            })
          : null,
    ]).fetchImpl;
    const result = await callJobberMcpTool(
      'search_quotes',
      { query: '4651' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as {
      quotes: Array<{ salesperson: { id: string; name: string | null } | null }>;
    };
    assert.deepEqual(payload.quotes[0]?.salesperson, { id: BRIGHTON_SALESPERSON_ID, name: 'Brighton Scala' });
  });

  it('refuses invoice send and create', async () => {
    for (const name of ['send_invoice', 'create_invoice', 'sendInvoice', 'mark_invoice_sent']) {
      const result = await callJobberMcpTool(name, { invoiceId: 'inv-1' }, { token: 'test' });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /cannot send/i);
      const payload = JSON.parse(result.content[0].text) as { error: string; draftOnly: boolean };
      assert.equal(payload.draftOnly, true);
    }
  });

  it('rejects recording a payment and still refuses line edits', async () => {
    const recorded = await callJobberMcpTool(
      'edit_invoice',
      { invoiceNumber: '5806', recordPayment: 510.91, allowCardPayments: true },
      { token: 'test' }
    );
    assert.equal(recorded.isError, true);
    assert.match(recorded.content[0].text, /cannot send, mark sent, record, or collect/i);

    const lines = await callJobberMcpTool(
      'edit_invoice',
      {
        invoiceNumber: '5806',
        allowCardPayments: true,
        addLineItems: [
          {
            name: 'Credit card processing fee (2.9%)',
            quantity: 1,
            unitPrice: 510.91,
            taxable: false,
          },
        ],
      },
      { token: 'test' }
    );
    assert.equal(lines.isError, true);
    assert.match(lines.content[0].text, /Jobber's API cannot edit invoice line items; use the Jobber web UI/);
  });

  it('rejects invoice line edits and does not call Jobber', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ errors: [{ message: 'should not be called' }] });
    };
    const result = await callJobberMcpTool(
      'edit_invoice',
      {
        invoiceNumber: '5764',
        updateLineItems: [{ lineItemId: 'li-1', name: 'Pump', quantity: 1, unitPrice: 100 }],
      },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Jobber's API cannot edit invoice line items; use the Jobber web UI/);
    assert.equal(calls, 0);
  });

  it('sets taxRateId with invoiceEdit and does not send line-item fields', async () => {
    const invoiceId = 'Z2lkOi8vSm9iYmVyL0ludm9pY2UvNTc2NA';
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const query = (JSON.parse(body) as { query?: string }).query || '';
      if (query.includes('invoiceEdit')) {
        return jsonResponse({
          data: {
            invoiceEdit: {
              invoice: { id: invoiceId, invoiceNumber: '5764', invoiceStatus: 'draft' },
              userErrors: [],
            },
          },
        });
      }
      return jsonResponse({
        data: {
          invoice: {
            id: invoiceId,
            invoiceNumber: '5764',
            subject: 'Well',
            invoiceStatus: 'draft',
            issuedDate: null,
            dueDate: null,
            createdAt: '2026-09-01T00:00:00Z',
            clientHubUri: null,
            jobberWebUri: 'https://secure.getjobber.com/invoices/5764',
            amounts: { total: 100, paymentsTotal: 0, invoiceBalance: 100 },
            client: { id: 'c1', name: 'Pat', emails: [] },
            lineItems: { nodes: [{ id: 'li-1', name: 'Pump', description: null, quantity: 1, unitPrice: 100 }] },
          },
        },
      });
    };

    const result = await callJobberMcpTool(
      'edit_invoice',
      {
        invoiceId,
        taxRateId: 'sd-tax',
        allowCardPayments: true,
        allowAchPayments: true,
        allowPartialPayments: false,
      },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /"emailed": false/);
    assert.match(result.content[0].text, /"collected": false/);
    const edit = JSON.parse(bodies.find((body) => body.includes('invoiceEdit')) || '{}') as {
      variables?: { input?: Record<string, unknown> };
    };
    assert.deepEqual(edit.variables?.input, {
      taxRateId: 'sd-tax',
      allowClientHubCreditCardPayments: true,
      allowClientHubAchPayments: true,
      allowPartialPayments: false,
    });
    assert.ok(
      bodies.every((body) => !/invoiceMarkAsSent|invoiceSend|recordPayment|collectPayment|lineItemsToEdit/.test(body))
    );
  });
});

describe('handleJobberMcpRequest auth gate', () => {
  const env = { JOBBER_MCP_API_KEYS: '{"travis":"trav-secret"}' };

  it('401s missing or invalid keys before any MCP method runs', async () => {
    const missing = await handleJobberMcpRequest(
      new Request('https://scws-jobs.vercel.app/api/mcp/jobber', { method: 'GET' }),
      { env }
    );
    assert.equal(missing.status, 401);
    assert.match(await missing.text(), /Unauthorized/);

    const wrong = await handleJobberMcpRequest(
      new Request('https://scws-jobs.vercel.app/api/mcp/jobber', {
        method: 'POST',
        headers: { authorization: 'Bearer nope', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      { env }
    );
    assert.equal(wrong.status, 401);
  });

  it('serves health and tools/list when the named key matches', async () => {
    const health = await handleJobberMcpRequest(
      new Request('https://scws-jobs.vercel.app/api/mcp/jobber', {
        method: 'GET',
        headers: { authorization: 'Bearer trav-secret' },
      }),
      { env }
    );
    assert.equal(health.status, 200);
    const healthBody = (await health.json()) as {
      authenticatedAs: string;
      tools: string[];
      durableTokenStore: { encryptionKeyConfigured: boolean; ready: boolean };
    };
    assert.equal(healthBody.authenticatedAs, 'travis');
    assert.ok(healthBody.tools.includes('create_quote_draft'));
    assert.equal(healthBody.durableTokenStore.encryptionKeyConfigured, false);
    assert.equal(healthBody.durableTokenStore.ready, false);
    assert.equal(JSON.stringify(healthBody).includes('trav-secret'), false);

    const listed = await handleJobberMcpRequest(
      new Request('https://scws-jobs.vercel.app/api/mcp/jobber', {
        method: 'POST',
        headers: {
          authorization: 'Bearer trav-secret',
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      { env }
    );
    assert.equal(listed.status, 200);
    const rpc = (await listed.json()) as { result: { tools: Array<{ name: string }> } };
    assert.ok(rpc.result.tools.some((tool) => tool.name === 'search_clients'));
    assert.ok(rpc.result.tools.some((tool) => tool.name === 'search_quotes'));
    assert.ok(rpc.result.tools.some((tool) => tool.name === 'search_invoices'));
    assert.ok(rpc.result.tools.some((tool) => tool.name === 'get_invoice'));
    assert.ok(rpc.result.tools.some((tool) => tool.name === 'search_jobs'));
    assert.ok(rpc.result.tools.some((tool) => tool.name === 'get_job'));
    assert.ok(rpc.result.tools.some((tool) => tool.name === 'list_tax_rates'));
    assert.ok(rpc.result.tools.some((tool) => tool.name === 'search_products'));
    assert.equal(
      rpc.result.tools.some((tool) => tool.name === 'send_invoice' || tool.name === 'create_invoice'),
      false
    );
    assert.ok(rpc.result.tools.some((tool) => tool.name === 'create_job'));
    assert.ok(rpc.result.tools.some((tool) => tool.name === 'create_request'));
    assert.equal(
      rpc.result.tools.some((tool) => tool.name === 'complete_job' || tool.name === 'update_job' || tool.name === 'send_job'),
      false
    );
  });
});
