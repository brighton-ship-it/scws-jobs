import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countyFromCoords, detectCounty, formatApn, parseStreetAddress } from './county.ts';
import { publicAttrs, ringAreaSqFt } from './gis.ts';
import { PDFDocument } from 'pdf-lib';
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
    assert.equal(
      detectCounty({ address: '57174 CA-371, Anza, CA 92539', county: 'san_diego' }),
      'riverside'
    );
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
      if (href.includes('addrapn_Composite')) {
        return json({
          candidates: [
            {
              score: 97.33,
              address: '1077 MAIN ST',
              location: { x: -116.870236, y: 33.041512 },
            },
          ],
        });
      }
      if (href.includes('ADDRAPN')) {
        return json({ features: [{ attributes: { APN: '2812632300' } }] });
      }
      if (href.includes('parcels_all_for_public_use')) {
        return json({
          features: [
            {
              attributes: {
                APN: '2812632300',
                APN_8: '28126323',
                FLAG: 'secret',
                SITUS_ADDRESS: 1075,
                SITUS_STREET: 'MAIN',
                SITUS_SUFFIX: 'ST',
                SITUS_ZIP: '92065',
                ACREAGE: null,
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
      if (href.includes('BUILDING_OUTLINES')) {
        return json({
          features: [
            {
              attributes: { OBJECTID: 1 },
              geometry: {
                rings: [[
                  [-116.8701, 33.0415],
                  [-116.8699, 33.0415],
                  [-116.8699, 33.0416],
                  [-116.8701, 33.0416],
                  [-116.8701, 33.0415],
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
    assert.equal(result.parcel?.ownerName, undefined);
    assert.match(result.parcel?.siteAddress || '', /1075 MAIN/);
    assert.ok(result.notes.some((n) => /owner/i.test(n) && /unknown/i.test(n)));
    assert.ok(result.notes.some((n) => /1075/i.test(n)));
    assert.equal(result.structures.length, 1);
    assert.equal(JSON.stringify(result).includes('secret'), false);
    assert.equal(JSON.stringify(result).includes('FLAG'), false);
    assert.equal(result.wells[0]?.wcr_number, 'WCR2018-001234');
    assert.equal(result.septic?.status, 'missing');
    assert.match(result.septic?.message || '', /not invented/i);
    assert.ok(result.searchPoint);
  });

  it('rejects Riverside right-of-way APN RW instead of inventing a parcel', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('geocoding.geo.census.gov') || href.includes('addrapn_Composite')) {
        return json({
          result: {
            addressMatches: [
              {
                matchedAddress: 'HIGHWAY',
                coordinates: { x: -116.66, y: 33.55 },
                addressComponents: { city: 'ANZA' },
              },
            ],
          },
          candidates: [{ score: 80, location: { x: -116.66, y: 33.55 } }],
        });
      }
      if (href.includes('mmc_mSrvc')) {
        return json({
          features: [
            {
              attributes: { APN: 'RW', MAIL_TO_NAME: 'COUNTY', HOUSE_NO: '0', STREET: 'HWY' },
              geometry: { rings: [[[-116.66, 33.55], [-116.659, 33.55], [-116.659, 33.551], [-116.66, 33.551]]] },
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
      { address: '57174 CA-371, Anza, CA 92539', lat: 33.555, lng: -116.658 },
      { fetchImpl: fetchImpl as typeof fetch }
    );
    assert.equal(result.county, 'riverside');
    assert.equal(result.parcel, null);
    assert.ok(result.notes.some((n) => /not return a parcel/i.test(n)));
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
    assert.ok(result.sources.some((s) => /DWR|CNRA/i.test(s.name)));
    assert.ok(result.notes.some((n) => /not invented/i.test(n)));
    assert.equal(JSON.stringify(result).includes('nope'), false);
    assert.equal(result.wellsWithin250Ft, 0);
  });

  it('traces the Crystallite as-built and places the proposed well in the SE orchard pocket', async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('addrapn_Composite') || href.includes('geocoding.geo.census.gov')) {
        return json({
          candidates: [
            { score: 98, address: '13736 CRYSTALLITE LN', location: { x: -117.0333, y: 33.2774 } },
          ],
          result: {
            addressMatches: [
              {
                matchedAddress: '13736 CRYSTALLITE LN, VALLEY CENTER, CA, 92082',
                coordinates: { x: -117.0333, y: 33.2774 },
                addressComponents: { city: 'VALLEY CENTER' },
              },
            ],
          },
        });
      }
      if (href.includes('ADDRAPN')) {
        return json({ features: [{ attributes: { APN: '1290927100' } }] });
      }
      if (href.includes('parcels_all_for_public_use')) {
        return json({
          features: [
            {
              attributes: {
                APN: '1290927100',
                APN_8: '12909271',
                SITUS_ADDRESS: 13736,
                SITUS_STREET: 'CRYSTALLITE',
                SITUS_SUFFIX: 'LN',
                SITUS_ZIP: '92082',
                SITUS_JURIS: 'CN',
                ACREAGE: 2.03,
              },
              geometry: {
                rings: [[
                  [-117.03262375, 33.27770525],
                  [-117.03262813, 33.27708844],
                  [-117.03396767, 33.27708376],
                  [-117.03396631, 33.27767752],
                  [-117.0326243, 33.27768204],
                  [-117.03262375, 33.27770525],
                ]],
              },
            },
          ],
        });
      }
      if (href.includes('WW_SEPTIC')) {
        return json({
          features: [
            {
              attributes: { APN: '1290927100', Sewer_Septic_Parcel_Designation: 'Known Septic Connected' },
              geometry: { x: -117.03329653, y: 33.27738305 },
            },
          ],
        });
      }
      if (href.includes('SearchDocuments')) {
        return json({
          records: [
            {
              url: 'https://file.sandiegocounty.gov/LUEG/LUEG_View?FileRecordId=36954960',
              parcel_nbr: '129-092-71-00',
              lueg_type: 'DEH-LWQD',
              lueg_subtype: 'DEH-LWQD-Land Use Archive-Parcel',
            },
          ],
        });
      }
      if (href.includes('BUILDING_OUTLINES')) {
        return json({
          features: [
            {
              attributes: { OBJECTID: 1, 'SDEP.SANGIS.BUILDING_OUTLINES.AREA': 3323 },
              geometry: {
                rings: [[
                  [-117.033844, 33.277441],
                  [-117.033542, 33.277441],
                  [-117.033542, 33.277627],
                  [-117.033844, 33.277627],
                  [-117.033844, 33.277441],
                ]],
              },
            },
          ],
        });
      }
      if (href.includes('datastore_search_sql') || href.includes('WellCompletionReports')) {
        return json({ success: true, result: { records: [] }, features: [] });
      }
      return json({ features: [] });
    };

    const result = await runPermitResearch(
      { address: '13736 Crystallite Ln, Valley Center, CA 92082' },
      { fetchImpl: fetchImpl as typeof fetch }
    );

    assert.equal(result.county, 'san_diego');
    assert.equal(result.parcel?.apn, '129-092-71-00');
    assert.ok(result.parcel?.lotSizeAcres && Math.abs(result.parcel.lotSizeAcres - 2.03) < 0.02);
    const house = result.structures.find((s) => s.onSubjectParcel && (s.areaSqFt || 0) >= 3000);
    assert.ok(house, 'expected ~3323 sf building on the parcel');
    assert.equal(result.septic?.designation, 'Known Septic Connected');
    assert.equal(result.septic?.locationUnknown, false);
    const kinds = (result.septic?.geometry || []).map((g) => g.kind).sort();
    assert.deepEqual(kinds, ['easement', 'existing_well', 'leach', 'tank']);
    assert.equal(result.dehDocuments?.[0]?.fileRecordId, '36954960');
    assert.equal(result.dehDocuments?.[0]?.geometryExtracted, true);
    assert.equal(result.notes.some((n) => /geometry (was )?not extracted/i.test(n)), false);
    assert.ok(result.notes.some((n) => /traced onto county GIS/i.test(n)));
    assert.ok(result.proposedWell);
    const pin = result.proposedWell!;
    const distToFlagPoint = Math.hypot(pin.lat - 33.27738305, pin.lng - (-117.03329653));
    assert.ok(distToFlagPoint > 1e-5, 'proposed pin must not be the WW_SEPTIC centroid');
    assert.ok(Math.abs(pin.lat - 33.27711717) < 0.00005, `SE orchard lat, got ${pin.lat}`);
    assert.ok(Math.abs(pin.lng - -117.03266212) < 0.00005, `SE orchard lng, got ${pin.lng}`);
    assert.equal(pin.meetsSetbacks, true);
    assert.ok((pin.distances.leachFt || 0) >= 100);
    assert.ok((pin.distances.tankFt || 0) >= 50);
    assert.ok((pin.distances.existingWellFt || 0) >= 100);
    assert.equal(result.wellsWithin250Ft, 0);
    assert.ok(result.sources.some((s) => /0 \(NONE\)/i.test(s.message || '')));
    assert.equal(JSON.stringify(result).includes('1059498'), false);
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
      structures: [],
    };

    const model = buildPlotPlanModel({ result });
    assert.equal(model.hasParcel, true);
    assert.equal(model.inventedLocations, false);
    assert.equal(model.apn, '281-263-23-00');
    assert.equal(model.septicOnPlan, 0);
    assert.equal(model.wellsOnPlan, 1);
    assert.ok(model.notes.some((n) => /not invented/i.test(n) || /Tank and leach/i.test(n)));

    const bytes = await renderPlotPlanPdf({ result, aerialJpeg: null });
    const header = Buffer.from(bytes.slice(0, 5)).toString('latin1');
    assert.equal(header, '%PDF-');
    assert.ok(bytes.length > 2000, `expected a real PDF, got ${bytes.length} bytes`);
    const loaded = await PDFDocument.load(bytes);
    const first = loaded.getPages()[0];
    assert.equal(Math.round(first.getWidth()), 1224);
    assert.equal(Math.round(first.getHeight()), 792);
    const asString = Buffer.from(bytes).toString('latin1');
    assert.equal(asString.toLowerCase().includes('gross profit'), false);
    assert.equal(SCWS_LETTERHEAD.license.includes('1086994'), true);
    assert.equal(SCWS_LETTERHEAD.license.includes('1059498'), false);
    assert.equal(SCWS_LETTERHEAD.license.includes('1129498'), false);
    assert.equal(SCWS_LETTERHEAD.license.includes('1013597'), false);
    assert.equal(SCWS_LETTERHEAD.license.includes('1011552'), false);
    assert.ok(model.notes.some((n) => /10 ft/.test(n) && /property-line setback/i.test(n)));
    assert.match(model.scaleLabel, /graphic/i);
    assert.equal(model.disclaimer.includes('NOT a stamped survey'), true);
  });
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
