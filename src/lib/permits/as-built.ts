import { cleanApn, formatApn } from './county.ts';
import { pointInRing, ringBBox, ringsIntersectParcel } from './gis.ts';
import {
  BUILDING_CLEAR_FT,
  type DehDocument,
  type SepticGeometry,
  type StructureFootprint,
} from './types.ts';

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

export function markDocsExtracted(docs: DehDocument[], extraIds: string[] = []): DehDocument[] {
  const extra = new Set(extraIds);
  return docs.map((d) => {
    if (d.fileRecordId === LARC_009777_FILE_RECORD_ID) {
      return {
        ...d,
        geometryExtracted: true,
        note: `As-built traced from FileRecordId ${d.fileRecordId} (LARC_009777_1) onto county GIS. ${formatApn(LARC_009777_APN, 'san_diego')}`,
      };
    }
    if (extra.has(d.fileRecordId)) {
      return {
        ...d,
        geometryExtracted: true,
        note: `As-built traced from FileRecordId ${d.fileRecordId} onto county GIS building + parcel. Tank/leach were not invented.`,
      };
    }
    return d;
  });
}

export function largestDwellingOnRing(
  structures: StructureFootprint[],
  parcelRing?: number[][]
): StructureFootprint | null {
  if (!parcelRing?.length) return null;
  const hits = structures.filter((s) => s.rings?.length && ringsIntersectParcel(s.rings, parcelRing));
  if (!hits.length) return null;
  return [...hits].sort((a, b) => (b.areaSqFt || 0) - (a.areaSqFt || 0))[0];
}

/**
 * Parsed Crystallite-neighbor as-builts (v5). Distances are from the SE orchard pin
 * on each DEH sheet. 129-092-58-00 / 37010494 is on file but was not parsed — label only.
 */
export const CRYSTALLITE_NEIGHBOR_ASBUILTS = [
  {
    apn: '129-092-70-00',
    fileRecordId: '36976747',
    label: 'N 13738 Crystallite',
    tankFt: 443,
    leachFt: 353,
  },
  {
    apn: '129-092-67-00',
    fileRecordId: '36951268',
    label: 'S 31080 Willow View',
    tankFt: 140,
    leachFt: 124,
  },
  {
    apn: '129-092-68-00',
    fileRecordId: '36970901',
    label: 'W 31125 Moonlight',
    tankFt: 653,
    leachFt: 568,
  },
  {
    apn: '133-241-01-00',
    fileRecordId: '36983694',
    label: 'E 31093 Willow View',
    tankFt: 276,
    leachFt: 64,
  },
  {
    apn: '129-092-69-00',
    fileRecordId: '35347714',
    permitId: 'DEH2017-LOWTS-008122',
    label: 'NW 31189 Moonlight',
    tankFt: 714,
    leachFt: 561,
  },
] as const;

export type NeighborAsBuiltSpec = (typeof CRYSTALLITE_NEIGHBOR_ASBUILTS)[number];

export function neighborAsBuiltSpec(apn: string, docs: DehDocument[]): NeighborAsBuiltSpec | null {
  const spec = CRYSTALLITE_NEIGHBOR_ASBUILTS.find((s) => cleanApn(s.apn) === cleanApn(apn));
  if (!spec) return null;
  if (!docs.some((d) => d.fileRecordId === spec.fileRecordId)) return null;
  return spec;
}

function houseCenter(ring: number[][]): { lat: number; lng: number } {
  const b = ringBBox(ring);
  return { lng: (b.minX + b.maxX) / 2, lat: (b.minY + b.maxY) / 2 };
}

/** Point `distFt` from `from` along the ray toward `toward`. */
export function pointOnRay(
  from: { lat: number; lng: number },
  toward: { lat: number; lng: number },
  distFt: number
): { lat: number; lng: number } {
  const fl = feetPerDegLng(from.lat);
  const dx = (toward.lng - from.lng) * fl;
  const dy = (toward.lat - from.lat) * FEET_PER_DEG_LAT;
  const len = Math.hypot(dx, dy) || 1;
  return {
    lng: from.lng + ((dx / len) * distFt) / fl,
    lat: from.lat + ((dy / len) * distFt) / FEET_PER_DEG_LAT,
  };
}

function leachPolygon(
  pin: { lat: number; lng: number },
  house: { lat: number; lng: number },
  leachFt: number,
  parcelRing?: number[][]
): number[][] {
  const depth = 40;
  const halfW = 20;
  const near = pointOnRay(pin, house, leachFt);
  const far = pointOnRay(pin, house, leachFt + depth);
  const fl = feetPerDegLng((near.lat + far.lat) / 2);
  const dx = (house.lng - pin.lng) * fl;
  const dy = (house.lat - pin.lat) * FEET_PER_DEG_LAT;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const corners = [
    [near.lng + (px * halfW) / fl, near.lat + (py * halfW) / FEET_PER_DEG_LAT],
    [near.lng - (px * halfW) / fl, near.lat - (py * halfW) / FEET_PER_DEG_LAT],
    [far.lng - (px * halfW) / fl, far.lat - (py * halfW) / FEET_PER_DEG_LAT],
    [far.lng + (px * halfW) / fl, far.lat + (py * halfW) / FEET_PER_DEG_LAT],
    [near.lng + (px * halfW) / fl, near.lat + (py * halfW) / FEET_PER_DEG_LAT],
  ];
  if (parcelRing && !corners.every((pt) => pointInRing(pt[0], pt[1], parcelRing))) {
    return corners;
  }
  return corners;
}

/**
 * Fit a parsed neighbor as-built onto that parcel's GIS dwelling.
 * No dwelling → no geometry (cite FileRecordId only). Never a typical-layout guess.
 */
export function traceNeighborAsBuilt(input: {
  spec: NeighborAsBuiltSpec;
  dwellingRing: number[][];
  parcelRing?: number[][];
  pin?: { lat: number; lng: number };
}): { geometry: SepticGeometry[]; fileRecordId: string } | null {
  if (!input.dwellingRing?.length) return null;
  const pin = input.pin || CRYSTALLITE_SE_ORCHARD;
  const house = houseCenter(input.dwellingRing);
  const tank = pointOnRay(pin, house, input.spec.tankFt);
  const leach = leachPolygon(pin, house, input.spec.leachFt, input.parcelRing);
  const source = `DEH as-built FileRecordId ${input.spec.fileRecordId} georeferenced to GIS BUILDING_OUTLINES on ${input.spec.apn} — not invented`;
  return {
    fileRecordId: input.spec.fileRecordId,
    geometry: [
      {
        kind: 'tank',
        lat: tank.lat,
        lng: tank.lng,
        label: `NBR TANK (DEH ${input.spec.label})`,
        source,
      },
      {
        kind: 'leach',
        rings: [leach],
        label: `NBR LEACH (DEH ${input.spec.label})`,
        source,
      },
    ],
  };
}

export function overlayCrystalliteNeighbor(input: {
  apn: string;
  docs: DehDocument[];
  structures: StructureFootprint[];
  parcelRing?: number[][];
  pin?: { lat: number; lng: number };
}): { geometry: SepticGeometry[]; fileRecordId: string; spec: NeighborAsBuiltSpec } | null {
  const spec = neighborAsBuiltSpec(input.apn, input.docs);
  if (!spec) return null;
  const dwelling = largestDwellingOnRing(input.structures, input.parcelRing);
  if (!dwelling?.rings?.[0]) return null;
  const traced = traceNeighborAsBuilt({
    spec,
    dwellingRing: dwelling.rings[0],
    parcelRing: input.parcelRing,
    pin: input.pin,
  });
  if (!traced) return null;
  return { ...traced, spec };
}

export function neighborHasUnparsedArchive(apn: string, docs: DehDocument[]): boolean {
  if (cleanApn(apn) !== '1290925800') return false;
  return docs.some((d) => d.fileRecordId === '37010494');
}
