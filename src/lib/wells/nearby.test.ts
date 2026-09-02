import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { costFromStats, lookupNearbyWells, summarizeWells } from './nearby.ts';
import { mentionsGpFlag } from './cost.ts';
import type { NearbyWell } from './cnra.ts';

function well(overrides: Partial<NearbyWell> = {}): NearbyWell {
  return {
    wcr_number: 'WCR1961-002022',
    total_drill_depth: 400,
    well_yield: 12,
    well_yield_unit: 'GPM',
    static_water_level: 80,
    date_work_ended: '1961-06-15',
    drilling_method: 'Air Rotary',
    planned_use: 'Water Supply Domestic',
    county: 'San Diego',
    city: 'Ramona',
    latitude: 33.04,
    longitude: -116.87,
    distance_miles: 0.3,
    distance_feet: 1584,
    ...overrides,
  };
}

describe('nearby well lookup', () => {
  it('summarizes depths/yield and prices air rotary at $45–48/ft', () => {
    const stats = summarizeWells(
      [well({ total_drill_depth: 380 }), well({ total_drill_depth: 420, well_yield: 8 })],
      2,
      2
    );
    assert.equal(stats.avgDepth, 400);
    assert.equal(stats.minDepth, 380);
    assert.equal(stats.maxDepth, 420);
    assert.equal(stats.domesticMedianDepth, 400);
    const cost = costFromStats(stats);
    assert.equal(cost?.perFootLow, 45);
    assert.equal(cost?.perFootHigh, 48);
    assert.equal(mentionsGpFlag(cost?.label), false);
  });

  it('geocodes address server-side then returns CNRA wells', async () => {
    const result = await lookupNearbyWells({ address: '1077 Main Street, Ramona, CA 92065', radiusMiles: 2 }, async (url) => {
      if (String(url).includes('nominatim')) {
        return new Response(
          JSON.stringify([
            {
              lat: '33.04163',
              lon: '-116.870105',
              display_name: '1077, Main Street, Ramona, San Diego County, California, 92065',
            },
          ]),
          { status: 200 }
        );
      }
      assert.match(String(url), /data\.cnra\.ca\.gov/);
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            records: [
              {
                WCRNUMBER: 'WCR1961-002022',
                CITY: 'Ramona',
                COUNTYNAME: 'San Diego',
                TOTALCOMPLETEDDEPTH: 400,
                WELLYIELD: 12,
                STATICWATERLEVEL: 80,
                DECIMALLATITUDE: 33.041,
                DECIMALLONGITUDE: -116.87,
                PLANNEDUSEFORMERUSE: 'Water Supply Domestic',
                DRILLINGMETHOD: 'Air Rotary',
              },
            ],
          },
        }),
        { status: 200 }
      );
    });
    assert.equal(result.location.city, 'Ramona');
    assert.equal(result.wells.length, 1);
    assert.equal(result.wells[0].wcr_number, 'WCR1961-002022');
    assert.equal(result.wells[0].total_drill_depth, 400);
    assert.equal(result.cost?.perFootLow, 45);
    assert.doesNotMatch(result.source, /invent/i);
  });

  it('lists wells with depth before empty nearest records', async () => {
    const result = await lookupNearbyWells({ lat: 33.04163, lng: -116.870105, radiusMiles: 2 }, async (url) => {
      if (String(url).includes('nominatim') || String(url).includes('census')) {
        return new Response('[]', { status: 200 });
      }
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            records: [
              {
                WCRNUMBER: 'WCR-EMPTY',
                DECIMALLATITUDE: 33.0417,
                DECIMALLONGITUDE: -116.8702,
              },
              {
                WCRNUMBER: 'WCR-DEPTH',
                TOTALCOMPLETEDDEPTH: 380,
                WELLYIELD: 10,
                STATICWATERLEVEL: 90,
                DECIMALLATITUDE: 33.04,
                DECIMALLONGITUDE: -116.868,
                PLANNEDUSEFORMERUSE: 'Water Supply Domestic',
              },
            ],
          },
        }),
        { status: 200 }
      );
    });
    assert.equal(result.wells[0].wcr_number, 'WCR-DEPTH');
    assert.equal(result.wells[1].wcr_number, 'WCR-EMPTY');
  });
});
