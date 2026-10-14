import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDraftQuoteLineEdits,
  assertQuoteIsDraftUnsent,
  assertQuoteUnchangedExceptSalesperson,
  buildDraftQuoteEditAttributes,
  buildSalespersonOnlyEditAttributes,
  deleteUnsentQuoteDraft,
  getClientById,
  parseQuoteLineEdits,
  quoteEditUsedForbiddenFields,
  quoteNumbersMatch,
  setQuoteSalesperson,
  toJobberEditLineItems,
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

const DRAFT_LINES = {
  id: 'quote-1',
  quoteNumber: 4401,
  title: 'Old title',
  quoteStatus: 'draft',
  sentAt: null,
  lineItems: {
    nodes: [
      { id: 'li-1', name: 'Pump', quantity: 1, unitPrice: 100, taxable: true, optional: false },
      { id: 'li-2', name: 'Labor', quantity: 1, unitPrice: 200, taxable: false, optional: true },
    ],
  },
};

describe('draft quote line edits', () => {
  it('maps an edit onto QuoteEditLineItemAttributes without saveToProductsAndServices', () => {
    const edits = parseQuoteLineEdits([
      {
        lineItemId: ' li-1 ',
        name: 'Pump revised',
        description: '',
        quantity: 2,
        unitPrice: 80,
        taxable: false,
        optional: false,
      },
    ]);
    assert.deepEqual(toJobberEditLineItems(edits), [
      {
        lineItemId: 'li-1',
        name: 'Pump revised',
        description: '',
        quantity: 2,
        unitPrice: 80,
        taxable: false,
        optional: false,
      },
    ]);
    assert.equal(JSON.stringify(toJobberEditLineItems(edits)).includes('saveToProductsAndServices'), false);
    assert.throws(() => parseQuoteLineEdits([{ lineItemId: 'li-1' }]), /must change/);
    assert.throws(
      () => parseQuoteLineEdits([{ lineItemId: 'li-1', name: 'X', productOrServiceId: 'p' }]),
      /cannot be changed/
    );
    assert.throws(
      () => parseQuoteLineEdits([{ lineItemId: 'li-1', optional: false, recommended: true }]),
      /must stay optional/
    );
  });

  it('refuses deleting every line and lines that are not on the quote', () => {
    assert.throws(
      () => assertDraftQuoteLineEdits(DRAFT_LINES, { removes: ['li-1', 'li-2'] }),
      /every line item/
    );
    assert.doesNotThrow(() =>
      assertDraftQuoteLineEdits(DRAFT_LINES, { removes: ['li-1', 'li-2'], addCount: 1 })
    );
    assert.throws(() => assertDraftQuoteLineEdits(DRAFT_LINES, { removes: ['missing'] }), /not on quote 4401/);
    assert.throws(
      () => assertDraftQuoteLineEdits(DRAFT_LINES, { updates: [{ lineItemId: 'li-1', name: 'X' }], removes: ['li-1'] }),
      /edited and deleted/
    );
  });

  it('edits and deletes draft lines, adding a replacement before the delete', async () => {
    const bodies: string[] = [];
    const order: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const parsed = JSON.parse(body || '{}') as { query?: string; variables?: Record<string, unknown> };
      const query = parsed.query || '';
      if (query.includes('McpQuoteById')) {
        return jsonResponse({ data: { quote: DRAFT_LINES } });
      }
      if (query.includes('quoteCreateLineItems')) order.push('create');
      if (query.includes('quoteEditLineItems')) order.push('edit');
      if (query.includes('quoteDeleteLineItems')) order.push('delete');
      if (query.includes('McpQuoteEditLineItems')) {
        return jsonResponse({
          data: { quoteEditLineItems: { modifiedLineItems: [{ id: 'li-2' }], userErrors: [] } },
        });
      }
      if (query.includes('McpQuoteDeleteLineItems')) {
        return jsonResponse({
          data: { quoteDeleteLineItems: { deletedLineItems: [{ id: 'li-1' }], userErrors: [] } },
        });
      }
      if (query.includes('McpQuoteCreateLineItems')) {
        return jsonResponse({
          data: { quoteCreateLineItems: { createdLineItems: [{ id: 'li-3' }], userErrors: [] } },
        });
      }
      return jsonResponse({ data: {} });
    };

    await updateUnsentQuoteDraft(
      {
        quoteId: 'quote-1',
        addLineItems: [{ name: 'Replacement', quantity: 1, unitPrice: 50, taxable: true }],
        updateLineItems: [{ lineItemId: 'li-2', name: 'Labor revised', optional: true, recommended: true }],
        removeLineItemIds: ['li-1'],
      },
      { fetchImpl, token: 'test' }
    );

    assert.deepEqual(order, ['create', 'edit', 'delete']);
    const editBody = JSON.parse(
      bodies.find((body) => (JSON.parse(body) as { query?: string }).query?.includes('quoteEditLineItems')) || '{}'
    ) as { variables?: { lineItems?: Array<Record<string, unknown>> } };
    assert.deepEqual(editBody.variables?.lineItems, [
      { lineItemId: 'li-2', name: 'Labor revised', optional: true, recommended: true },
    ]);
    const deleteBody = JSON.parse(
      bodies.find((body) => (JSON.parse(body) as { query?: string }).query?.includes('quoteDeleteLineItems')) || '{}'
    ) as { variables?: { lineItemIds?: string[] } };
    assert.deepEqual(deleteBody.variables?.lineItemIds, ['li-1']);
    assert.ok(bodies.every((body) => !quoteEditUsedForbiddenFields(body)));
    assert.equal(bodies.some((body) => body.includes('saveToProductsAndServices') && body.includes('quoteEditLineItems')), false);
  });

  it('refuses line edits on a sent quote before any line mutation', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body || ''));
      return jsonResponse({
        data: {
          quote: {
            ...DRAFT_LINES,
            quoteStatus: 'awaiting_response',
            sentAt: '2026-09-01T00:00:00Z',
          },
        },
      });
    };
    await assert.rejects(
      () =>
        updateUnsentQuoteDraft(
          { quoteId: 'quote-1', updateLineItems: [{ lineItemId: 'li-1', name: 'Nope' }], removeLineItemIds: ['li-2'] },
          { fetchImpl, token: 'test' }
        ),
      /only unsent drafts/
    );
    assert.equal(bodies.some((body) => body.includes('quoteEditLineItems')), false);
    assert.equal(bodies.some((body) => body.includes('quoteDeleteLineItems')), false);
    assert.equal(bodies.some((body) => body.includes('quoteCreateLineItems')), false);
  });
});

const DRAFT_QUOTE_ID = 'Z2lkOi8vSm9iYmVyL1F1b3RlLzE';

function draftQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_QUOTE_ID,
    quoteNumber: 4401,
    quoteStatus: 'draft',
    sentAt: null,
    ...overrides,
  };
}

describe('deleteUnsentQuoteDraft', () => {
  it('matches quote numbers and refuses a non-draft before any mutation', async () => {
    assert.equal(quoteNumbersMatch(4401, '4401'), true);
    assert.equal(quoteNumbersMatch('#4401', '4401'), true);
    assert.equal(quoteNumbersMatch('4401', '4402'), false);

    for (const overrides of [
      { quoteStatus: 'awaiting_response', sentAt: '2026-09-01T00:00:00Z' },
      { quoteStatus: 'approved', sentAt: '2026-09-01T00:00:00Z' },
      { quoteStatus: 'converted', sentAt: '2026-09-01T00:00:00Z' },
      { quoteStatus: 'archived', sentAt: null },
      { quoteStatus: 'changes_requested', sentAt: '2026-09-01T00:00:00Z' },
      { quoteStatus: 'draft', sentAt: '2026-09-01T00:00:00Z' },
    ]) {
      const bodies: string[] = [];
      const fetchImpl: typeof fetch = async (_url, init) => {
        bodies.push(String(init?.body || ''));
        return jsonResponse({ data: { quote: draftQuote(overrides) } });
      };
      await assert.rejects(
        () => deleteUnsentQuoteDraft({ quoteId: DRAFT_QUOTE_ID }, { fetchImpl, token: 'test' }),
        /only an unsent draft/
      );
      assert.equal(bodies.some((body) => /\bmutation\b/.test(body)), false);
    }
  });

  it('deletes a draft with quoteDelete and reports that method', async () => {
    let reads = 0;
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const query = (JSON.parse(body) as { query?: string }).query || '';
      if (query.includes('McpQuoteById')) {
        reads += 1;
        return jsonResponse({
          data: { quote: reads === 1 ? draftQuote() : null },
        });
      }
      if (query.includes('quoteDelete')) {
        return jsonResponse({
          data: { quoteDelete: { deletedQuote: { id: DRAFT_QUOTE_ID }, userErrors: [] } },
        });
      }
      return jsonResponse({ data: {} });
    };
    const result = await deleteUnsentQuoteDraft({ quoteId: DRAFT_QUOTE_ID }, { fetchImpl, token: 'test' });
    assert.equal(result.method, 'quoteDelete');
    assert.equal(result.deleted, true);
    assert.equal(result.archived, false);
    assert.equal(result.sent, false);
    assert.equal(result.notified, false);
    assert.equal(result.quoteStatus, null);
    assert.equal(result.quoteNumber, 4401);
    assert.equal(bodies.some((body) => body.includes('quoteArchive')), false);
    assert.ok(bodies.every((body) => !quoteEditUsedForbiddenFields(body)));
    assert.equal(bodies.some((body) => /transitionQuoteTo/.test(body)), false);
  });

  it('falls through to quoteArchive only when quoteDelete is not in the schema', async () => {
    let reads = 0;
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const query = (JSON.parse(body) as { query?: string }).query || '';
      if (query.includes('McpQuoteById')) {
        reads += 1;
        return jsonResponse({
          data: {
            quote: reads === 1 ? draftQuote() : draftQuote({ quoteStatus: 'archived' }),
          },
        });
      }
      if (query.includes('quoteDelete')) {
        return jsonResponse({
          errors: [{ message: 'Cannot query field "quoteDelete" on type "Mutation".' }],
        });
      }
      if (query.includes('quoteArchive')) {
        return jsonResponse({
          data: { quoteArchive: { quote: { id: DRAFT_QUOTE_ID, quoteStatus: 'archived' }, userErrors: [] } },
        });
      }
      return jsonResponse({ data: {} });
    };
    const result = await deleteUnsentQuoteDraft({ quoteId: DRAFT_QUOTE_ID }, { fetchImpl, token: 'test' });
    assert.equal(result.method, 'quoteArchive');
    assert.equal(result.deleted, false);
    assert.equal(result.archived, true);
    assert.equal(result.quoteStatus, 'archived');
    assert.equal(result.sent, false);
    assert.equal(bodies.filter((body) => body.includes('quoteDelete')).length, 1);
    assert.ok(bodies.every((body) => !quoteEditUsedForbiddenFields(body)));
  });

  it('does not archive when quoteDelete returns userErrors', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const query = (JSON.parse(body) as { query?: string }).query || '';
      if (query.includes('McpQuoteById')) return jsonResponse({ data: { quote: draftQuote() } });
      if (query.includes('quoteDelete')) {
        return jsonResponse({
          data: { quoteDelete: { deletedQuote: null, userErrors: [{ message: 'Quote cannot be deleted' }] } },
        });
      }
      return jsonResponse({ data: {} });
    };
    await assert.rejects(
      () => deleteUnsentQuoteDraft({ quoteId: DRAFT_QUOTE_ID }, { fetchImpl, token: 'test' }),
      /No other mutation was tried/
    );
    assert.equal(bodies.some((body) => body.includes('quoteArchive')), false);
  });

  it('retries quoteDelete with an input argument, then without deletedQuote', async () => {
    let reads = 0;
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      const query = (JSON.parse(body) as { query?: string }).query || '';
      if (query.includes('McpQuoteById')) {
        reads += 1;
        return jsonResponse({ data: { quote: reads === 1 ? draftQuote() : null } });
      }
      if (query.includes('quoteDelete')) {
        seen.push(query.includes('deletedQuote') ? 'selected' : 'bare');
        if (!query.includes('input:')) {
          return jsonResponse({
            errors: [{ message: 'Unknown argument "quoteId" on field "Mutation.quoteDelete".' }],
          });
        }
        if (query.includes('deletedQuote')) {
          return jsonResponse({
            errors: [{ message: 'Cannot query field "deletedQuote" on type "QuoteDeletePayload".' }],
          });
        }
        return jsonResponse({ data: { quoteDelete: { userErrors: [] } } });
      }
      return jsonResponse({ data: {} });
    };
    const result = await deleteUnsentQuoteDraft({ quoteId: DRAFT_QUOTE_ID }, { fetchImpl, token: 'test' });
    assert.equal(result.method, 'quoteDelete');
    assert.equal(result.deleted, true);
    assert.deepEqual(seen, ['selected', 'selected', 'bare']);
  });

  it('looks up one quote number and refuses an ambiguous number', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const query = (JSON.parse(body) as { query?: string }).query || '';
      if (query.includes('McpQuotesSearch')) {
        return jsonResponse({
          data: {
            quotes: {
              nodes: [
                draftQuote(),
                draftQuote({ id: 'Z2lkOi8vSm9iYmVyL1F1b3RlLzI' }),
              ],
            },
          },
        });
      }
      return jsonResponse({ data: { clients: { nodes: [] } } });
    };
    await assert.rejects(
      () => deleteUnsentQuoteDraft({ quoteNumber: '4401' }, { fetchImpl, token: 'test' }),
      /matches 2 quotes/
    );
    assert.equal(bodies.some((body) => /\bmutation\b/.test(body)), false);

    let reads = 0;
    const fetchOne: typeof fetch = async (_url, init) => {
      const query = (JSON.parse(String(init?.body || '')) as { query?: string }).query || '';
      if (query.includes('McpQuotesSearch')) {
        return jsonResponse({ data: { quotes: { nodes: [draftQuote()] } } });
      }
      if (query.includes('McpQuoteById')) {
        reads += 1;
        return jsonResponse({ data: { quote: reads === 1 ? draftQuote() : null } });
      }
      if (query.includes('quoteDelete')) {
        return jsonResponse({ data: { quoteDelete: { deletedQuote: { id: DRAFT_QUOTE_ID }, userErrors: [] } } });
      }
      return jsonResponse({ data: { clients: { nodes: [] } } });
    };
    const result = await deleteUnsentQuoteDraft({ quoteNumber: '#4401' }, { fetchImpl: fetchOne, token: 'test' });
    assert.equal(result.method, 'quoteDelete');
    assert.equal(result.deleted, true);

    await assert.rejects(
      () => deleteUnsentQuoteDraft({ quoteId: DRAFT_QUOTE_ID, quoteNumber: '4401' }, { token: 'test' }),
      /not both/
    );
    await assert.rejects(
      () => deleteUnsentQuoteDraft({ quoteId: '4401' }, { token: 'test' }),
      /encoded Jobber id/
    );
  });

  it('does not mark a draft awaiting response when archive is also missing', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const query = (JSON.parse(body) as { query?: string }).query || '';
      if (query.includes('McpQuoteById')) return jsonResponse({ data: { quote: draftQuote() } });
      if (query.includes('quoteDelete')) {
        return jsonResponse({ errors: [{ message: 'Cannot query field "quoteDelete" on type "Mutation".' }] });
      }
      if (query.includes('quoteArchive')) {
        return jsonResponse({ errors: [{ message: 'Cannot query field "quoteArchive" on type "Mutation".' }] });
      }
      return jsonResponse({ data: {} });
    };
    await assert.rejects(
      () => deleteUnsentQuoteDraft({ quoteId: DRAFT_QUOTE_ID }, { fetchImpl, token: 'test' }),
      /no quoteDelete or quoteArchive/
    );
    assert.equal(bodies.some((body) => /transitionQuoteTo/.test(body)), false);
    assert.ok(bodies.every((body) => !quoteEditUsedForbiddenFields(body)));
  });
});
