import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CRYSTALLITE_SE_ORCHARD, largestOnParcelDwelling, traceLarc009777 } from './as-built.ts';
import { centroidFromRings, haversineFeet } from './gis.ts';
import { evaluatePin, flagNeighborSetbacks, placeProposedWell, septicGeometryFromKnown } from './place-well.ts';

/** Parcel roughly 300 ft E-W by 200 ft N-S. House on the west; leach band through the centroid. */
function crystalliteLikeRings() {
  const lng0 = -117.0335;
  const lat0 = 33.2772;
  const dLng = 300 / (364000 * Math.cos((lat0 * Math.PI) / 180));
  const dLat = 200 / 364000;
  return [
    [
      [lng0, lat0],
      [lng0 + dLng, lat0],
      [lng0 + dLng, lat0 + dLat],
      [lng0, lat0 + dLat],
      [lng0, lat0],
    ],
  ];
}

/** Live-ish Crystallite GIS rings used by the v4 gold-standard sheet. */
export function crystalliteGisRings() {
  const parcelRing = [
    [-117.03262375, 33.27770525],
    [-117.03262813, 33.27708844],
    [-117.03396767, 33.27708376],
    [-117.03396631, 33.27767752],
    [-117.0326243, 33.27768204],
    [-117.03262375, 33.27770525],
  ];
  const dwellingRing = [
    [-117.033844, 33.277441],
    [-117.033542, 33.277441],
    [-117.033542, 33.277627],
    [-117.033844, 33.277627],
    [-117.033844, 33.277441],
  ];
  return { parcelRing, dwellingRing };
}

describe('proposed well placement', () => {
  it('does not silently use the centroid when it sits on a leach field', () => {
    const rings = crystalliteLikeRings();
    const centroid = centroidFromRings(rings);
    assert.ok(centroid);

    const leach = {
      rings: [
        [
          [centroid!.lng - 0.00004, centroid!.lat - 0.00004],
          [centroid!.lng + 0.00004, centroid!.lat - 0.00004],
          [centroid!.lng + 0.00004, centroid!.lat + 0.00004],
          [centroid!.lng - 0.00004, centroid!.lat + 0.00004],
          [centroid!.lng - 0.00004, centroid!.lat - 0.00004],
        ],
      ],
    };

    const atCentroid = evaluatePin(centroid!.lat, centroid!.lng, {
      rings,
      county: 'san_diego',
      leaches: [leach],
    });
    assert.equal(atCentroid.ok, false);
    assert.ok(atCentroid.distances.leachFt != null && atCentroid.distances.leachFt < 100);

    const pin = placeProposedWell({
      rings,
      county: 'san_diego',
      leaches: [leach],
    });
    assert.ok(pin);
    assert.notEqual(pin!.lat.toFixed(7), centroid!.lat.toFixed(7));
    assert.notEqual(pin!.lng.toFixed(7), centroid!.lng.toFixed(7));
    assert.equal(pin!.meetsSetbacks, true);
    assert.ok((pin!.distances.leachFt || 0) >= 100);
    assert.ok((pin!.distances.propertyLineFt || 0) >= 10);
    assert.equal(pin!.source, 'setback_search');
  });

  it('flags the best pocket when no pin meets 100 ft leach — and does not fall back to the centroid', () => {
    const rings = crystalliteLikeRings();
    const centroid = centroidFromRings(rings);
    const box = rings[0];
    const leach = { rings: [box] };
    const pin = placeProposedWell({
      rings,
      county: 'san_diego',
      leaches: [leach],
    });
    assert.ok(pin);
    assert.equal(pin!.meetsSetbacks, false);
    assert.ok(pin!.flags.some((f) => /FLAG/i.test(f)));
    assert.equal(pin!.source, 'best_pocket');
    assert.notEqual(pin!.lat.toFixed(6), centroid!.lat.toFixed(6));
    assert.notEqual(pin!.lng.toFixed(6), centroid!.lng.toFixed(6));
  });

  it('places the Crystallite as-built overlay in the SE orchard pocket, not the centroid or NW strip', () => {
    const { parcelRing, dwellingRing } = crystalliteGisRings();
    const overlay = traceLarc009777({ parcelRing, dwellingRing });
    assert.ok(overlay);
    const known = septicGeometryFromKnown(overlay!.geometry);
    const pin = placeProposedWell({
      rings: [parcelRing],
      county: 'san_diego',
      tanks: known.tanks,
      leaches: known.leaches,
      existingWells: known.existingWells,
      easements: known.easements,
      structures: [{ rings: [dwellingRing], areaSqFt: 3323, onSubjectParcel: true }],
    });
    assert.ok(pin);
    const feet = haversineFeet(pin!.lat, pin!.lng, CRYSTALLITE_SE_ORCHARD.lat, CRYSTALLITE_SE_ORCHARD.lng);
    assert.ok(feet < 12, `expected SE orchard pocket, got ${pin!.lat}, ${pin!.lng} (${feet.toFixed(1)} ft from v4)`);
    assert.equal(pin!.meetsSetbacks, true);
    assert.ok((pin!.distances.tankFt || 0) >= 50);
    assert.ok((pin!.distances.leachFt || 0) >= 100);
    assert.ok((pin!.distances.existingWellFt || 0) >= 100);
    assert.ok((pin!.distances.propertyLineFt || 0) >= 10);

    const centroid = centroidFromRings([parcelRing]);
    const centroidFt = haversineFeet(pin!.lat, pin!.lng, centroid!.lat, centroid!.lng);
    assert.ok(centroidFt > 80, 'retired centroid is not the proposed well');

    const nw = evaluatePin(33.27768, -117.0337, {
      rings: [parcelRing],
      county: 'san_diego',
      tanks: known.tanks,
      leaches: known.leaches,
      existingWells: known.existingWells,
      easements: known.easements,
      structures: [{ rings: [dwellingRing], areaSqFt: 3323, onSubjectParcel: true }],
    });
    assert.equal(nw.ok, false, 'NW/north-of-house is not the 100 ft leach pocket');
  });

  it('does not treat a random APN dwelling as a Crystallite as-built', () => {
    assert.equal(largestOnParcelDwelling([]), null);
  });

  it('FLAGs a neighbor leach under 100 ft without moving the SE pin', () => {
    const pin = placeProposedWell({
      rings: crystalliteLikeRings(),
      county: 'san_diego',
    });
    assert.ok(pin);
    const before = { lat: pin!.lat, lng: pin!.lng };
    const fl = 364000 * Math.cos((pin!.lat * Math.PI) / 180);
    const lng = pin!.lng + 50 / fl;
    const flagged = flagNeighborSetbacks(pin!, [
      {
        apn: '133-241-01-00',
        system: 'SEPTIC',
        dehDocuments: [],
        tankLeach: 'as_built_extracted',
        geometry: [
          {
            kind: 'leach',
            rings: [[
              [lng, pin!.lat - 0.00002],
              [lng + 0.00004, pin!.lat - 0.00002],
              [lng + 0.00004, pin!.lat + 0.00002],
              [lng, pin!.lat + 0.00002],
              [lng, pin!.lat - 0.00002],
            ]],
            source: 'test',
          },
        ],
      },
    ]);
    assert.equal(flagged.lat, before.lat);
    assert.equal(flagged.lng, before.lng);
    assert.equal(flagged.meetsSetbacks, false);
    assert.ok(flagged.flags.some((f) => /133-241-01-00/i.test(f) && /FLAG/i.test(f)));
  });
});
