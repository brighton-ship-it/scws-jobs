import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bookJobValueUsd, invoicePretaxUsd, sumIssuedInvoicePretax } from './invoice-value.ts';
import { bookJobDeliveryPlan, measurementPayloadForGoogle } from './book-job.ts';

describe('invoice value', () => {
  it('uses pre-tax subtotal and skips drafts', () => {
    assert.equal(
      invoicePretaxUsd({ invoiceStatus: 'paid', amounts: { subtotal: 4196, taxAmount: 300, total: 4496 } }),
      4196
    );
    assert.equal(
      invoicePretaxUsd({ invoiceStatus: 'draft', amounts: { subtotal: 100 } }),
      null
    );
    assert.equal(
      sumIssuedInvoicePretax([
        { invoiceStatus: 'paid', amounts: { subtotal: 200 } },
        { invoiceStatus: 'void', amounts: { subtotal: 50 } },
        { invoiceStatus: 'awaiting_payment', amounts: { total: 110, taxAmount: 10 } },
      ]),
      300
    );
  });

  it('prefers invoice pre-tax over the job total', () => {
    assert.deepEqual(
      bookJobValueUsd({
        invoices: [{ invoiceStatus: 'paid', amounts: { subtotal: 1250 } }],
        jobTotal: 1,
      }),
      { valueUsd: 1250, valueSource: 'invoice_pretax' }
    );
    assert.deepEqual(bookJobValueUsd({ jobTotal: 200 }), {
      valueUsd: 200,
      valueSource: 'job_total',
    });
  });
});

describe('book_job delivery', () => {
  it('sends a real GA client id with invoice value and does not send last_resort', () => {
    const sent = measurementPayloadForGoogle({
      jobberJobId: 'job-1',
      lead: {
        email: 'pat@example.com',
        phone: '7605550100',
        gclid: 'abc',
        ga_client_id: '123.456',
        ga_session_id: '789',
      },
      valueUsd: 1250,
    });
    assert.equal(sent?.client_id, '123.456');
    assert.equal(sent?.events[0].params.value, 1250);
    assert.equal(sent?.events[0].params.gclid, 'abc');
    assert.equal(sent?.events[0].params.client_id_source, 'ga_client_id');

    assert.equal(
      measurementPayloadForGoogle({
        jobberJobId: 'job-2',
        lead: { gclid: 'abc', ga_client_id: null, email: null, phone: null },
      }),
      null
    );
    assert.deepEqual(
      bookJobDeliveryPlan({
        id: 'x',
        source: 'customers',
        phone: null,
        email: null,
        created_at: '2026-10-01T00:00:00Z',
        gclid: 'abc',
        ga_client_id: null,
      }),
      { send: false, reason: 'click_id_only_offline' }
    );
    assert.deepEqual(bookJobDeliveryPlan(null), { send: false, reason: 'no_match' });
  });
});
