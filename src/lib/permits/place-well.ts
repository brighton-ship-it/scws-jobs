import {
  distanceToRingFt,
  haversineFeet,
  minDistanceToPolygonsFt,
  pointInRing,
  ringBBox,
} from './gis.ts';
import {
  BUILDING_CLEAR_FT,
  COUNTY_SETBACKS,
  EXISTING_WELL_SETBACK_FT,
  LEACH_SETBACK_FT,
  PROPERTY_LINE_SETBACK_FT,
  TANK_SETBACK_FT,
  type County,
  type NeighborParcel,
  type ProposedWell,
  type SepticGeometry,
  type StructureFootprint,
  type WellInfo,
} from './types.ts';

function tankSetback(county: County): number {
  return COUNTY_SETBACKS[county]?.tankFt ?? TANK_SETBACK_FT;
}

function leachSetback(county: County): number {
  return COUNTY_SETBACKS[county]?.leachFt ?? LEACH_SETBACK_FT;
}

const GRID_STEP_FT = 8;
const REFINE_STEP_FT = 2;
const REFINE_RADIUS_FT = 16;
const FEET_PER_DEG_LAT = 364000;

export interface PlaceWellInput {
  rings?: number[][][];
  county: County;
  tanks?: Array<{ lat: number; lng: number } | { rings: number[][][] }>;
  leaches?: Array<{ lat: number; lng: number } | { rings: number[][][] }>;
  existingWells?: Array<{ lat: number; lng: number }>;
  structures?: StructureFootprint[];
  easements?: number[][][];
}

export interface PinEvaluation {
  ok: boolean;
  feasible: boolean;
  flags: string[];
  distances: ProposedWell['distances'];
  /** min-distance to tank / leach / existing well. Null when none of those exist. */
  hazardMin: number | null;
  score: number;
  insideParcel: boolean;
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

function insideAnyRing(lat: number, lng: number, rings: number[][][] | undefined): boolean {
  for (const ring of rings || []) {
    if (pointInRing(lng, lat, ring)) return true;
  }
  return false;
}

function insideAnyStructure(lat: number, lng: number, structures: StructureFootprint[]): boolean {
  for (const structure of structures) {
    if (insideAnyRing(lat, lng, structure.rings)) return true;
  }
  return false;
}

/** More south-east wins (lower lat, then higher lng). */
function seRank(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  if (Math.abs(a.lat - b.lat) > 1e-9) return a.lat - b.lat;
  return b.lng - a.lng;
}

function betterCandidate(
  a: { lat: number; lng: number; eval: PinEvaluation },
  b: { lat: number; lng: number; eval: PinEvaluation }
): number {
  if (Math.abs(a.eval.score - b.eval.score) > 0.5) return b.eval.score - a.eval.score;
  return seRank(a, b);
}

export function evaluatePin(lat: number, lng: number, input: PlaceWellInput): PinEvaluation {
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
  const inBuilding = insideAnyStructure(lat, lng, input.structures || []);
  const inEasement = insideAnyRing(lat, lng, input.easements);

  const flags: string[] = [];
  if (!insideParcel) flags.push('Pin is outside the subject parcel');
  if (inEasement) flags.push('Pin sits in the recorded west easement');
  if (propertyLineFt != null && propertyLineFt < plNeeded) {
    flags.push(`${Math.round(propertyLineFt)} ft to property line (need >=${plNeeded} ft)`);
  }
  if (inBuilding) flags.push('Pin sits on a building footprint');
  if (!inBuilding && structureFt != null && structureFt < BUILDING_CLEAR_FT) {
    flags.push(`${Math.round(structureFt)} ft to building (need >=${BUILDING_CLEAR_FT} ft)`);
  }
  const tankNeed = tankSetback(input.county);
  const leachNeed = leachSetback(input.county);
  if (tankFt != null && tankFt < tankNeed) {
    flags.push(`${Math.round(tankFt)} ft to septic tank (need >=${tankNeed} ft)`);
  }
  if (leachFt != null && leachFt < leachNeed) {
    flags.push(`${Math.round(leachFt)} ft to leach field (need >=${leachNeed} ft)`);
  }
  if (existingWellFt != null && existingWellFt < EXISTING_WELL_SETBACK_FT) {
    flags.push(
      `${Math.round(existingWellFt)} ft to existing well (need >=${EXISTING_WELL_SETBACK_FT} ft)`
    );
  }

  const plOk = propertyLineFt == null || propertyLineFt >= plNeeded;
  const buildingClear = !inBuilding && (structureFt == null || structureFt >= BUILDING_CLEAR_FT);
  const feasible = Boolean(insideParcel && !inEasement && plOk && buildingClear);
  const setbacksMet =
    (tankFt == null || tankFt >= tankNeed) &&
    (leachFt == null || leachFt >= leachNeed) &&
    (existingWellFt == null || existingWellFt >= EXISTING_WELL_SETBACK_FT);
  const ok = feasible && setbacksMet;

  const hazards = [tankFt, leachFt, existingWellFt].filter((d): d is number => d != null);
  const hazardMin = hazards.length ? Math.min(...hazards) : null;

  // Maximin to leach + tank + existing well. Constraints are hard gates, not score terms.
  // When no as-built hazards exist, score ties and the SE rank picks the orchard pocket.
  const slack =
    (insideParcel ? 1000 : -10000) +
    (inEasement ? -4000 : 0) +
    (inBuilding ? -4000 : 0) +
    (propertyLineFt != null ? Math.min(propertyLineFt - plNeeded, 0) * 40 : 0) +
    (structureFt != null ? Math.min(structureFt - BUILDING_CLEAR_FT, 0) * 20 : 0);
  const score = feasible ? (hazardMin ?? 0) : slack + (hazardMin ?? 0);

  return {
    ok,
    feasible,
    flags,
    distances: {
      propertyLineFt: propertyLineFt != null ? Math.round(propertyLineFt) : null,
      tankFt: tankFt != null ? Math.round(tankFt) : null,
      leachFt: leachFt != null ? Math.round(leachFt) : null,
      existingWellFt: existingWellFt != null ? Math.round(existingWellFt) : null,
      structureFt: structureFt != null ? Math.round(structureFt) : null,
    },
    hazardMin,
    score,
    insideParcel,
  };
}

function scanGrid(
  ring: number[][],
  input: PlaceWellInput,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  stepFt: number
): Array<{ lat: number; lng: number; eval: PinEvaluation }> {
  const midLat = (bbox.minY + bbox.maxY) / 2;
  const { dLat, dLng } = degPerFoot(midLat);
  const out: Array<{ lat: number; lng: number; eval: PinEvaluation }> = [];
  for (let lat = bbox.minY; lat <= bbox.maxY + 1e-12; lat += stepFt * dLat) {
    for (let lng = bbox.minX; lng <= bbox.maxX + 1e-12; lng += stepFt * dLng) {
      if (!pointInRing(lng, lat, ring)) continue;
      out.push({ lat, lng, eval: evaluatePin(lat, lng, input) });
    }
  }
  return out;
}

/**
 * Place a proposed well by maximizing the minimum distance to leach, tank, and
 * existing well. Never uses the parcel centroid as a candidate. If no grid
 * point meets 100 ft to leach, the best pocket is returned and FLAGGED.
 */
export function placeProposedWell(input: PlaceWellInput): ProposedWell | null {
  const ring = input.rings?.[0];
  if (!ring || ring.length < 3) return null;

  const bbox = ringBBox(ring);
  let candidates = scanGrid(ring, input, bbox, GRID_STEP_FT);
  if (!candidates.length) return null;

  candidates.sort(betterCandidate);
  const coarse = candidates[0];

  const { dLat, dLng } = degPerFoot(coarse.lat);
  const refineBox = {
    minX: coarse.lng - REFINE_RADIUS_FT * dLng,
    maxX: coarse.lng + REFINE_RADIUS_FT * dLng,
    minY: coarse.lat - REFINE_RADIUS_FT * dLat,
    maxY: coarse.lat + REFINE_RADIUS_FT * dLat,
  };
  const refined = scanGrid(ring, input, refineBox, REFINE_STEP_FT);
  if (refined.length) {
    candidates = candidates.concat(refined);
    candidates.sort(betterCandidate);
  }

  const feasible = candidates.filter((c) => c.eval.feasible);
  const pool = feasible.length ? feasible : candidates;
  pool.sort(betterCandidate);
  const best = pool[0];

  const flags = [...best.eval.flags];
  if (!best.eval.ok) {
    flags.unshift(
      'FLAG: no pocket meets every typical DEH setback (100 ft leach). Best available pin — not the parcel centroid.'
    );
  }
  if (best.eval.distances.leachFt != null && best.eval.distances.leachFt < LEACH_SETBACK_FT) {
    if (!flags.some((f) => /100 ft leach/i.test(f))) {
      flags.unshift(
        `FLAG: ${best.eval.distances.leachFt} ft to leach (need >=${LEACH_SETBACK_FT} ft). Centroid was not used.`
      );
    }
  }

  return {
    lat: best.lat,
    lng: best.lng,
    source: best.eval.ok ? 'setback_search' : 'best_pocket',
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
  easements: number[][][];
} {
  const tanks: NonNullable<PlaceWellInput['tanks']> = [];
  const leaches: NonNullable<PlaceWellInput['leaches']> = [];
  const existingWells: NonNullable<PlaceWellInput['existingWells']> = [];
  const easements: number[][][] = [];
  for (const item of geometry || []) {
    if (item.kind === 'tank') {
      if (item.rings) tanks.push({ rings: item.rings });
      else if (item.lat != null && item.lng != null) tanks.push({ lat: item.lat, lng: item.lng });
    } else if (item.kind === 'leach') {
      if (item.rings) leaches.push({ rings: item.rings });
      else if (item.lat != null && item.lng != null) leaches.push({ lat: item.lat, lng: item.lng });
    } else if (item.kind === 'existing_well' && item.lat != null && item.lng != null) {
      existingWells.push({ lat: item.lat, lng: item.lng });
    } else if (item.kind === 'easement' && item.rings) {
      easements.push(...item.rings);
    }
  }
  return { tanks, leaches, existingWells, easements };
}

/**
 * Apply neighbor tank/leach setbacks after placement. Neighbor leach does not
 * move the pin (SE orchard stays); it FLAGGED if leach < 100 or tank < 50.
 */
export function flagNeighborSetbacks(
  pin: ProposedWell,
  neighbors: NeighborParcel[],
  county: County = 'san_diego'
): ProposedWell {
  let neighborTankFt: number | null = null;
  let neighborLeachFt: number | null = null;
  const flags = [...pin.flags];
  let neighborOk = true;
  const tankNeed = tankSetback(county);
  const leachNeed = leachSetback(county);

  for (const n of neighbors) {
    const tank = (n.geometry || []).find((g) => g.kind === 'tank');
    const leach = (n.geometry || []).find((g) => g.kind === 'leach');
    const tankFt = tank ? featureDistance(pin.lat, pin.lng, tank) : null;
    const leachFt = leach ? featureDistance(pin.lat, pin.lng, leach) : null;
    if (tankFt != null) {
      n.tankFt = Math.round(tankFt);
      neighborTankFt = neighborTankFt == null ? tankFt : Math.min(neighborTankFt, tankFt);
      if (tankFt < tankNeed) {
        neighborOk = false;
        flags.push(
          `FLAG: ${Math.round(tankFt)} ft to neighbor tank ${n.apn} (need >=${tankNeed} ft)`
        );
      }
    }
    if (leachFt != null) {
      n.leachFt = Math.round(leachFt);
      neighborLeachFt = neighborLeachFt == null ? leachFt : Math.min(neighborLeachFt, leachFt);
      if (leachFt < leachNeed) {
        neighborOk = false;
        flags.push(
          `FLAG: ${Math.round(leachFt)} ft to neighbor leach ${n.apn} (need >=${leachNeed} ft)`
        );
      }
    }
  }

  return {
    ...pin,
    meetsSetbacks: pin.meetsSetbacks && neighborOk,
    flags,
    distances: {
      ...pin.distances,
      neighborTankFt: neighborTankFt != null ? Math.round(neighborTankFt) : null,
      neighborLeachFt: neighborLeachFt != null ? Math.round(neighborLeachFt) : null,
    },
  };
}

export function wellsAsPoints(wells: WellInfo[]): Array<{ lat: number; lng: number }> {
  return wells
    .filter((w) => Number.isFinite(w.latitude) && Number.isFinite(w.longitude))
    .map((w) => ({ lat: w.latitude, lng: w.longitude }));
}
