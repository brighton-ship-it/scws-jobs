import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertInvoiceWriteDoesNotDeliver,
  assertNoInvoicePaymentOptions,
  buildInvoiceEditInput,
  buildUnsentInvoiceCreateInput,
  createInvoiceDraftFromJob,
  editInvoice,
  parseInvoiceLineDrafts,
} from './mcp-invoice-writes.ts';

const INVOICE_ID = 'Z2lkOi8vSm9iYmVyL0ludm9pY2UvNTgwNg';
const JOB_ID = 'Z2lkOi8vSm9iYmVyL0pvYi84ODAx';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function invoiceNode(extra?: Record<string, unknown>) {
  return {
    id: INVOICE_ID,
    invoiceNumber: '5806',
    subject: 'Well service',
    invoiceStatus: 'awaiting_payment',
    issuedDate: '2026-09-01',
    dueDate: '2026-09-15',
    createdAt: '2026-09-01T00:00:00Z',
    clientHubUri: 'https://clienthub.getjobber.com/invoices/5806',
    jobberWebUri: 'https://secure.getjobber.com/invoices/5806',
    amounts: {
      subtotal: 17617.59,
      discountAmount: 0,
      taxAmount: 0,
      total: 17617.59,
      paymentsTotal: 0,
      invoiceBalance: 17617.59,
    },
    client: {
      id: 'client-1',
      name: 'Pat Example',
      emails: [{ address: 'pat@example.com' }],
    },
    lineItems: {
      nodes: [
        { id: 'li-pump', name: 'Pump', description: null, quantity: 1, unitPrice: 17617.59 },
        ...(extra?.lineItems as unknown[] || []),
      ],
    },
  };
}

describe('invoice write builders', () => {
  it('builds the non-taxable card-fee line for invoice edits', () => {
    const input = buildInvoiceEditInput({
      addLineItems: parseInvoiceLineDrafts(
        [
          {
            name: 'Credit card processing fee (2.9%)',
            description: 'Card processing',
            quantity: 1,
            unitPrice: 510.91,
            taxable: false,
          },
        ],
        'addLineItems'
      ),
      taxRateId: 'sd-tax',
    });
    assert.deepEqual(input.lineItemsToAdd, [
      {
        name: 'Credit card processing fee (2.9%)',
        description: 'Card processing',
        quantity: 1,
        unitPrice: 510.91,
        taxable: false,
        saveToProductsAndServices: false,
      },
    ]);
    assert.equal(input.taxRateId, 'sd-tax');
    assert.equal('issuedDate' in input, false);
  });

  it('builds an unsent invoice create from a job', () => {
    const input = buildUnsentInvoiceCreateInput({
      clientId: 'client-1',
      jobId: JOB_ID,
      subject: 'Job 8801',
      lineItems: [{ name: 'Pump', quantity: 1, unitPrice: 100, taxable: true }],
      taxRateId: 'sd-tax',
    });
    assert.equal(input.clientId, 'client-1');
    assert.equal(input.jobId, JOB_ID);
    assert.deepEqual(input.tax, { taxCalculationMethod: 'EXCLUSIVE' });
    assert.deepEqual(input.dueDetails, {});
    assert.equal(input.taxRateId, 'sd-tax');
    assert.equal('issuedDate' in input, false);
    assert.equal(JSON.stringify(input).includes('invoiceMarkAsSent'), false);
  });

  it('rejects payment toggles and delivery mutations', () => {
    assert.throws(
      () => assertNoInvoicePaymentOptions({ allowCardPayments: true, allowPartialPayments: true }),
      /Unsupported/
    );
    assert.throws(
      () => assertInvoiceWriteDoesNotDeliver('mutation { invoiceMarkAsSent(id: "x") { invoice { id } } }'),
      /cannot send/
    );
  });
});

describe('editInvoice', () => {
  it('sends invoiceEdit for the fee line and does not mark the invoice sent', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const query = (JSON.parse(body) as { query?: string }).query || '';
      if (query.includes('mutation') && query.includes('invoiceEdit')) {
        return jsonResponse({
          data: {
            invoiceEdit: {
              invoice: { id: INVOICE_ID, invoiceNumber: '5806', invoiceStatus: 'awaiting_payment' },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes('invoice(id:')) {
        return jsonResponse({ data: { invoice: invoiceNode() } });
      }
      return jsonResponse({ errors: [{ message: `unexpected ${query.slice(0, 80)}` }] });
    };

    const invoice = await editInvoice(
      {
        invoiceId: INVOICE_ID,
        addLineItems: [
          {
            name: 'Credit card processing fee (2.9%)',
            quantity: 1,
            unitPrice: 510.91,
            taxable: false,
          },
        ],
      },
      { fetchImpl, token: 'test' }
    );
    assert.equal(invoice.invoiceNumber, '5806');
    const edit = bodies.find((body) => body.includes('invoiceEdit'));
    assert.ok(edit);
    const variables = (JSON.parse(edit) as { variables: { input: { lineItemsToAdd: Array<Record<string, unknown>> } } })
      .variables;
    assert.equal(variables.input.lineItemsToAdd[0].taxable, false);
    assert.equal(variables.input.lineItemsToAdd[0].unitPrice, 510.91);
    assert.ok(bodies.every((body) => !/invoiceMarkAsSent|invoiceSend|sendInvoice/.test(body)));
  });
});

describe('createInvoiceDraftFromJob', () => {
  it('creates with invoiceCreate and never marks sent', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const query = (JSON.parse(body) as { query?: string }).query || '';
      if (query.includes('mutation') && query.includes('invoiceCreate')) {
        return jsonResponse({
          data: {
            invoiceCreate: {
              invoice: { id: INVOICE_ID, invoiceNumber: '5810', invoiceStatus: 'draft', subject: 'Job 8801' },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes('job(id:')) {
        return jsonResponse({
          data: {
            job: {
              id: JOB_ID,
              jobNumber: 8801,
              title: 'Pull pump',
              jobStatus: 'active',
              client: { id: 'client-1', name: 'Pat', firstName: 'Pat' },
              property: { id: 'prop-1', address: { city: 'Ramona' } },
              noteAttachments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
            },
          },
        });
      }
      if (query.includes('invoice(id:')) {
        return jsonResponse({
          data: {
            invoice: {
              ...invoiceNode(),
              id: INVOICE_ID,
              invoiceNumber: '5810',
              invoiceStatus: 'draft',
            },
          },
        });
      }
      return jsonResponse({ errors: [{ message: 'unexpected query' }] });
    };

    const result = await createInvoiceDraftFromJob(
      {
        jobId: JOB_ID,
        lineItems: [{ name: 'Pump', quantity: 1, unitPrice: 100, taxable: true }],
        taxRateId: 'sd-tax',
      },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.invoice.invoiceStatus, 'draft');
    const create = JSON.parse(bodies.find((body) => body.includes('invoiceCreate')) || '{}') as {
      variables?: { input?: Record<string, unknown> };
    };
    assert.equal(create.variables?.input?.jobId, JOB_ID);
    assert.equal(create.variables?.input?.clientId, 'client-1');
    assert.equal('issuedDate' in (create.variables?.input || {}), false);
    assert.ok(bodies.every((body) => !/invoiceMarkAsSent|invoiceSend/.test(body)));
  });
});
