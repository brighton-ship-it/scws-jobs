import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { centroidFromRings } from './gis.ts';
import { evaluatePin, placeProposedWell } from './place-well.ts';

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

  it('flags the best pocket when no pin meets every setback', () => {
    const rings = crystalliteLikeRings();
    const box = rings[0];
    const leach = { rings: [box] };
    const pin = placeProposedWell({
      rings,
      county: 'san_diego',
      leaches: [leach],
    });
    assert.ok(pin);
    assert.equal(pin!.meetsSetbacks, false);
    assert.ok(pin!.flags.some((f) => /FLAGGED|leach|best pocket/i.test(f)));
    assert.equal(pin!.source, 'best_pocket');
  });
});
