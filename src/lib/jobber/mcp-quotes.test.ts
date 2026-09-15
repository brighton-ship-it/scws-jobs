import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertQuoteIsDraftUnsent,
  buildDraftQuoteEditAttributes,
  getClientById,
  quoteEditUsedForbiddenFields,
  updateUnsentQuoteDraft,
} from './mcp-quotes.ts';

describe('draft quote edit safety', () => {
  it('builds edit attributes without send fields', () => {
    const attributes = buildDraftQuoteEditAttributes({
      title: 'Pull well pump and evaluate',
      message: 'Proposal to pull the well pump and evaluate the pumping system.',
    });
    assert.equal(attributes.title, 'Pull well pump and evaluate');
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
