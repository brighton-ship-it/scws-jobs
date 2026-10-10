import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTRIBUTION_INVOICES_QUERY,
  ATTRIBUTION_JOB_INVOICES_QUERY,
  ATTRIBUTION_QUOTES_QUERY,
  assertAttributionQueryIsReadOnly,
  fetchJobInvoiceAmounts,
  mapInvoiceNode,
} from './attribution-reads.ts';

describe('Jobber attribution reads', () => {
  it('uses read queries only', () => {
    for (const query of [ATTRIBUTION_INVOICES_QUERY, ATTRIBUTION_QUOTES_QUERY, ATTRIBUTION_JOB_INVOICES_QUERY]) {
      assertAttributionQueryIsReadOnly(query);
      assert.equal(/\bmutation\b/i.test(query), false);
    }
  });

  it('maps an invoice onto its job and pre-tax amounts', () => {
    const mapped = mapInvoiceNode({
      id: 'inv-1',
      invoiceStatus: 'paid',
      issuedDate: '2026-10-08',
      amounts: { subtotal: 200, taxAmount: 16, total: 216 },
      client: { phones: [{ number: '7605550100' }], emails: [{ address: 'pat@example.com' }] },
      jobs: { nodes: [{ id: 'job-1' }] },
    });
    assert.equal(mapped?.jobIds?.[0], 'job-1');
    assert.equal(mapped?.phone, '7605550100');
    assert.equal(mapped?.amounts?.subtotal, 200);
  });

  it('loads job invoices through the shared GraphQL client', async () => {
    const invoices = await fetchJobInvoiceAmounts('job-1', {
      token: 'test-token',
      fetchImpl: async (url, init) => {
        assert.match(String(url), /graphql/);
        const body = JSON.parse(String(init?.body));
        assert.match(body.query, /query AttributionJobInvoices/);
        assert.equal(/\bmutation\b/i.test(body.query), false);
        assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-token');
        return new Response(
          JSON.stringify({
            data: {
              job: {
                id: 'job-1',
                invoices: { nodes: [{ invoiceStatus: 'paid', amounts: { subtotal: 1250 } }] },
              },
            },
          }),
          { status: 200 }
        );
      },
    });
    assert.equal(invoices[0]?.amounts?.subtotal, 1250);
  });
});
