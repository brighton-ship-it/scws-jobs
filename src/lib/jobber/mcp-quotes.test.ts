import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertQuoteIsDraftUnsent,
  assertQuoteUnchangedExceptSalesperson,
  buildDraftQuoteEditAttributes,
  buildSalespersonOnlyEditAttributes,
  getClientById,
  quoteEditUsedForbiddenFields,
  setQuoteSalesperson,
  updateUnsentQuoteDraft,
} from './mcp-quotes.ts';
import { BRIGHTON_SALESPERSON_ID } from './quotes.ts';

describe('draft quote edit safety', () => {
  it('builds edit attributes without send fields', () => {
    const attributes = buildDraftQuoteEditAttributes({
      title: 'Pull well pump and evaluate',
      message: 'Proposal to pull the well pump and evaluate the pumping system.',
    });
    assert.equal(attributes.title, 'Pull well pump and evaluate');
    assert.equal(
      buildDraftQuoteEditAttributes({ salespersonId: '  brighton-1  ' }).salespersonId,
      'brighton-1'
    );
    assert.ok(!('transitionQuoteTo' in attributes));
    assert.ok(!('sentAt' in attributes));
  });

  it('refuses GP FLAG on the customer-facing message', () => {
    assert.throws(
      () =>
        buildDraftQuoteEditAttributes({
          message: 'FLAG PM260 street $1370 vs cost $616.50 = 55% GP',
        }),
      /GP FLAG/
    );
  });

  it('refuses edits to a sent quote', () => {
    assert.throws(
      () =>
        assertQuoteIsDraftUnsent({
          id: 'q1',
          quoteStatus: 'sent',
          sentAt: '2026-09-01T00:00:00Z',
        }),
      /only unsent drafts/
    );
  });
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MCP client GraphQL (2025-04-16)', () => {
  it('selects properties as a Property list, not a connection', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body || ''));
      return jsonResponse({
        data: {
          client: {
            id: 'client-1',
            name: 'Pat Example',
            properties: [],
            quotes: { nodes: [] },
          },
        },
      });
    };

    const client = await getClientById('client-1', { fetchImpl, token: 'test' });
    assert.equal(client.id, 'client-1');

    const query =
      (JSON.parse(bodies.find((body) => body.includes('McpClientById')) || '{}') as { query?: string })
        .query || '';
    assert.match(query, /McpClientById/);
    assert.equal(/properties\s*\(\s*first\s*:/.test(query), false);
    assert.equal(/properties\s*\{\s*nodes/.test(query), false);
    assert.match(query, /properties\s*\{\s*id/);
    assert.match(query, /quotes\s*\(\s*first:\s*25\s*\)/);
  });
});

describe('updateUnsentQuoteDraft', () => {
  it('loads a draft, edits title, and never sets transitionQuoteTo', async () => {
    const bodies: string[] = [];
    let edited = false;
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const parsed = JSON.parse(body || '{}') as { query?: string };
      if (parsed.query?.includes('McpQuoteById')) {
        return jsonResponse({
          data: {
            quote: {
              id: 'quote-1',
              quoteNumber: 4401,
              title: edited ? 'New title' : 'Old title',
              quoteStatus: 'draft',
              sentAt: null,
              lineItems: { nodes: [] },
            },
          },
        });
      }
      if (parsed.query?.includes('McpQuoteEdit')) {
        edited = true;
        return jsonResponse({
          data: {
            quoteEdit: {
              quote: {
                id: 'quote-1',
                quoteNumber: 4401,
                title: 'New title',
                quoteStatus: 'draft',
                sentAt: null,
              },
              userErrors: [],
            },
          },
        });
      }
      return jsonResponse({ data: {} });
    };

    const quote = await updateUnsentQuoteDraft(
      { quoteId: 'quote-1', title: 'New title' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(quote.title, 'New title');
    const editQuery =
      (
        JSON.parse(
          bodies.find((body) => {
            const query = (JSON.parse(body) as { query?: string }).query || '';
            return query.includes('mutation') && query.includes('quoteEdit');
          }) || '{}'
        ) as { query?: string }
      ).query || '';
    assert.match(editQuery, /quoteEdit\s*\(\s*quoteId:\s*\$quoteId,\s*attributes:/);
    assert.equal(/quoteEdit\s*\(\s*input:/.test(editQuery), false);
    assert.ok(bodies.some((body) => body.includes('quoteEdit')));
    assert.ok(bodies.every((body) => !quoteEditUsedForbiddenFields(body)));
  });

  it('adds optional line items without sending the quote', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const parsed = JSON.parse(body || '{}') as { query?: string };
      if (parsed.query?.includes('McpQuoteById')) {
        return jsonResponse({
          data: {
            quote: {
              id: 'quote-1',
              quoteNumber: 4401,
              title: 'Old title',
              quoteStatus: 'draft',
              sentAt: null,
              lineItems: { nodes: [] },
            },
          },
        });
      }
      if (parsed.query?.includes('McpQuoteCreateLineItems')) {
        return jsonResponse({
          data: { quoteCreateLineItems: { createdLineItems: [{ id: 'li-1' }], userErrors: [] } },
        });
      }
      return jsonResponse({ data: {} });
    };

    await updateUnsentQuoteDraft(
      {
        quoteId: 'quote-1',
        addLineItems: [
          {
            name: 'Goulds 25GBC',
            quantity: 1,
            unitPrice: 899,
            taxable: true,
            optional: true,
            recommended: true,
            productOrServiceId: 'prod-25gbc',
            sku: '25GBC',
            unitCost: 410,
          },
        ],
      },
      { fetchImpl, token: 'test' }
    );

    const lineBody = JSON.parse(
      bodies.find((body) => (JSON.parse(body) as { query?: string }).query?.includes('quoteCreateLineItems')) || '{}'
    ) as { variables?: { lineItems?: Array<Record<string, unknown>> } };
    assert.deepEqual(lineBody.variables?.lineItems, [
      {
        name: 'Goulds 25GBC',
        quantity: 1,
        unitPrice: 899,
        taxable: true,
        saveToProductsAndServices: false,
        optional: true,
        recommended: true,
        productOrServiceId: 'prod-25gbc',
      },
    ]);
    assert.ok(bodies.every((body) => !quoteEditUsedForbiddenFields(body)));
  });

  it('sends salespersonId and errors when the re-read still has the old salesperson', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const parsed = JSON.parse(body || '{}') as { query?: string; variables?: { attributes?: { salespersonId?: string } } };
      if (parsed.query?.includes('McpQuoteById')) {
        return jsonResponse({
          data: {
            quote: {
              id: 'quote-1',
              quoteNumber: 4651,
              title: 'Draft',
              quoteStatus: 'draft',
              sentAt: null,
              salesperson: { id: 'brian', name: { full: 'Brian Schroeder' } },
              lineItems: { nodes: [] },
            },
          },
        });
      }
      if (parsed.query?.includes('McpQuoteEdit')) {
        assert.equal(parsed.variables?.attributes?.salespersonId, BRIGHTON_SALESPERSON_ID);
        assert.match(parsed.query, /salesperson\s*\{\s*id name \{ full \}\s*\}/);
        return jsonResponse({
          data: {
            quoteEdit: {
              quote: { id: 'quote-1', quoteNumber: 4651, quoteStatus: 'draft', sentAt: null },
              userErrors: [],
            },
          },
        });
      }
      return jsonResponse({ data: {} });
    };

    await assert.rejects(
      () =>
        updateUnsentQuoteDraft(
          { quoteId: 'quote-1', salespersonId: BRIGHTON_SALESPERSON_ID },
          { fetchImpl, token: 'test' }
        ),
      /salesperson is still Brian Schroeder/
    );
    assert.ok(bodies.every((body) => !quoteEditUsedForbiddenFields(body)));
  });

  it('refuses to edit a quote Jobber already sent', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        data: {
          quote: {
            id: 'quote-sent',
            quoteNumber: 9,
            title: 'Sent',
            quoteStatus: 'sent',
            sentAt: '2026-09-01T12:00:00Z',
          },
        },
      });

    await assert.rejects(
      () => updateUnsentQuoteDraft({ quoteId: 'quote-sent', title: 'Nope' }, { fetchImpl, token: 'test' }),
      /only unsent drafts/
    );
  });
});

describe('setQuoteSalesperson', () => {
  const line = {
    id: 'li-1',
    name: 'BT2',
    description: 'Pull',
    quantity: 1,
    unitPrice: 600,
    optional: false,
    recommended: false,
  };

  it('builds attributes with salespersonId only', () => {
    assert.deepEqual(buildSalespersonOnlyEditAttributes(`  ${BRIGHTON_SALESPERSON_ID}  `), {
      salespersonId: BRIGHTON_SALESPERSON_ID,
    });
    assert.throws(() => buildSalespersonOnlyEditAttributes('  '), /salespersonId is required/);
  });

  it('rejects a re-read that changed status or line price', () => {
    const before = {
      id: 'quote-1',
      quoteNumber: 4701,
      title: 'Pull pump',
      message: 'Proposal',
      quoteStatus: 'converted',
      sentAt: '2026-09-01T12:00:00Z',
      amounts: { subtotal: 600, total: 600 },
      lineItems: { nodes: [line] },
    };
    assert.doesNotThrow(() =>
      assertQuoteUnchangedExceptSalesperson(before, {
        ...before,
        salesperson: { id: BRIGHTON_SALESPERSON_ID, name: { full: 'Brighton Scala' } },
      })
    );
    assert.throws(
      () => assertQuoteUnchangedExceptSalesperson(before, { ...before, quoteStatus: 'approved' }),
      /status converted -> approved/
    );
    assert.throws(
      () =>
        assertQuoteUnchangedExceptSalesperson(before, {
          ...before,
          lineItems: { nodes: [{ ...line, unitPrice: 1 }] },
        }),
      /line items/
    );
  });

  it('sends quoteEdit on a converted quote and returns the re-read salesperson', async () => {
    const bodies: string[] = [];
    let reads = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const parsed = JSON.parse(body || '{}') as { query?: string; variables?: { attributes?: Record<string, unknown> } };
      const query = parsed.query || '';
      if (query.includes('McpUsers')) {
        return jsonResponse({
          data: {
            users: {
              nodes: [
                {
                  id: BRIGHTON_SALESPERSON_ID,
                  status: 'ACTIVATED',
                  name: { full: 'Brighton Scala' },
                  email: { raw: 'info@scwellservice.com' },
                },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        });
      }
      if (query.includes('McpQuoteById')) {
        reads += 1;
        return jsonResponse({
          data: {
            quote: {
              id: 'quote-1',
              quoteNumber: 4701,
              title: 'Pull pump',
              message: 'Proposal',
              quoteStatus: 'converted',
              sentAt: '2026-09-01T12:00:00Z',
              amounts: { subtotal: 600, total: 600 },
              salesperson: reads === 1 ? null : { id: BRIGHTON_SALESPERSON_ID, name: { full: 'Brighton Scala' } },
              lineItems: { nodes: [line] },
            },
          },
        });
      }
      if (query.includes('mutation') && query.includes('quoteEdit')) {
        assert.deepEqual(parsed.variables?.attributes, { salespersonId: BRIGHTON_SALESPERSON_ID });
        return jsonResponse({
          data: { quoteEdit: { quote: { id: 'quote-1', quoteStatus: 'converted' }, userErrors: [] } },
        });
      }
      return jsonResponse({ data: {} });
    };

    const result = await setQuoteSalesperson(
      { quoteId: 'quote-1', salespersonId: BRIGHTON_SALESPERSON_ID },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.changed, true);
    assert.equal(result.quote.salesperson?.id, BRIGHTON_SALESPERSON_ID);
    assert.equal(result.quote.quoteStatus, 'converted');
    assert.ok(bodies.every((body) => !quoteEditUsedForbiddenFields(body)));
    assert.equal(bodies.some((body) => body.includes('quoteCreateLineItems')), false);
  });
});
