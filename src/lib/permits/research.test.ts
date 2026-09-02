import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countyFromCoords, detectCounty, formatApn, parseStreetAddress } from './county.ts';
import { publicAttrs, ringAreaSqFt } from './gis.ts';
import { buildPlotPlanModel, renderPlotPlanPdf, SCWS_LETTERHEAD } from './plot-plan.ts';
import { runPermitResearch } from './research.ts';
import type { ResearchResult } from './types.ts';

describe('permit county + APN helpers', () => {
  it('maps Ramona shop address to San Diego and Anza shop to Riverside', () => {
    assert.equal(
      detectCounty({ address: '1077 Main Street, Unit B, Ramona, CA 92065' }),
      'san_diego'
    );
    assert.equal(detectCounty({ address: '57174 CA-371, Anza, CA 92539' }), 'riverside');
    assert.equal(detectCounty({ lat: 33.0414, lng: -116.8698 }), 'san_diego');
    assert.equal(detectCounty({ lat: 33.5551, lng: -116.6583 }), 'riverside');
  });

  it('keeps Temecula in Riverside and Fallbrook in San Diego', () => {
    assert.equal(countyFromCoords(33.493, -117.148), 'riverside');
    assert.equal(countyFromCoords(33.376, -117.148), 'san_diego');
  });

  it('formats SD and Riverside APNs without exposing extra assessor codes', () => {
    assert.equal(formatApn('2812632300', 'san_diego'), '281-263-23-00');
    assert.equal(formatApn('575090024', 'riverside'), '575-090-024');
  });

  it('parses the Ramona shop street and drops Unit B', () => {
    const parsed = parseStreetAddress('1077 Main Street, Unit B, Ramona, CA 92065');
    assert.equal(parsed.number, 1077);
    assert.equal(parsed.name, 'MAIN');
    assert.equal(parsed.city, 'Ramona');
    assert.equal(parsed.zip, '92065');
  });
});

describe('parcel attribute sanitizing', () => {
  it('strips FLAG and GP fields so they never reach the plot plan', () => {
    const clean = publicAttrs({
      APN: '575090024',
      FLAG: 'do-not-show',
      GP: 0.42,
      GROSS_PROFIT: 1200,
      SITUS_STREET: '57174 HIGHWAY 371',
    });
    assert.equal(clean.APN, '575090024');
    assert.equal(clean.SITUS_STREET, '57174 HIGHWAY 371');
    assert.equal('FLAG' in clean, false);
    assert.equal('GP' in clean, false);
    assert.equal('GROSS_PROFIT' in clean, false);
  });

  it('computes a positive lot area from a simple ring', () => {
    const ring = [
      [-116.87, 33.041],
      [-116.869, 33.041],
      [-116.869, 33.042],
      [-116.87, 33.042],
      [-116.87, 33.041],
    ];
    assert.ok(ringAreaSqFt(ring) > 1000);
  });
});

describe('runPermitResearch', () => {
  it('geocodes an address when lat/lng are omitted and uses that point', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('geocoding.geo.census.gov')) {
        return json({
          result: {
            addressMatches: [
              {
                matchedAddress: '1077 MAIN ST, RAMONA, CA, 92065',
                coordinates: { x: -116.8698, y: 33.0414 },
                addressComponents: { city: 'RAMONA' },
              },
            ],
          },
        });
      }
      if (href.includes('GeocoderMerged') && href.includes('ADDRNMBR')) {
        return json({ features: [] });
      }
      if (href.includes('ADDRAPN')) {
        return json({ features: [{ attributes: { APN: '2812632300' } }] });
      }
      if (href.includes('GeocoderMerged') && href.includes('2812632300')) {
        return json({
          features: [
            {
              attributes: {
                APN: '2812632300',
                OWN_NAME1: 'BARRON ERIC Q&RENEE A',
                FLAG: 'secret',
                SITUS_ADDRESS: 1075,
                SITUS_STREET: 'MAIN',
                SITUS_SUFFIX: 'ST',
                SITUS_COMMUNITY: 'RAMONA',
                SITUS_ZIP: '92065',
                ACREAGE: 0.35,
                NUCLEUS_ZONE_CD: '60',
              },
              geometry: {
                rings: [[
                  [-116.8702, 33.0414],
                  [-116.8696, 33.0414],
                  [-116.8696, 33.0418],
                  [-116.8702, 33.0418],
                  [-116.8702, 33.0414],
                ]],
              },
            },
          ],
        });
      }
      if (href.includes('WellCompletionReports')) {
        return json({
          features: [
            {
              attributes: {
                WCRNumber: 'WCR2018-001234',
                TotalCompletedDepth: 420,
                StaticWaterLevel: 85,
                PlannedUseFormerUse: 'Domestic',
                DecimalLatitude: 33.0419,
                DecimalLongitude: -116.8705,
              },
            },
          ],
        });
      }
      return json({ features: [] });
    };

    const result = await runPermitResearch(
      { address: '1077 Main Street, Unit B, Ramona, CA 92065' },
      { fetchImpl: fetchImpl as typeof fetch }
    );

    assert.equal(result.county, 'san_diego');
    assert.equal(result.parcel?.apn, '281-263-23-00');
    assert.equal(result.parcel?.ownerName, 'BARRON ERIC Q&RENEE A');
    assert.equal(JSON.stringify(result).includes('secret'), false);
    assert.equal(JSON.stringify(result).includes('FLAG'), false);
    assert.equal(result.wells[0]?.wcr_number, 'WCR2018-001234');
    assert.equal(result.septic?.status, 'missing');
    assert.match(result.septic?.message || '', /not invented/i);
    assert.ok(result.searchPoint);
  });

  it('does not invent wells when DWR errors', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('geocoding.geo.census.gov')) {
        return json({
          result: {
            addressMatches: [
              {
                matchedAddress: '57174 STATE RTE 371, ANZA, CA, 92539',
                coordinates: { x: -116.6583, y: 33.5551 },
                addressComponents: { city: 'ANZA' },
              },
            ],
          },
        });
      }
      if (href.includes('mmc_mSrvc')) {
        return json({
          features: [
            {
              attributes: {
                APN: '575090024',
                FLAG: 'nope',
                FULL_SITUS_ADDRESS: '57174 HIGHWAY 371, ANZA  CA 92539',
                ACREAGE: 4,
                CLASS_CODE: 'Light Industrial',
              },
              geometry: {
                rings: [[
                  [-116.663, 33.555],
                  [-116.661, 33.555],
                  [-116.661, 33.556],
                  [-116.663, 33.556],
                  [-116.663, 33.555],
                ]],
              },
            },
          ],
        });
      }
      if (href.includes('WellCompletionReports')) {
        return json({ error: { message: 'Error performing query operation' } });
      }
      return json({ features: [] });
    };

    const result = await runPermitResearch(
      { address: '57174 CA-371, Anza, CA 92539' },
      { fetchImpl: fetchImpl as typeof fetch }
    );
    assert.equal(result.county, 'riverside');
    assert.equal(result.parcel?.apn, '575-090-024');
    assert.equal(result.wells.length, 0);
    assert.ok(result.sources.some((s) => s.name.includes('DWR') && s.status === 'error'));
    assert.ok(result.notes.some((n) => /not invented/i.test(n)));
    assert.equal(JSON.stringify(result).includes('nope'), false);
  });
});

describe('plot plan PDF', () => {
  it('builds a real plan model from parcel + wells and does not invent septic', async () => {
    const result: ResearchResult = {
      parcel: {
        apn: '281-263-23-00',
        ownerName: 'BARRON ERIC Q&RENEE A',
        siteAddress: '1075 MAIN ST, RAMONA, 92065',
        lotSizeAcres: 0.35,
        geometry: {
          rings: [[
            [-116.8702, 33.0414],
            [-116.8696, 33.0414],
            [-116.8696, 33.0418],
            [-116.8702, 33.0418],
            [-116.8702, 33.0414],
          ]],
        },
      },
      wells: [
        {
          wcr_number: 'WCR2018-001234',
          total_completed_depth: 420,
          static_water_level: 85,
          well_use: 'Domestic',
          latitude: 33.0416,
          longitude: -116.87,
          distance_from_parcel: 80,
        },
      ],
      septic: {
        status: 'missing',
        message: 'No septic/sewer record. Locations were not invented.',
      },
      septicPermits: [],
      zoning: { designation: '60' },
      sources: [{ name: 'San Diego County GIS', status: 'success', message: 'APN 281-263-23-00' }],
      county: 'san_diego',
      searchPoint: { lat: 33.0416, lng: -116.8699 },
      notes: [],
    };

    const model = buildPlotPlanModel({ result });
    assert.equal(model.hasParcel, true);
    assert.equal(model.inventedLocations, false);
    assert.equal(model.apn, '281-263-23-00');
    assert.equal(model.septicOnPlan, 0);
    assert.equal(model.wellsOnPlan, 1);
    assert.ok(model.notes.some((n) => /not invented/i.test(n) || /Tank and leach/i.test(n)));

    const bytes = await renderPlotPlanPdf({ result });
    const header = Buffer.from(bytes.slice(0, 5)).toString('latin1');
    assert.equal(header, '%PDF-');
    assert.ok(bytes.length > 2000, `expected a real PDF, got ${bytes.length} bytes`);
    const asString = Buffer.from(bytes).toString('latin1');
    assert.equal(asString.includes('FLAG'), false);
    assert.equal(asString.toLowerCase().includes('gross profit'), false);
    assert.equal(SCWS_LETTERHEAD.license.includes('1011552'), true);
  });
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
