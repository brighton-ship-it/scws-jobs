import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dashedDehApn,
  fileRecordIdFromUrl,
  isAsBuiltCandidate,
  mapDehRecord,
  searchDehDocuments,
} from './deh-docs.ts';

describe('DEH document library mapping', () => {
  it('extracts FileRecordId and never claims geometry was extracted', () => {
    const doc = mapDehRecord({
      url: 'https://file.sandiegocounty.gov/LUEG/LUEG_View?FileRecordId=36954960',
      permit_id: '',
      parcel_nbr: '129-092-71-00',
      lueg_type: 'DEH-LWQD',
      lueg_subtype: 'DEH-LWQD-Land Use Archive-Parcel',
      a_content_type: 'PDF',
    });
    assert.ok(doc);
    assert.equal(doc!.fileRecordId, '36954960');
    assert.equal(doc!.geometryExtracted, false);
    assert.equal(doc!.isAsBuiltCandidate, true);
    assert.match(doc!.note, /geometry not extracted/i);
    assert.equal(fileRecordIdFromUrl(doc!.viewUrl), '36954960');
    assert.equal(isAsBuiltCandidate('DEH-LWQD-OWTS Layout'), true);
    assert.equal(isAsBuiltCandidate('DEH-LWQD-Water Well Permit'), false);
  });

  it('POSTs a dashed APN to SearchDocuments and does not claim geometry was extracted', async () => {
    assert.equal(dashedDehApn('1290927100'), '129-092-71-00');
    const seen: string[] = [];
    const docs = await searchDehDocuments('1290927100', async (url, init) => {
      const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body || '');
      seen.push(`${init?.method || 'GET'} ${url} ${body}`);
      return new Response(
        JSON.stringify({
          records: [
            {
              url: 'https://file.sandiegocounty.gov/LUEG/LUEG_View?FileRecordId=36954960',
              parcel_nbr: '129-092-71-00',
              lueg_type: 'DEH-LWQD',
              lueg_subtype: 'DEH-LWQD-Land Use Archive-Parcel',
            },
            {
              url: 'https://file.sandiegocounty.gov/LUEG/LUEG_View?FileRecordId=35294234',
              permit_id: 'DEH1991-LWELL-7996',
              parcel_nbr: '129-092-71-00',
              lueg_type: 'DEH-LWQD',
              lueg_subtype: 'DEH-LWQD-Water Well Permit',
            },
          ],
          valid: 'ok',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    assert.ok(seen[0].includes('POST'));
    assert.ok(seen[0].includes('SearchDocuments'));
    assert.ok(seen[0].includes('parcel_number=129-092-71-00'));
    assert.equal(docs.length, 2);
    assert.equal(docs[0].fileRecordId, '36954960');
    assert.equal(docs.every((d) => d.geometryExtracted === false), true);
  });

  it('merges the 8-digit dashed APN so OWTS Layout 35347714 is not dropped', async () => {
    const docs = await searchDehDocuments('129-092-69-00', async (url, init) => {
      const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body || url);
      const parcel = decodeURIComponent(body.match(/parcel_number=([^&]+)/)?.[1] || String(url).match(/parcel_number=([^&]+)/)?.[1] || '');
      if (init?.method === 'POST') {
        return new Response('{}', { status: 405 });
      }
      const records =
        parcel === '129-092-69'
          ? [
              {
                url: 'https://file.sandiegocounty.gov/LUEG/LUEG_View?FileRecordId=35347714',
                permit_id: 'DEH2017-LOWTS-008122',
                parcel_nbr: '129-092-69',
                lueg_type: 'DEH-LWQD',
                lueg_subtype: 'DEH-LWQD-OWTS Layout',
              },
              {
                url: 'https://file.sandiegocounty.gov/LUEG/LUEG_View?FileRecordId=37010971',
                parcel_nbr: '129-092-69',
                lueg_type: 'DEH-LWQD',
                lueg_subtype: 'DEH-LWQD-Land Use Archive-Parcel',
              },
            ]
          : parcel === '129-092-69-00'
            ? [
                {
                  url: 'https://file.sandiegocounty.gov/LUEG/LUEG_View?FileRecordId=37010971',
                  parcel_nbr: '129-092-69-00',
                  lueg_type: 'DEH-LWQD',
                  lueg_subtype: 'DEH-LWQD-Land Use Archive-Parcel',
                },
              ]
            : [];
      return new Response(JSON.stringify({ records }), { status: 200 });
    });
    assert.ok(docs.some((d) => d.fileRecordId === '35347714' && d.isAsBuiltCandidate));
    assert.ok(docs.some((d) => d.fileRecordId === '37010971'));
  });
});
