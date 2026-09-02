import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCnraSql,
  CNRA_WCR_RESOURCE_ID,
  filterByRadius,
  mapCnraRecord,
  parseWellNumber,
  queryCnraWells,
} from './cnra.ts';

const RAMONA = { lat: 33.04163, lng: -116.870105 };

describe('CNRA WCR mapping', () => {
  it('builds a bounded SQL query against the official WCR resource', () => {
    const sql = buildCnraSql(RAMONA.lat, RAMONA.lng, 2);
    assert.match(sql, new RegExp(CNRA_WCR_RESOURCE_ID));
    assert.match(sql, /DECIMALLATITUDE/);
    assert.doesNotMatch(sql, /;/);
  });

  it('maps a Ramona WCR and drops points outside the radius', () => {
    const well = mapCnraRecord(
      {
        WCRNUMBER: 'WCR1961-002022',
        CITY: 'Ramona',
        COUNTYNAME: 'San Diego',
        TOTALCOMPLETEDDEPTH: 120,
        WELLYIELD: '9.0',
        STATICWATERLEVEL: '40',
        DRILLINGMETHOD: 'Air Rotary',
        PLANNEDUSEFORMERUSE: 'Water Supply Domestic',
        DECIMALLATITUDE: 33.04,
        DECIMALLONGITUDE: -116.87,
        DATEWORKENDED: '06/15/1961',
      },
      RAMONA
    );
    assert.ok(well);
    assert.equal(well?.wcr_number, 'WCR1961-002022');
    assert.equal(well?.total_drill_depth, 120);
    assert.equal(well?.well_yield, 9);
    assert.equal(well?.city, 'Ramona');
    assert.ok((well?.distance_miles ?? 99) < 0.2);

    const far = mapCnraRecord(
      {
        WCRNUMBER: 'WCR-FAR',
        TOTALCOMPLETEDDEPTH: 400,
        DECIMALLATITUDE: 34.05,
        DECIMALLONGITUDE: -118.25,
      },
      RAMONA
    );
    assert.ok(far);
    assert.equal(filterByRadius([well!, far!], 2).length, 1);
  });

  it('parses depths and ignores empty yield', () => {
    assert.equal(parseWellNumber('951'), 951);
    assert.equal(parseWellNumber(''), null);
  });

  it('queries CNRA SQL and returns mapped wells', async () => {
    const wells = await queryCnraWells(RAMONA.lat, RAMONA.lng, 2, async (url) => {
      assert.match(String(url), /datastore_search_sql/);
      assert.match(String(url), /WCRNUMBER/);
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            records: [
              {
                WCRNUMBER: 'WCR1961-002022',
                CITY: 'Ramona',
                COUNTYNAME: 'San Diego',
                TOTALCOMPLETEDDEPTH: 120,
                WELLYIELD: 9,
                STATICWATERLEVEL: 40,
                DECIMALLATITUDE: 33.041,
                DECIMALLONGITUDE: -116.87,
                PLANNEDUSEFORMERUSE: 'Water Supply Domestic',
              },
            ],
          },
        }),
        { status: 200 }
      );
    });
    assert.equal(wells.length, 1);
    assert.equal(wells[0].total_drill_depth, 120);
  });
});
