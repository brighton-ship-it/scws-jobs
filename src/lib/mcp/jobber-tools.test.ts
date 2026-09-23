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
    assert.ok(names.includes('search_tasks'));
    assert.ok(names.includes('get_task'));
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
    assert.equal(/quoteCreate\s*\(\s*input:/.test(createQuery), false);
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

  it('searches incomplete tasks for an assignee', async () => {
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) =>
        query.includes('McpTaskUsers')
          ? jsonResponse({
              data: { users: { nodes: [{ id: 'user-trav', name: { full: 'Travis Example' } }] } },
            })
          : null,
      (query) =>
        query.includes('McpTasks')
          ? jsonResponse({
              data: {
                tasks: {
                  nodes: [
                    {
                      id: 'task-1',
                      title: 'Quote follow-up',
                      instructions: 'Call Pat about the well.',
                      isComplete: false,
                      startAt: '2026-09-24T15:00:00.000Z',
                      createdAt: '2026-09-23T12:00:00.000Z',
                      jobberWebUri: 'https://secure.getjobber.com/tasks/1',
                      assignedUsers: { nodes: [{ id: 'user-trav', name: { full: 'Travis Example' } }] },
                      client: { id: 'client-1', name: 'Pat Example' },
                      property: {
                        id: 'prop-1',
                        address: { street1: '100 Oak Rd', city: 'Ramona', province: 'CA', postalCode: '92065' },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: 'c-task-1' },
                },
              },
            })
          : null,
    ]);

    const result = await callJobberMcpTool(
      'search_tasks',
      { assignee: 'Travis' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as {
      incompleteOnly: boolean;
      count: number;
      tasks: Array<{
        id: string;
        title: string;
        instructions: string;
        isComplete: boolean;
        client: { id: string; name: string };
        property: { address: string };
        assignedUsers: Array<{ id: string; name: string }>;
        jobberWebUri: string;
      }>;
    };
    assert.equal(payload.incompleteOnly, true);
    assert.equal(payload.count, 1);
    assert.equal(payload.tasks[0].id, 'task-1');
    assert.equal(payload.tasks[0].title, 'Quote follow-up');
    assert.equal(payload.tasks[0].instructions, 'Call Pat about the well.');
    assert.equal(payload.tasks[0].isComplete, false);
    assert.deepEqual(payload.tasks[0].client, { id: 'client-1', name: 'Pat Example' });
    assert.equal(payload.tasks[0].property.address, '100 Oak Rd, Ramona, CA 92065');
    assert.deepEqual(payload.tasks[0].assignedUsers, [{ id: 'user-trav', name: 'Travis Example' }]);
    assert.equal(payload.tasks[0].jobberWebUri, 'https://secure.getjobber.com/tasks/1');
    assert.match(result.content[0].text, /Read-only/);
    assert.equal(bodies.some((body) => /\bmutation\b/.test(body)), false);
    const sent = JSON.parse(bodies.find((body) => body.includes('McpTasks')) || '{}') as {
      variables?: { filter?: { isComplete?: boolean; assignedTo?: string[] } };
    };
    assert.equal(sent.variables?.filter?.isComplete, false);
    assert.deepEqual(sent.variables?.filter?.assignedTo, ['user-trav']);
  });

  it('loads one task by id', async () => {
    const { fetchImpl } = mockJobberFetch([
      (query) =>
        query.includes('McpTaskById')
          ? jsonResponse({
              data: {
                task: {
                  id: 'task-1',
                  title: 'Quote follow-up',
                  instructions: 'Call Pat',
                  isComplete: false,
                  client: { id: 'client-1', name: 'Pat Example' },
                  assignedUsers: { nodes: [{ id: 'user-trav', name: { full: 'Travis Example' } }] },
                },
              },
            })
          : null,
    ]);
    const result = await callJobberMcpTool(
      'get_task',
      { taskId: 'Z2lkOi8vSm9iYmVyL1Rhc2svMQ' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as { task: { id: string; title: string } };
    assert.equal(payload.task.id, 'task-1');
    assert.equal(payload.task.title, 'Quote follow-up');
    assert.match(result.content[0].text, /Read-only/);
  });

  it('refuses task create, update, and complete', async () => {
    for (const name of ['create_task', 'update_task', 'complete_task', 'completeTask', 'delete_task']) {
      const result = await callJobberMcpTool(name, { taskId: 'task-1' }, { token: 'test' });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /cannot send/i);
      const payload = JSON.parse(result.content[0].text) as { error: string; draftOnly: boolean };
      assert.equal(payload.draftOnly, true);
      assert.match(payload.error, /task/i);
    }
  });

  it('refuses job create, update, and complete', async () => {
    for (const name of ['create_job', 'update_job', 'complete_job', 'completeJob', 'send_job']) {
      const result = await callJobberMcpTool(name, { jobId: 'job-1' }, { token: 'test' });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /cannot send/i);
      const payload = JSON.parse(result.content[0].text) as { error: string; draftOnly: boolean };
      assert.equal(payload.draftOnly, true);
      assert.match(payload.error, /job/i);
    }
  });

  it('refuses invoice send and create', async () => {
    for (const name of ['send_invoice', 'create_invoice', 'sendInvoice']) {
      const result = await callJobberMcpTool(name, { invoiceId: 'inv-1' }, { token: 'test' });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /cannot send/i);
      const payload = JSON.parse(result.content[0].text) as { error: string; draftOnly: boolean };
      assert.equal(payload.draftOnly, true);
    }
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
    assert.ok(rpc.result.tools.some((tool) => tool.name === 'search_tasks'));
    assert.ok(rpc.result.tools.some((tool) => tool.name === 'get_task'));
    assert.equal(
      rpc.result.tools.some((tool) => tool.name === 'send_invoice' || tool.name === 'create_invoice'),
      false
    );
    assert.equal(
      rpc.result.tools.some(
        (tool) => tool.name === 'create_job' || tool.name === 'complete_job' || tool.name === 'update_job'
      ),
      false
    );
    assert.equal(
      rpc.result.tools.some(
        (tool) => tool.name === 'create_task' || tool.name === 'complete_task' || tool.name === 'delete_task'
      ),
      false
    );
  });
});
