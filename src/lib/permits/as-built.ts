import { cleanApn, formatApn } from './county.ts';
import { ringBBox } from './gis.ts';
import { BUILDING_CLEAR_FT, type DehDocument, type SepticGeometry, type StructureFootprint } from './types.ts';

export { BUILDING_CLEAR_FT };

/** DEH Land Use Archive sheet that the Crystallite tank/leach/well were traced from. */
export const LARC_009777_FILE_RECORD_ID = '36954960';
export const LARC_009777_APN = '129-092-71-00';
export const LARC_009777_SOURCE =
  'DEH as-built FileRecordId 36954960 (LARC_009777_1) georeferenced to SD parcel + BUILDING_OUTLINES — not invented';

export const WEST_EASEMENT_FT = 40;
/** Tank is immediately east of the dwelling on LARC_009777_1 (~10 ft from the east wall). */
export const LARC_TANK_EAST_OF_HOUSE_FT = 10;
/** Existing well W61895 sits in the NE corner on the as-built. */
export const LARC_WELL_SOUTH_OF_N_PL_FT = 20;
export const LARC_WELL_WEST_OF_E_PL_FT = 12;
/** Gold-standard SE orchard pin on the as-built schematic (v4). */
export const CRYSTALLITE_SE_ORCHARD = { lat: 33.27711717, lng: -117.03266212 };

const FEET_PER_DEG_LAT = 364000;

function feetPerDegLng(lat: number): number {
  return FEET_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Overlay is Crystallite-specific. Do not apply this sheet to another APN. */
export function hasLarc009777(apn?: string, _docs: DehDocument[] = []): boolean {
  return cleanApn(apn || '') === cleanApn(LARC_009777_APN);
}

export function largestOnParcelDwelling(
  structures: StructureFootprint[]
): StructureFootprint | null {
  const onParcel = structures.filter((s) => s.onSubjectParcel && s.rings?.[0]?.length);
  if (!onParcel.length) return null;
  return [...onParcel].sort((a, b) => (b.areaSqFt || 0) - (a.areaSqFt || 0))[0] || null;
}

function ringBounds(ring: number[][]): { minX: number; minY: number; maxX: number; maxY: number } {
  return ringBBox(ring);
}

/**
 * Georeference LARC_009777_1 onto the GIS parcel + dwelling.
 * Tank east of house, leach/reserve south of house, well NE, 40 ft west easement —
 * all taken from the DEH as-built sheet, not a typical-layout guess.
 */
export function traceLarc009777(input: {
  parcelRing: number[][];
  dwellingRing: number[][];
}): { geometry: SepticGeometry[]; easementRing: number[][] } | null {
  if (!input.parcelRing?.length || !input.dwellingRing?.length) return null;
  const parcel = ringBounds(input.parcelRing);
  const house = ringBounds(input.dwellingRing);
  const midLat = (house.minY + house.maxY) / 2;
  const fl = feetPerDegLng(midLat);

  const tankLat = midLat;
  const tankLng = house.maxX + LARC_TANK_EAST_OF_HOUSE_FT / fl;

  const wellLat = parcel.maxY - LARC_WELL_SOUTH_OF_N_PL_FT / FEET_PER_DEG_LAT;
  const wellLng = parcel.maxX - LARC_WELL_WEST_OF_E_PL_FT / fl;

  // 10 ft SE inset used on the as-built plot to measure nearest leach (168 ft).
  const seLat = parcel.minY + 10 / FEET_PER_DEG_LAT;
  const seLng = parcel.maxX - 10 / fl;
  const leachEast = seLng - 168 / fl;
  const leach = [
    [house.minX, house.minY + 5 / FEET_PER_DEG_LAT],
    [leachEast, house.minY + 5 / FEET_PER_DEG_LAT],
    [leachEast, house.minY - 100 / FEET_PER_DEG_LAT],
    [house.minX, house.minY - 100 / FEET_PER_DEG_LAT],
    [house.minX, house.minY + 5 / FEET_PER_DEG_LAT],
  ];

  const easementEast = parcel.minX + WEST_EASEMENT_FT / fl;
  const easementRing = [
    [parcel.minX, parcel.minY],
    [easementEast, parcel.minY],
    [easementEast, parcel.maxY],
    [parcel.minX, parcel.maxY],
    [parcel.minX, parcel.minY],
  ];

  const geometry: SepticGeometry[] = [
    {
      kind: 'tank',
      lat: tankLat,
      lng: tankLng,
      label: '1000-GAL SEPTIC TANK (DEH as-built)',
      source: LARC_009777_SOURCE,
    },
    {
      kind: 'leach',
      rings: [leach],
      label: 'LEACH FIELD (DEH as-built, 540 ft + 100% reserve)',
      source: LARC_009777_SOURCE,
    },
    {
      kind: 'existing_well',
      lat: wellLat,
      lng: wellLng,
      label: 'EXISTING WELL (as-built W61895)',
      source: LARC_009777_SOURCE,
    },
    {
      kind: 'easement',
      rings: [easementRing],
      label: "40' PRIVATE RD / UTIL EASEMENT (as-built)",
      source: LARC_009777_SOURCE,
    },
  ];
  return { geometry, easementRing };
}

export function markDocsExtracted(docs: DehDocument[]): DehDocument[] {
  return docs.map((d) =>
    d.fileRecordId === LARC_009777_FILE_RECORD_ID
      ? {
          ...d,
          geometryExtracted: true,
          note: `As-built traced from FileRecordId ${d.fileRecordId} (LARC_009777_1) onto county GIS. ${formatApn(LARC_009777_APN, 'san_diego')}`,
        }
      : d
  );
}
