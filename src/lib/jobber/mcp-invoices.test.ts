import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInvoiceServerFilter,
  getInvoice,
  invoiceBalanceAmount,
  isOverdueInvoice,
  isUnpaidInvoice,
  searchInvoices,
  type JobberInvoiceDetail,
} from './mcp-invoices.ts';

const OPEN_INVOICE: JobberInvoiceDetail = {
  id: 'inv-1',
  invoiceNumber: '1042',
  subject: 'Well pump',
  invoiceStatus: 'awaiting_payment',
  issuedDate: '2026-01-02T00:00:00Z',
  dueDate: '2020-01-16T00:00:00Z',
  createdAt: '2026-01-02T00:00:00Z',
  clientHubUri: 'https://clienthub.getjobber.com/invoices/1042',
  jobberWebUri: 'https://secure.getjobber.com/invoices/1042',
  amounts: {
    subtotal: 500,
    discountAmount: 0,
    taxAmount: 0,
    total: 500,
    paymentsTotal: 100,
    invoiceBalance: 400,
  },
  client: {
    id: 'client-1',
    name: 'Pat Example',
    companyName: null,
    emails: [{ address: 'pat@example.com' }],
  },
  lineItems: {
    nodes: [{ id: 'li-1', name: 'Pump', description: 'Pull and evaluate', quantity: 1, unitPrice: 500 }],
  },
};

const PAID_INVOICE: JobberInvoiceDetail = {
  ...OPEN_INVOICE,
  id: 'inv-paid',
  invoiceNumber: '1000',
  invoiceStatus: 'paid',
  issuedDate: '2025-06-01T00:00:00Z',
  dueDate: '2025-06-15T00:00:00Z',
  amounts: { ...OPEN_INVOICE.amounts, total: 200, paymentsTotal: 200, invoiceBalance: 0 },
  client: { ...OPEN_INVOICE.client, name: 'Paid Client' },
};

const FUTURE_DUE: JobberInvoiceDetail = {
  ...OPEN_INVOICE,
  id: 'inv-future',
  invoiceNumber: '1100',
  dueDate: '2099-01-01T00:00:00Z',
  issuedDate: '2026-08-01T00:00:00Z',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function connection(
  nodes: JobberInvoiceDetail[],
  pageInfo: { hasNextPage?: boolean; endCursor?: string | null } = {}
) {
  return {
    edges: nodes.map((node) => ({ cursor: `c-${node.id}`, node })),
    pageInfo: {
      hasNextPage: pageInfo.hasNextPage ?? false,
      endCursor: pageInfo.endCursor === undefined ? (nodes.length ? `c-${nodes[nodes.length - 1].id}` : null) : pageInfo.endCursor,
    },
  };
}

function mockFetch(
  handlers: Array<(query: string, variables: Record<string, unknown>) => Response | null>
) {
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

describe('invoice filter helpers', () => {
  it('treats balance > 0 as unpaid and derives balance from payments', () => {
    assert.equal(isUnpaidInvoice(OPEN_INVOICE), true);
    assert.equal(isUnpaidInvoice(PAID_INVOICE), false);
    assert.equal(
      invoiceBalanceAmount({ amounts: { total: 80, paymentsTotal: 30 } }),
      50
    );
    assert.equal(isOverdueInvoice(OPEN_INVOICE, new Date('2026-09-22T00:00:00Z')), true);
    assert.equal(isOverdueInvoice(FUTURE_DUE, new Date('2026-09-22T00:00:00Z')), false);
    assert.equal(isOverdueInvoice({ ...OPEN_INVOICE, invoiceStatus: 'past_due' }), true);
  });

  it('builds an unpaid server filter and an issued-before bound', () => {
    const filter = buildInvoiceServerFilter({
      unpaid: true,
      issuedBefore: '2026-02-01',
    });
    assert.deepEqual(filter?.invoiceStatus, ['awaiting_payment', 'past_due', 'bad_debt']);
    assert.equal(filter?.issuedDate?.before, '2026-02-01T00:00:00.000Z');
    assert.equal(buildInvoiceServerFilter({ status: 'paid' })?.status, 'paid');
  });
});

describe('searchInvoices', () => {
  it('returns unpaid invoices with balance, payment link, and a cursor', async () => {
    const { fetchImpl, bodies } = mockFetch([
      (query) =>
        query.includes('McpInvoices')
          ? jsonResponse({
              data: {
                invoices: connection([OPEN_INVOICE, PAID_INVOICE, FUTURE_DUE]),
              },
            })
          : null,
    ]);

    const result = await searchInvoices({ unpaid: true, first: 10 }, { fetchImpl, token: 'test' });
    assert.deepEqual(
      result.invoices.map((invoice) => invoice.invoiceNumber),
      ['1042', '1100']
    );
    assert.equal(result.invoices[0].balance, 400);
    assert.equal(result.invoices[0].total, 500);
    assert.equal(result.invoices[0].publicUrl, OPEN_INVOICE.clientHubUri);
    assert.equal(result.invoices[0].paymentUrl, OPEN_INVOICE.clientHubUri);
    assert.deepEqual(result.invoices[0].client?.emails, ['pat@example.com']);
    assert.equal(result.invoices[0].lineItems, undefined);
    assert.equal(result.pageInfo.endCursor, 'c-inv-future');
    const variables = JSON.parse(bodies.find((body) => body.includes('McpInvoices')) || '{}') as {
      query?: string;
      variables?: { filter?: { invoiceStatus?: string[] } };
    };
    assert.deepEqual(variables.variables?.filter?.invoiceStatus, ['awaiting_payment', 'past_due', 'bad_debt']);
    assert.equal(bodies.some((body) => /\bmutation\b/.test(body)), false);
    assert.equal(bodies.some((body) => /invoiceCreate|invoiceSend|sendInvoice/.test(body)), false);
  });

  it('continues with the after cursor', async () => {
    const { fetchImpl, bodies } = mockFetch([
      (_query, variables) => {
        if (variables.after === 'c-inv-1') {
          return jsonResponse({
            data: { invoices: connection([FUTURE_DUE], { hasNextPage: false, endCursor: 'c-inv-future' }) },
          });
        }
        return jsonResponse({
          data: {
            invoices: connection([OPEN_INVOICE, FUTURE_DUE], { hasNextPage: false, endCursor: 'c-inv-future' }),
          },
        });
      },
    ]);

    const first = await searchInvoices({ unpaid: true, first: 1 }, { fetchImpl, token: 'test' });
    assert.equal(first.invoices.length, 1);
    assert.equal(first.invoices[0].id, 'inv-1');
    assert.equal(first.pageInfo.hasNextPage, true);
    assert.equal(first.pageInfo.endCursor, 'c-inv-1');

    const second = await searchInvoices(
      { unpaid: true, first: 1, after: first.pageInfo.endCursor },
      { fetchImpl, token: 'test' }
    );
    assert.equal(second.invoices[0].id, 'inv-future');
    const continued = JSON.parse(bodies.at(-1) || '{}') as { variables?: { after?: string } };
    assert.equal(continued.variables?.after, 'c-inv-1');
  });

  it('still filters unpaid when Jobber rejects invoiceStatus on the filter input', async () => {
    const { fetchImpl } = mockFetch([
      (_query, variables) => {
        const filter = variables.filter as { invoiceStatus?: unknown } | undefined;
        if (filter?.invoiceStatus) {
          return jsonResponse({
            errors: [
              {
                message: "InputObject 'InvoiceFilterAttributes' doesn't accept argument 'invoiceStatus'",
              },
            ],
          });
        }
        return jsonResponse({ data: { invoices: connection([OPEN_INVOICE, PAID_INVOICE]) } });
      },
    ]);

    const result = await searchInvoices({ unpaid: true }, { fetchImpl, token: 'test' });
    assert.deepEqual(
      result.invoices.map((invoice) => invoice.id),
      ['inv-1']
    );
  });

  it('filters issued-before on the client when Jobber rejects the filter field', async () => {
    const recent: JobberInvoiceDetail = {
      ...OPEN_INVOICE,
      id: 'inv-recent',
      invoiceNumber: '2000',
      issuedDate: '2026-03-01T00:00:00Z',
    };
    const { fetchImpl } = mockFetch([
      (_query, variables) => {
        const filter = variables.filter as { issuedDate?: unknown } | undefined;
        if (filter?.issuedDate) {
          return jsonResponse({
            errors: [
              {
                message: "InputObject 'InvoiceFilterAttributes' doesn't accept argument 'issuedDate'",
              },
            ],
          });
        }
        return jsonResponse({ data: { invoices: connection([OPEN_INVOICE, recent]) } });
      },
    ]);

    const result = await searchInvoices(
      { issuedBefore: '2026-02-01' },
      { fetchImpl, token: 'test' }
    );
    assert.deepEqual(
      result.invoices.map((invoice) => invoice.id),
      ['inv-1']
    );
  });

  it('keeps overdue invoices and drops ones that are not due yet', async () => {
    const { fetchImpl } = mockFetch([
      () => jsonResponse({ data: { invoices: connection([OPEN_INVOICE, FUTURE_DUE, PAID_INVOICE]) } }),
    ]);
    const result = await searchInvoices({ overdue: true }, { fetchImpl, token: 'test' });
    assert.deepEqual(
      result.invoices.map((invoice) => invoice.id),
      ['inv-1']
    );
    assert.equal(result.invoices[0].overdue, true);
  });

  it('falls back to client invoices when invoice searchTerm is rejected', async () => {
    const { fetchImpl, bodies } = mockFetch([
      (query) => {
        if (query.includes('searchTerm') && query.includes('McpInvoices')) {
          return jsonResponse({
            errors: [{ message: "Field 'invoices' doesn't accept argument 'searchTerm'" }],
          });
        }
        if (query.includes('ClientSearch')) {
          return jsonResponse({
            data: { clients: { nodes: [{ id: 'client-1', name: 'Pat Example' }] } },
          });
        }
        if (query.includes('McpClientInvoices')) {
          return jsonResponse({ data: { client: { invoices: connection([OPEN_INVOICE, PAID_INVOICE]) } } });
        }
        if (query.includes('McpInvoices')) {
          return jsonResponse({ data: { invoices: connection([]) } });
        }
        return null;
      },
    ]);

    const result = await searchInvoices(
      { query: 'Pat Example', unpaid: true },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.invoices.length, 1);
    assert.equal(result.invoices[0].id, 'inv-1');
    assert.equal(result.invoices[0].client?.name, 'Pat Example');
    assert.ok(bodies.some((body) => body.includes('McpClientInvoices')));
    assert.equal(bodies.some((body) => /\bmutation\b/.test(body)), false);
  });

  it('computes balance when invoiceBalance is not on the schema', async () => {
    const { fetchImpl } = mockFetch([
      (query) => {
        if (query.includes('invoiceBalance')) {
          return jsonResponse({
            errors: [{ message: "Field 'invoiceBalance' doesn't exist on type 'InvoiceAmounts'" }],
          });
        }
        const node = {
          ...OPEN_INVOICE,
          amounts: { subtotal: 500, discountAmount: 0, taxAmount: 0, total: 500, paymentsTotal: 125 },
        };
        return jsonResponse({ data: { invoices: connection([node]) } });
      },
    ]);

    const result = await searchInvoices({ query: '1042' }, { fetchImpl, token: 'test' });
    assert.equal(result.invoices[0].balance, 375);
    assert.equal(result.invoices[0].amounts.invoiceBalance, null);
    assert.equal(result.invoices[0].unpaid, true);
  });
});

describe('getInvoice', () => {
  it('loads one invoice by encoded id, including the line summary and emails', async () => {
    const { fetchImpl, bodies } = mockFetch([
      (query) =>
        query.includes('McpInvoiceById')
          ? jsonResponse({ data: { invoice: OPEN_INVOICE } })
          : null,
    ]);

    const invoice = await getInvoice(
      { invoiceId: 'Z2lkOi8vSm9iYmVyL0ludm9pY2UvMTA0Mg==' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(invoice.id, 'inv-1');
    assert.equal(invoice.invoiceNumber, '1042');
    assert.equal(invoice.invoiceStatus, 'awaiting_payment');
    assert.equal(invoice.issuedDate, OPEN_INVOICE.issuedDate);
    assert.equal(invoice.dueDate, OPEN_INVOICE.dueDate);
    assert.deepEqual(invoice.client?.emails, ['pat@example.com']);
    assert.equal(invoice.amounts.total, 500);
    assert.equal(invoice.balance, 400);
    assert.equal(invoice.lineItems?.[0]?.name, 'Pump');
    assert.equal(invoice.publicUrl, OPEN_INVOICE.clientHubUri);
    const query =
      (JSON.parse(bodies.find((body) => body.includes('McpInvoiceById')) || '{}') as { query?: string }).query ||
      '';
    assert.match(query, /query McpInvoiceById/);
    assert.equal(/\bmutation\b/.test(query), false);
  });

  it('loads one invoice by invoice number', async () => {
    const decoy: JobberInvoiceDetail = { ...FUTURE_DUE, invoiceNumber: '9999' };
    const { fetchImpl } = mockFetch([
      (query) =>
        query.includes('McpInvoices')
          ? jsonResponse({ data: { invoices: connection([decoy, OPEN_INVOICE]) } })
          : null,
    ]);

    const invoice = await getInvoice({ invoiceNumber: '1042', includeLineItems: false }, { fetchImpl, token: 'test' });
    assert.equal(invoice.id, 'inv-1');
    assert.equal(invoice.lineItems, undefined);
  });

  it('errors when neither id nor number is provided', async () => {
    await assert.rejects(() => getInvoice({}), /invoiceId or invoiceNumber is required/);
  });
});
