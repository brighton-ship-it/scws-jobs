import {
  centroidFromRings,
  distanceToRingFt,
  haversineFeet,
  minDistanceToPolygonsFt,
  pointInRing,
  ringBBox,
} from './gis.ts';
import {
  EXISTING_WELL_SETBACK_FT,
  LEACH_SETBACK_FT,
  PROPERTY_LINE_SETBACK_FT,
  TANK_SETBACK_FT,
  type County,
  type ProposedWell,
  type SepticGeometry,
  type StructureFootprint,
  type WellInfo,
} from './types.ts';

const GRID_STEP_FT = 18;
const FEET_PER_DEG_LAT = 364000;

export interface PlaceWellInput {
  rings?: number[][][];
  county: County;
  tanks?: Array<{ lat: number; lng: number } | { rings: number[][][] }>;
  leaches?: Array<{ lat: number; lng: number } | { rings: number[][][] }>;
  existingWells?: Array<{ lat: number; lng: number }>;
  structures?: StructureFootprint[];
}

function degPerFoot(lat: number): { dLat: number; dLng: number } {
  return {
    dLat: 1 / FEET_PER_DEG_LAT,
    dLng: 1 / (FEET_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)),
  };
}

function featureDistance(
  lat: number,
  lng: number,
  feature?: { lat?: number; lng?: number; rings?: number[][][] }
): number | null {
  if (!feature) return null;
  if (feature.rings?.length) {
    return minDistanceToPolygonsFt(lat, lng, feature.rings);
  }
  if (feature.lat != null && feature.lng != null) {
    return haversineFeet(lat, lng, feature.lat, feature.lng);
  }
  return null;
}

function minFeatureDistance(
  lat: number,
  lng: number,
  features: Array<{ lat?: number; lng?: number; rings?: number[][][] }>
): number | null {
  let best: number | null = null;
  for (const feature of features) {
    const d = featureDistance(lat, lng, feature);
    if (d == null) continue;
    best = best == null ? d : Math.min(best, d);
  }
  return best;
}

function insideAnyStructure(lat: number, lng: number, structures: StructureFootprint[]): boolean {
  for (const structure of structures) {
    for (const ring of structure.rings || []) {
      if (pointInRing(lng, lat, ring)) return true;
    }
  }
  return false;
}

export function evaluatePin(
  lat: number,
  lng: number,
  input: PlaceWellInput
): {
  ok: boolean;
  flags: string[];
  distances: ProposedWell['distances'];
  score: number;
  insideParcel: boolean;
} {
  const ring = input.rings?.[0];
  const plNeeded = PROPERTY_LINE_SETBACK_FT[input.county];
  const insideParcel = ring ? pointInRing(lng, lat, ring) : false;
  const propertyLineFt = ring ? distanceToRingFt(lat, lng, ring) : null;
  const tankFt = minFeatureDistance(lat, lng, input.tanks || []);
  const leachFt = minFeatureDistance(lat, lng, input.leaches || []);
  const existingWellFt = minFeatureDistance(lat, lng, input.existingWells || []);
  const structureFt = minFeatureDistance(
    lat,
    lng,
    (input.structures || []).map((s) => ({ rings: s.rings }))
  );

  const flags: string[] = [];
  if (!insideParcel) flags.push('Pin is outside the subject parcel');
  if (propertyLineFt != null && propertyLineFt < plNeeded) {
    flags.push(`${Math.round(propertyLineFt)} ft to property line (need ≥${plNeeded} ft)`);
  }
  if (tankFt != null && tankFt < TANK_SETBACK_FT) {
    flags.push(`${Math.round(tankFt)} ft to septic tank (need ≥${TANK_SETBACK_FT} ft)`);
  }
  if (leachFt != null && leachFt < LEACH_SETBACK_FT) {
    flags.push(`${Math.round(leachFt)} ft to leach field (need ≥${LEACH_SETBACK_FT} ft)`);
  }
  if (existingWellFt != null && existingWellFt < EXISTING_WELL_SETBACK_FT) {
    flags.push(
      `${Math.round(existingWellFt)} ft to existing well (need ≥${EXISTING_WELL_SETBACK_FT} ft)`
    );
  }
  if (insideAnyStructure(lat, lng, input.structures || [])) {
    flags.push('Pin sits on a building footprint');
  }

  const ok = flags.length === 0 && insideParcel;
  let score = 0;
  if (ok) score += 20000;
  else score += Math.max(0, 8000 - flags.length * 1500);
  if (propertyLineFt != null) score += Math.min(propertyLineFt, 180);
  if (tankFt != null) score += Math.min(tankFt, 200);
  if (leachFt != null) score += Math.min(leachFt, 250);
  if (existingWellFt != null) score += Math.min(existingWellFt, 200);
  if (structureFt != null) score += Math.min(structureFt, 120) * 0.6;

  return {
    ok,
    flags,
    distances: {
      propertyLineFt: propertyLineFt != null ? Math.round(propertyLineFt) : null,
      tankFt: tankFt != null ? Math.round(tankFt) : null,
      leachFt: leachFt != null ? Math.round(leachFt) : null,
      existingWellFt: existingWellFt != null ? Math.round(existingWellFt) : null,
      structureFt: structureFt != null ? Math.round(structureFt) : null,
    },
    score,
    insideParcel,
  };
}

export function placeProposedWell(input: PlaceWellInput): ProposedWell | null {
  const ring = input.rings?.[0];
  if (!ring || ring.length < 3) return null;

  const bbox = ringBBox(ring);
  const midLat = (bbox.minY + bbox.maxY) / 2;
  const { dLat, dLng } = degPerFoot(midLat);
  const candidates: Array<{ lat: number; lng: number; eval: ReturnType<typeof evaluatePin> }> = [];

  for (let lat = bbox.minY; lat <= bbox.maxY; lat += GRID_STEP_FT * dLat) {
    for (let lng = bbox.minX; lng <= bbox.maxX; lng += GRID_STEP_FT * dLng) {
      if (!pointInRing(lng, lat, ring)) continue;
      const ev = evaluatePin(lat, lng, input);
      candidates.push({ lat, lng, eval: ev });
    }
  }

  const centroid = centroidFromRings(input.rings);
  if (centroid && pointInRing(centroid.lng, centroid.lat, ring)) {
    candidates.push({ lat: centroid.lat, lng: centroid.lng, eval: evaluatePin(centroid.lat, centroid.lng, input) });
  }

  if (!candidates.length) return null;

  const passing = candidates.filter((c) => c.eval.ok);
  const pool = passing.length ? passing : candidates;
  pool.sort((a, b) => b.eval.score - a.eval.score);
  const best = pool[0];

  const usedCentroid =
    centroid &&
    Math.abs(best.lat - centroid.lat) < 1e-7 &&
    Math.abs(best.lng - centroid.lng) < 1e-7;
  const source: ProposedWell['source'] = best.eval.ok && !usedCentroid ? 'setback_search' : 'best_pocket';
  const flags = [...best.eval.flags];
  if (!best.eval.ok) {
    flags.unshift('No pocket meets every typical DEH setback — best available pin, distances flagged.');
  }
  if (usedCentroid && !best.eval.ok) {
    flags.push('Best pocket collapsed to the parcel centroid; confirm in the field.');
  }

  return {
    lat: best.lat,
    lng: best.lng,
    source,
    meetsSetbacks: best.eval.ok,
    flags,
    distances: best.eval.distances,
    wgs84: { lat: best.lat, lng: best.lng },
  };
}

export function septicGeometryFromKnown(geometry: SepticGeometry[] | undefined): {
  tanks: PlaceWellInput['tanks'];
  leaches: PlaceWellInput['leaches'];
  existingWells: PlaceWellInput['existingWells'];
} {
  const tanks: NonNullable<PlaceWellInput['tanks']> = [];
  const leaches: NonNullable<PlaceWellInput['leaches']> = [];
  const existingWells: NonNullable<PlaceWellInput['existingWells']> = [];
  for (const item of geometry || []) {
    if (item.kind === 'tank') {
      if (item.rings) tanks.push({ rings: item.rings });
      else if (item.lat != null && item.lng != null) tanks.push({ lat: item.lat, lng: item.lng });
    } else if (item.kind === 'leach') {
      if (item.rings) leaches.push({ rings: item.rings });
      else if (item.lat != null && item.lng != null) leaches.push({ lat: item.lat, lng: item.lng });
    } else if (item.kind === 'existing_well' && item.lat != null && item.lng != null) {
      existingWells.push({ lat: item.lat, lng: item.lng });
    }
  }
  return { tanks, leaches, existingWells };
}

export function wellsAsPoints(wells: WellInfo[]): Array<{ lat: number; lng: number }> {
  return wells
    .filter((w) => Number.isFinite(w.latitude) && Number.isFinite(w.longitude))
    .map((w) => ({ lat: w.latitude, lng: w.longitude }));
}
