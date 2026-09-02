import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CRYSTALLITE_SE_ORCHARD,
  hasLarc009777,
  LARC_009777_APN,
  LARC_009777_FILE_RECORD_ID,
  markDocsExtracted,
  traceLarc009777,
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
});
