import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateFootageFromWcrs,
  isDomesticWell,
  median,
  roundFootage,
  type WcrSample,
} from './dwr.ts';

function well(overrides: Partial<WcrSample>): WcrSample {
  return {
    wcr_number: 'WCR2020-001',
    apn: '123-456-78-00',
    total_completed_depth: 400,
    planned_use: 'Domestic',
    county: 'San Diego',
    latitude: 33.04,
    longitude: -116.86,
    distance_miles: 0.4,
    drilling_method: 'Air Rotary',
    ...overrides,
  };
}

describe('DWR domestic depth estimate', () => {
  it('treats domestic / home uses as domestic and monitoring as not', () => {
    assert.equal(isDomesticWell('Domestic'), true);
    assert.equal(isDomesticWell('Residential / Home'), true);
    assert.equal(isDomesticWell('Monitoring'), false);
  });

  it('fails closed when DWR returns nothing', () => {
    const empty = estimateFootageFromWcrs([]);
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.reason, 'no_dwr_rows');
  });

  it('fails closed when nearby WCRs have no domestic depths and returns the sample', () => {
    const sample = [
      well({ planned_use: 'Monitoring', total_completed_depth: 80 }),
      well({ planned_use: 'Domestic', total_completed_depth: null }),
    ];
    const result = estimateFootageFromWcrs(sample);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'no_domestic_depth');
      assert.equal(result.wells.length, 2);
    }
  });

  it('uses the rounded nearby domestic median and does not invent footage', () => {
    const result = estimateFootageFromWcrs([
      well({ total_completed_depth: 380 }),
      well({ total_completed_depth: 410 }),
      well({ total_completed_depth: 500 }),
      well({ planned_use: 'Monitoring', total_completed_depth: 90 }),
    ]);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.medianDepth, 410);
      assert.equal(result.footageFt, 410);
      assert.equal(roundFootage(414), 410);
      assert.equal(median([380, 410, 500]), 410);
    }
  });
});
