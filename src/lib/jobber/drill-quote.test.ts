import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDrillQuote } from './drill-quote.ts';
import { DWR_WELLS_ENDPOINT } from './dwr.ts';
import { SANITARY_SEAL_QTY, SANITARY_SEAL_UNIT_PRICE, TRAVEL_LINE_NAME } from './shop-book.ts';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function dwrFeatures(rows: Array<Record<string, unknown>>) {
  return {
    features: rows.map((attributes) => ({ attributes })),
  };
}

describe('createDrillQuote', () => {
  it('fails closed and returns the WCR sample when DWR has no domestic depths', async () => {
    const fetchImpl: typeof fetch = async (url) => {
      const href = String(url);
      if (href.startsWith(DWR_WELLS_ENDPOINT)) {
        return jsonResponse(
          dwrFeatures([
            {
              WCRNumber: 'WCR-empty',
              PlannedUseFormerUse: 'Monitoring',
              TotalCompletedDepth: 50,
              DecimalLatitude: 33.04,
              DecimalLongitude: -116.86,
            },
          ])
        );
      }
      return jsonResponse({ data: {} });
    };

    const result = await createDrillQuote(
      { lat: 33.0414, lng: -116.8686, city: 'Ramona', address: '1077 Main St, Ramona CA' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error, 'no_domestic_depth');
      assert.equal(result.wcrSample.length, 1);
      assert.equal(result.wcrSample[0]?.wcr_number, 'WCR-empty');
    }
  });

  it('builds an unsent air-rotary draft with seal qty 20 and no travel from Ramona', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const href = String(url);
      if (href.startsWith(DWR_WELLS_ENDPOINT)) {
        return jsonResponse(
          dwrFeatures([
            {
              WCRNumber: 'WCR-1',
              PlannedUseFormerUse: 'Domestic',
              TotalCompletedDepth: 400,
              DecimalLatitude: 33.042,
              DecimalLongitude: -116.87,
            },
            {
              WCRNumber: 'WCR-2',
              PlannedUseFormerUse: 'Domestic',
              TotalCompletedDepth: 440,
              DecimalLatitude: 33.043,
              DecimalLongitude: -116.869,
            },
          ])
        );
      }
      const body = String(init?.body || '');
      bodies.push(body);
      const q = (JSON.parse(body || '{}') as { query?: string }).query || '';
      if (q.includes('ClientSearch')) {
        return jsonResponse({
          data: {
            clients: {
              nodes: [
                {
                  id: 'client-1',
                  name: 'Pat Example',
                  properties: {
                    nodes: [{ id: 'prop-1', address: { street1: '1077 Main St', city: 'Ramona' } }],
                  },
                  quotes: { nodes: [] },
                },
              ],
            },
          },
        });
      }
      if (q.includes('JobberTaxRates')) {
        return jsonResponse({
          data: { taxRates: { nodes: [{ id: 'sd-tax', name: 'San Diego County' }] } },
        });
      }
      if (q.includes('JobberUsers')) {
        return jsonResponse({
          data: { users: { nodes: [{ id: 'user-brighton', name: 'Brighton Scala' }] } },
        });
      }
      if (q.includes('mutation') && q.includes('QuoteCreate') && !q.includes('LineItems')) {
        return jsonResponse({
          data: {
            quoteCreate: {
              quote: { id: 'quote-drill', quoteNumber: 4303, sentAt: null, quoteStatus: 'draft' },
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

    const result = await createDrillQuote(
      {
        lat: 33.0414,
        lng: -116.8686,
        city: 'Ramona',
        address: '1077 Main St, Ramona CA',
        clientName: 'Pat Example',
      },
      { fetchImpl, token: 'test' }
    );

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.draft, true);
      assert.equal(result.sentAt, null);
      assert.equal(result.method, 'air');
      assert.equal(result.shop, 'ramona');
      assert.equal(result.footageFt, 420);
      assert.equal(result.travelDays, 0);
      const seal = result.lineItems.find((line) => line.name.includes('Sanitary Seal'));
      assert.equal(seal?.quantity, SANITARY_SEAL_QTY);
      assert.equal(seal?.unitPrice, SANITARY_SEAL_UNIT_PRICE);
      assert.ok(!result.lineItems.some((line) => line.name === TRAVEL_LINE_NAME));
      assert.ok(result.lineItems.some((line) => line.name === 'Water Delivery'));
      assert.ok(result.lineItems.some((line) => line.name === 'Mobilization' && line.unitPrice === 2500));
    }
    assert.ok(bodies.every((body) => !body.includes('transitionQuoteTo')));
  });

  it('refuses to create a client when none exists', async () => {
    const fetchImpl: typeof fetch = async (url) => {
      const href = String(url);
      if (href.startsWith(DWR_WELLS_ENDPOINT)) {
        return jsonResponse(
          dwrFeatures([
            {
              WCRNumber: 'WCR-1',
              PlannedUseFormerUse: 'Domestic',
              TotalCompletedDepth: 400,
              DecimalLatitude: 33.042,
              DecimalLongitude: -116.87,
            },
          ])
        );
      }
      return jsonResponse({ data: { clients: { nodes: [] } } });
    };

    await assert.rejects(
      () =>
        createDrillQuote(
          { lat: 33.0414, lng: -116.8686, city: 'Ramona', address: '1 Unknown Rd' },
          { fetchImpl, token: 'test' }
        ),
      /refusing to create a duplicate client/
    );
  });
});
