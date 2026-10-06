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
  it('maps Client Hub payment settings onto InvoiceEditInput fields', () => {
    const input = buildInvoiceEditInput({
      taxRateId: 'sd-tax',
      allowCardPayments: true,
      allowAchPayments: false,
      allowPartialPayments: true,
    });
    assert.deepEqual(input, {
      taxRateId: 'sd-tax',
      allowClientHubCreditCardPayments: true,
      allowClientHubAchPayments: false,
      allowPartialPayments: true,
    });
    assert.equal('allowCardPayments' in input, false);
    assert.equal('allowAchPayments' in input, false);
    assert.equal('lineItemsToEdit' in input, false);
  });

  it('refuses add, update, and remove line items', () => {
    const fee = parseInvoiceLineDrafts(
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
    );
    const message = /Jobber's API cannot edit invoice line items; use the Jobber web UI\./;
    assert.throws(() => buildInvoiceEditInput({ addLineItems: fee, allowCardPayments: true }), message);
    assert.throws(
      () =>
        buildInvoiceEditInput({
          updateLineItems: [{ lineItemId: 'li-1', name: 'Pump', quantity: 1, unitPrice: 100 }],
        }),
      message
    );
    assert.throws(() => buildInvoiceEditInput({ removeLineItemIds: ['li-1'] }), message);
    assert.throws(() => buildInvoiceEditInput({}), /taxRateId/);
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
    assert.deepEqual(input.lineItems, [
      { name: 'Pump', quantity: 1, unitPrice: 100, taxable: true },
    ]);
  });

  it('omits saveToProductsAndServices, which InvoiceCreationLineItemInput does not define', () => {
    const lines = parseInvoiceLineDrafts(
      [
        {
          name: 'Goulds 25GBC',
          description: '1 HP',
          quantity: 1,
          unitPrice: 899,
          taxable: true,
          productOrServiceId: 'prod-25gbc',
          saveToProductsAndServices: false,
          optional: true,
          recommended: true,
        },
      ],
      'lineItems'
    );
    const input = buildUnsentInvoiceCreateInput({
      clientId: 'client-1',
      jobId: JOB_ID,
      subject: 'Job 8801',
      lineItems: lines,
    });
    assert.deepEqual(input.lineItems, [
      {
        name: 'Goulds 25GBC',
        description: '1 HP',
        quantity: 1,
        unitPrice: 899,
        taxable: true,
      },
    ]);
    const wire = JSON.stringify(input.lineItems);
    assert.equal(wire.includes('saveToProductsAndServices'), false);
    assert.equal(wire.includes('productOrServiceId'), false);
    assert.equal(wire.includes('optional'), false);
  });

  it('allows payment settings and still rejects send, record, and collect', () => {
    assert.doesNotThrow(() =>
      assertNoInvoicePaymentOptions({
        allowCardPayments: true,
        allowAchPayments: true,
        allowPartialPayments: false,
      })
    );
    assert.throws(
      () => assertNoInvoicePaymentOptions({ recordPayment: true, collectPayment: 10 }),
      /cannot send, mark sent, record, or collect/
    );
    assert.throws(
      () => assertInvoiceWriteDoesNotDeliver('mutation { invoiceMarkAsSent(id: "x") { invoice { id } } }'),
      /cannot send/
    );
  });
});

describe('editInvoice', () => {
  it('does not call Jobber when the caller tries to update a line', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ errors: [{ message: 'should not be called' }] });
    };
    await assert.rejects(
      () =>
        editInvoice(
          {
            invoiceId: INVOICE_ID,
            updateLineItems: [{ lineItemId: 'li-pump', name: 'Pump', quantity: 1, unitPrice: 100, taxable: true }],
          },
          { fetchImpl, token: 'test' }
        ),
      /Jobber's API cannot edit invoice line items; use the Jobber web UI/
    );
    assert.equal(calls, 0);
  });

  it('sends invoiceEdit with taxRateId only and does not mark the invoice sent', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const query = (JSON.parse(body) as { query?: string }).query || '';
      if (query.includes('mutation') && query.includes('invoiceEdit')) {
        return jsonResponse({
          data: {
            invoiceEdit: {
              invoice: { id: INVOICE_ID, invoiceNumber: '5764', invoiceStatus: 'draft' },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes('invoice(id:')) {
        return jsonResponse({ data: { invoice: { ...invoiceNode(), invoiceNumber: '5764', invoiceStatus: 'draft' } } });
      }
      return jsonResponse({ errors: [{ message: `unexpected ${query.slice(0, 80)}` }] });
    };

    const invoice = await editInvoice({ invoiceId: INVOICE_ID, taxRateId: 'sd-tax' }, { fetchImpl, token: 'test' });
    assert.equal(invoice.invoiceNumber, '5764');
    const edit = bodies.find((body) => body.includes('invoiceEdit'));
    assert.ok(edit);
    const variables = (JSON.parse(edit) as { query: string; variables: { input: Record<string, unknown> } }).variables;
    assert.deepEqual(variables.input, { taxRateId: 'sd-tax' });
    assert.equal(variables.input.lineItemsToEdit, undefined);
    assert.ok(bodies.every((body) => !/invoiceMarkAsSent|invoiceSend|sendInvoice|invoiceCreateLineItems|invoiceEditLineItems|invoiceDeleteLineItems/.test(body)));
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
    assert.equal(result.invoice.invoiceNumber, '5810');
    assert.equal(result.invoice.jobberWebUri, 'https://secure.getjobber.com/invoices/5806');
    assert.equal(result.invoice.amounts.total, 17617.59);
    const create = JSON.parse(bodies.find((body) => body.includes('invoiceCreate')) || '{}') as {
      variables?: { input?: { lineItems?: Array<Record<string, unknown>> } };
    };
    assert.equal(create.variables?.input?.jobId, JOB_ID);
    assert.equal(create.variables?.input?.clientId, 'client-1');
    assert.equal('issuedDate' in (create.variables?.input || {}), false);
    assert.deepEqual(create.variables?.input?.lineItems, [
      { name: 'Pump', quantity: 1, unitPrice: 100, taxable: true },
    ]);
    assert.ok(bodies.every((body) => !/invoiceMarkAsSent|invoiceSend|saveToProductsAndServices/.test(body)));
  });

  it('copies job lines onto an unsent draft without saveToProductsAndServices', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const query = (JSON.parse(body) as { query?: string }).query || '';
      if (query.includes('mutation') && query.includes('invoiceCreate')) {
        return jsonResponse({
          data: {
            invoiceCreate: {
              invoice: { id: INVOICE_ID, invoiceNumber: '5811', invoiceStatus: 'draft', subject: 'Pull pump' },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes('McpJobLinesForInvoice')) {
        return jsonResponse({
          data: {
            job: {
              id: JOB_ID,
              lineItems: {
                nodes: [
                  {
                    name: 'Pump pull',
                    description: 'Evaluate the pumping system',
                    quantity: 1,
                    unitPrice: 600,
                    taxable: false,
                  },
                ],
              },
            },
          },
        });
      }
      if (query.includes('job(id:') || query.includes('McpJobById')) {
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
              invoiceNumber: '5811',
              invoiceStatus: 'draft',
            },
          },
        });
      }
      return jsonResponse({ errors: [{ message: 'unexpected query' }] });
    };

    const result = await createInvoiceDraftFromJob({ jobId: JOB_ID }, { fetchImpl, token: 'test' });
    assert.equal(result.invoice.invoiceNumber, '5811');
    assert.equal(result.invoice.invoiceStatus, 'draft');
    const create = JSON.parse(bodies.find((body) => body.includes('invoiceCreate')) || '{}') as {
      variables?: { input?: { issuedDate?: string; lineItems?: Array<Record<string, unknown>> } };
    };
    assert.equal(create.variables?.input?.issuedDate, undefined);
    assert.deepEqual(create.variables?.input?.lineItems, [
      {
        name: 'Pump pull',
        description: 'Evaluate the pumping system',
        quantity: 1,
        unitPrice: 600,
        taxable: false,
      },
    ]);
    assert.ok(bodies.every((body) => !/saveToProductsAndServices|invoiceMarkAsSent|invoiceSend/.test(body)));
  });
});
