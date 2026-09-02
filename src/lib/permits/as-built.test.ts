import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CRYSTALLITE_SE_ORCHARD,
  hasLarc009777,
  LARC_009777_APN,
  LARC_009777_FILE_RECORD_ID,
  markDocsExtracted,
  overlayCrystalliteNeighbor,
  traceLarc009777,
  traceNeighborAsBuilt,
} from './as-built.ts';
import { haversineFeet } from './gis.ts';
import { crystalliteGisRings } from './place-well.test.ts';
import type { DehDocument } from './types.ts';

describe('LARC_009777_1 overlay', () => {
  it('applies only to the Crystallite APN', () => {
    assert.equal(hasLarc009777(LARC_009777_APN), true);
    assert.equal(hasLarc009777('129-092-70-00'), false);
    assert.equal(hasLarc009777('281-263-23-00'), false);
  });

  it('traces tank, leach, W61895, and the 40 ft west easement from the as-built — not a guess', () => {
    const { parcelRing, dwellingRing } = crystalliteGisRings();
    const overlay = traceLarc009777({ parcelRing, dwellingRing });
    assert.ok(overlay);
    const kinds = overlay!.geometry.map((g) => g.kind).sort();
    assert.deepEqual(kinds, ['easement', 'existing_well', 'leach', 'tank']);
    assert.ok(overlay!.geometry.every((g) => /36954960|LARC_009777/.test(g.source)));

    const tank = overlay!.geometry.find((g) => g.kind === 'tank')!;
    const well = overlay!.geometry.find((g) => g.kind === 'existing_well')!;
    const tankFt = haversineFeet(CRYSTALLITE_SE_ORCHARD.lat, CRYSTALLITE_SE_ORCHARD.lng, tank.lat!, tank.lng!);
    const wellFt = haversineFeet(CRYSTALLITE_SE_ORCHARD.lat, CRYSTALLITE_SE_ORCHARD.lng, well.lat!, well.lng!);
    assert.ok(Math.abs(tankFt - 299) < 15, `tank ${tankFt.toFixed(1)} ft from SE pin (gold 299)`);
    assert.ok(Math.abs(wellFt - 195) < 15, `well ${wellFt.toFixed(1)} ft from SE pin (gold 195)`);
  });

  it('marks FileRecordId 36954960 as extracted', () => {
    const docs: DehDocument[] = [
      {
        fileRecordId: LARC_009777_FILE_RECORD_ID,
        viewUrl: `https://file.sandiegocounty.gov/LUEG/LUEG_View?FileRecordId=${LARC_009777_FILE_RECORD_ID}`,
        geometryExtracted: false,
        note: 'As-built on file, geometry not extracted.',
        isAsBuiltCandidate: true,
      },
    ];
    const marked = markDocsExtracted(docs);
    assert.equal(marked[0].geometryExtracted, true);
    assert.match(marked[0].note, /traced/i);
  });

  it('fits a neighbor as-built onto the GIS house so gold distances hold, and skips lots with no building', () => {
    const pin = CRYSTALLITE_SE_ORCHARD;
    const eastHouse = [
      [-117.03158, 33.27735],
      [-117.03142, 33.27735],
      [-117.03142, 33.27745],
      [-117.03158, 33.27745],
      [-117.03158, 33.27735],
    ];
    const traced = traceNeighborAsBuilt({
      spec: {
        apn: '133-241-01-00',
        fileRecordId: '36983694',
        label: 'E 31093 Willow View',
        tankFt: 276,
        leachFt: 64,
      },
      dwellingRing: eastHouse,
      pin,
    });
    assert.ok(traced);
    const tank = traced!.geometry.find((g) => g.kind === 'tank')!;
    const tankFt = haversineFeet(pin.lat, pin.lng, tank.lat!, tank.lng!);
    assert.ok(Math.abs(tankFt - 276) < 3, `east tank ${tankFt.toFixed(1)} (gold 276)`);

    const skipped = overlayCrystalliteNeighbor({
      apn: '129-092-58-00',
      docs: [
        {
          fileRecordId: '37010494',
          viewUrl: 'https://file.sandiegocounty.gov/LUEG/LUEG_View?FileRecordId=37010494',
          geometryExtracted: false,
          note: 'on file',
          isAsBuiltCandidate: true,
        },
      ],
      structures: [],
      parcelRing: eastHouse,
    });
    assert.equal(skipped, null);
  });
});
