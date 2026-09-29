import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listJobberTaxRates, taxRateMatchesQuery } from './mcp-tax-rates.ts';

describe('listJobberTaxRates', () => {
  it('matches San Diego by name or description', () => {
    assert.equal(
      taxRateMatchesQuery({ id: 'sd', name: 'San Diego Tax (7.75%)', description: null }, '7.75'),
      true
    );
    assert.equal(taxRateMatchesQuery({ id: 'sb', name: 'San Bernardino', description: null }, 'san diego'), false);
  });

  it('returns id, name, and description and surfaces GraphQL errors', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          data: {
            taxRates: {
              nodes: [
                { id: 'sd-tax', name: 'San Diego Tax (7.75%)', description: 'San Diego County' },
                { id: 'riv', name: 'Riverside', description: null },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    const rates = await listJobberTaxRates('San Diego', { fetchImpl, token: 'test' });
    assert.deepEqual(rates, [
      { id: 'sd-tax', name: 'San Diego Tax (7.75%)', description: 'San Diego County' },
    ]);

    const failing: typeof fetch = async () =>
      new Response(JSON.stringify({ errors: [{ message: 'taxRates hidden due to permissions' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    await assert.rejects(() => listJobberTaxRates(null, { fetchImpl: failing, token: 'test' }), /permissions/);
  });
});
