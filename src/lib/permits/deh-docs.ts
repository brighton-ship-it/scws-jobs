import { formatApn } from './county.ts';
import type { DehDocument } from './types.ts';

/** Public DEH / LWQD document index used by the county Document Library page. */
export const DEH_SEARCH_URL =
  'https://file.sandiegocounty.gov/CoSD_LUEG_Repository_External_API/rest/DEHQDocumentLibrary/SearchDocuments';

export const DEH_VIEW_URL = 'https://file.sandiegocounty.gov/LUEG/LUEG_View';

export const AS_BUILT_SUBTYPE =
  /land use archive|owts layout|leach|septic layout|as-?built/i;

const GEOMETRY_NOTE =
  'As-built on file, geometry not extracted. LUEG_View is a viewer stub; the PDF is not available to the server.';

export function fileRecordIdFromUrl(url?: string | null): string {
  if (!url) return '';
  const match = String(url).match(/FileRecordId=(\d+)/i);
  return match?.[1] || '';
}

export function isAsBuiltCandidate(subcategory?: string | null, permitId?: string | null): boolean {
  return AS_BUILT_SUBTYPE.test(`${subcategory || ''} ${permitId || ''}`);
}

export function mapDehRecord(raw: Record<string, unknown>): DehDocument | null {
  const viewUrl = String(raw.url || '').trim();
  const fileRecordId = fileRecordIdFromUrl(viewUrl);
  if (!fileRecordId && !raw.permit_id && !raw.parcel_nbr) return null;
  const subcategory = raw.lueg_subtype ? String(raw.lueg_subtype) : undefined;
  const permitId = raw.permit_id ? String(raw.permit_id) : undefined;
  return {
    fileRecordId: fileRecordId || 'unknown',
    permitId,
    parcelNbr: raw.parcel_nbr ? String(raw.parcel_nbr) : undefined,
    category: raw.lueg_type ? String(raw.lueg_type) : undefined,
    subcategory,
    description: raw.description ? String(raw.description) : undefined,
    contentType: raw.a_content_type ? String(raw.a_content_type) : undefined,
    viewUrl: viewUrl || `${DEH_VIEW_URL}?FileRecordId=${fileRecordId}`,
    geometryExtracted: false,
    note: GEOMETRY_NOTE,
    isAsBuiltCandidate: isAsBuiltCandidate(subcategory, permitId),
  };
}

function apnCandidates(apn: string): string[] {
  const digits = apn.replace(/\D/g, '');
  const dashed = digits.length === 10 ? formatApn(digits, 'san_diego') : '';
  const short = digits.length >= 8 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 8)}` : '';
  return Array.from(new Set([apn, dashed, short].filter((v) => v && v.includes('-'))));
}

export async function searchDehDocuments(
  apn: string,
  fetchImpl: typeof fetch = fetch
): Promise<DehDocument[]> {
  if (!apn) return [];
  const seen = new Set<string>();
  const out: DehDocument[] = [];
  for (const parcelNumber of apnCandidates(apn)) {
    const url =
      DEH_SEARCH_URL +
      '?' +
      new URLSearchParams({
        parcel_number: parcelNumber,
        doc_category: 'DEH-LWQD',
        maxrecord_count: '50',
      });
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SCWS-PermitResearch/1.0',
          Referer: 'https://www.sandiegocounty.gov/content/sdc/deh/doclibrary/',
        },
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { records?: Record<string, unknown>[] };
      for (const raw of data.records || []) {
        const doc = mapDehRecord(raw);
        if (!doc) continue;
        const key = doc.fileRecordId || `${doc.permitId}-${doc.subcategory}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(doc);
      }
      if (out.length) break;
    } catch {
      // Honest miss — do not invent documents.
    }
  }
  return out.sort((a, b) => Number(b.isAsBuiltCandidate) - Number(a.isAsBuiltCandidate));
}

export function asBuiltOnFile(docs: DehDocument[]): DehDocument[] {
  return docs.filter((d) => d.isAsBuiltCandidate);
}
