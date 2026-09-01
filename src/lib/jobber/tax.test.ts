import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countyForProperty, pickJobberTaxRate, resolveJobberTax } from './tax.ts';

const RATES = [
  { id: 'sd-tax', name: 'San Diego County', description: 'SD unincorporated' },
  { id: 'sb-tax', name: 'San Bernardino', description: 'San Bernardino County' },
  { id: 'riv-tax', name: 'Riverside County', description: '' },
];

describe('Jobber tax by property county', () => {
  it('maps Ramona to San Diego, not San Bernardino', () => {
    assert.equal(countyForProperty('Ramona'), 'San Diego');
    assert.equal(countyForProperty('Escondido'), 'San Diego');
    assert.equal(countyForProperty('Anza'), 'Riverside');
  });

  it('prefers the San Diego tax id env used for SD addresses', () => {
    const picked = pickJobberTaxRate('San Diego', RATES, {
      JOBBER_TAX_RATE_ID_SAN_DIEGO: 'sd-tax',
    });
    assert.equal(picked?.id, 'sd-tax');
  });

  it('does not let a Ramona labor-only job inherit San Bernardino tax', () => {
    const resolved = resolveJobberTax({
      city: 'Ramona',
      rates: RATES,
      laborOnly: true,
    });
    assert.equal(resolved.county, 'San Diego');
    assert.equal(resolved.taxRateId, 'sd-tax');
    assert.equal(resolved.laborOnly, true);

    assert.throws(
      () =>
        resolveJobberTax({
          city: 'Ramona',
          rates: [{ id: 'sb-tax', name: 'San Bernardino' }],
          env: { JOBBER_TAX_RATE_ID_SAN_DIEGO: 'sb-tax' },
        }),
      /San Bernardino/
    );
  });
});
