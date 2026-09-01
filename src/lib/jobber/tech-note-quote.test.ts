import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTechNoteQuote } from './tech-note-quote.ts';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jobberFetch(job: Record<string, unknown>) {
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = String(init?.body || '');
    bodies.push(body);
    const parsed = JSON.parse(body || '{}') as { query?: string };
    const q = parsed.query || '';
    if (q.includes('JobsSearch') || q.includes('JobById')) {
      return jsonResponse({ data: { jobs: { nodes: [job] }, job } });
    }
    if (q.includes('JobberTaxRates')) {
      return jsonResponse({
        data: { taxRates: { nodes: [{ id: 'sd-tax', name: 'San Diego County' }] } },
      });
    }
    if (q.includes('JobberUsers')) {
      return jsonResponse({
        data: {
          users: { nodes: [{ id: 'user-brighton', name: 'Brighton Scala', email: 'brighton@scwellservice.com' }] },
        },
      });
    }
    if (q.includes('mutation') && q.includes('QuoteCreate') && !q.includes('LineItems')) {
      return jsonResponse({
        data: {
          quoteCreate: {
            quote: {
              id: 'quote-new',
              quoteNumber: 4302,
              title: 'Pull well pump and evaluate',
              sentAt: null,
              quoteStatus: 'draft',
            },
            userErrors: [],
          },
        },
      });
    }
    if (q.includes('QuoteCreateLineItems')) {
      return jsonResponse({
        data: { quoteCreateLineItems: { createdLineItems: [{ id: 'li-1' }], userErrors: [] } },
      });
    }
    return jsonResponse({ data: {} });
  };
  return { fetchImpl, bodies };
}

const ramonaJob = {
  id: 'job-1',
  jobNumber: 8801,
  client: { id: 'client-1', name: 'Pat Example' },
  property: { id: 'prop-1', address: { street1: '100 Oak Rd', city: 'Ramona' } },
  quotes: { nodes: [] },
};

describe('createTechNoteQuote', () => {
  it('creates one unsent BT2 pull-and-eval for a Ramona job with Brighton + SD tax', async () => {
    const { fetchImpl, bodies } = jobberFetch(ramonaJob);
    const result = await createTechNoteQuote(
      { jobNumber: 8801, techNotes: 'pump noisy, pull and eval' },
      { fetchImpl, token: 'test', env: { JOBBER_TAX_RATE_ID_SAN_DIEGO: 'sd-tax' } }
    );

    assert.equal(result.success, true);
    assert.equal(result.draft, true);
    assert.equal(result.sentAt, null);
    assert.equal(result.reused, false);
    assert.equal(result.shop, 'ramona');
    assert.equal(result.tax.county, 'San Diego');
    assert.equal(result.tax.taxRateId, 'sd-tax');
    assert.equal(result.lineItems[0]?.name, 'BT2');
    assert.equal(result.lineItems[0]?.unitPrice, 600);
    assert.equal(result.lineItems[0]?.taxable, false);
    assert.equal(result.customerMessage.includes('200'), false);
    assert.equal(result.customerMessage.toLowerCase().includes('service call'), false);
    assert.ok(bodies.every((body) => !body.includes('transitionQuoteTo')));
  });

  it('reuses a live quote instead of creating a second one', async () => {
    const { fetchImpl } = jobberFetch({
      ...ramonaJob,
      quotes: {
        nodes: [
          {
            id: 'quote-existing',
            title: 'Pull well pump and evaluate (job 8801)',
            quoteStatus: 'draft',
            sentAt: null,
          },
        ],
      },
    });
    const result = await createTechNoteQuote({ jobNumber: 8801 }, { fetchImpl, token: 'test' });
    assert.equal(result.reused, true);
    assert.equal(result.quote.id, 'quote-existing');
  });

  it('uses Franklin on a Ramona replace quote and CentriPro on Anza', async () => {
    const ramona = jobberFetch(ramonaJob);
    const ramonaResult = await createTechNoteQuote(
      { jobNumber: 8801, kind: 'replace' },
      { fetchImpl: ramona.fetchImpl, token: 'test' }
    );
    assert.equal(ramonaResult.motorBrand, 'Franklin');
    assert.ok(ramonaResult.lineItems.some((line) => line.name.includes('Franklin')));

    const anza = jobberFetch({
      ...ramonaJob,
      property: { id: 'prop-2', address: { city: 'Anza' } },
    });
    const anzaResult = await createTechNoteQuote(
      { jobNumber: 8801, kind: 'replace' },
      { fetchImpl: anza.fetchImpl, token: 'test' }
    );
    assert.equal(anzaResult.shop, 'anza');
    assert.equal(anzaResult.motorBrand, 'CentriPro');
  });
});
