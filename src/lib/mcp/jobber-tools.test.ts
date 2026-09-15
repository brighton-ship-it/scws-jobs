import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FORBIDDEN_JOBBER_MCP_TOOLS, JOBBER_MCP_TOOLS, callJobberMcpTool } from './jobber-tools.ts';
import { handleJobberMcpRequest } from './jobber-http.ts';

const CLIENT = {
  id: 'client-1',
  name: 'Pat Example',
  firstName: 'Pat',
  lastName: 'Example',
  emails: [{ address: 'pat@example.com' }],
  phones: [{ number: '7605550100' }],
  properties: {
    nodes: [{ id: 'prop-1', address: { street1: '100 Oak Rd', city: 'Ramona' } }],
  },
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
  it('exposes quote + client tools and none of the forbidden mutations', () => {
    const names = JOBBER_MCP_TOOLS.map((tool) => tool.name);
    assert.ok(names.includes('search_clients'));
    assert.ok(names.includes('create_quote_draft'));
    assert.ok(names.includes('update_quote_draft'));
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
    const query = bodies.find((body) => body.includes('ClientSearch')) || '';
    assert.equal(/properties\s*\(\s*first\s*:/.test(query), false);
    assert.match(query, /properties\s*\{\s*nodes/);
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
        title: 'Pull well pump and evaluate',
        message: 'Proposal to pull the well pump and evaluate the pumping system.',
        lineItems: [{ name: 'BT2', quantity: 1, unitPrice: 600, taxable: false }],
      },
      { fetchImpl, token: 'test' }
    );

    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /quote-1/);
    assert.match(result.content[0].text, /"draft": true/);
    assert.ok(bodies.some((body) => body.includes('quoteCreate')));
    assert.ok(bodies.every((body) => !/transitionQuoteTo/.test(body)));
    assert.ok(bodies.every((body) => !/"sentAt"\s*:/.test(body)));
  });

  it('refuses forbidden send/approve tools', async () => {
    const result = await callJobberMcpTool('send_quote', { quoteId: 'quote-1' }, { token: 'test' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /cannot send/i);
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
    const healthBody = (await health.json()) as { authenticatedAs: string; tools: string[] };
    assert.equal(healthBody.authenticatedAs, 'travis');
    assert.ok(healthBody.tools.includes('create_quote_draft'));

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
  });
});
