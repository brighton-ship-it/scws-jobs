import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPlaceholderTrackerName, mapTrackerRows } from './tracker.ts';

describe('well depth tracker mapping', () => {
  it('does not invent Oak Tree / Johnson / Chen placeholders', () => {
    assert.equal(isPlaceholderTrackerName('Oak Tree Ranch'), true);
    assert.equal(isPlaceholderTrackerName('Johnson Residence'), true);
    assert.equal(isPlaceholderTrackerName('Chen Property'), true);
    assert.equal(mapTrackerRows([]).length, 0);
    assert.equal(mapTrackerRows(null).length, 0);
  });

  it('maps real CRM well_info rows only', () => {
    const rows = mapTrackerRows([
      {
        id: 'well-1',
        well_depth: 385,
        static_water_level: 142,
        pump_hp: 3,
        pump_model: null,
        properties: {
          id: 'prop-1',
          address: '1077 Main St',
          city: 'Ramona',
          county: 'San Diego',
          customer_id: 'cust-1',
          customers: { id: 'cust-1', name: 'Ramona Shop' },
        },
      },
      { id: 'orphan' },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].customerName, 'Ramona Shop');
    assert.equal(rows[0].wellDepth, 385);
    assert.ok(!rows.some((row) => isPlaceholderTrackerName(row.customerName)));
  });
});
