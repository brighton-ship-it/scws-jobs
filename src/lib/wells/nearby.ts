import { median, roundFootage } from '../jobber/dwr.ts';
import { internalAirRotaryCostBand, type DrillingCostBand } from './cost.ts';
import {
  domesticWellsWithDepth,
  queryCnraWells,
  wellsWithDepth,
  type NearbyWell,
} from './cnra.ts';

export type { NearbyWell } from './cnra.ts';
import { geocodeWellAddress, parseCoord, type WellGeoPoint } from './geocode.ts';

const SETBACKS: Record<string, number> = {
  'San Diego': 10,
  Riverside: 50,
  'San Bernardino': 20,
};

export type NearbyWellStats = {
  totalWells: number;
  avgDepth: number | null;
  minDepth: number | null;
  maxDepth: number | null;
  avgYield: number | null;
  domesticMedianDepth: number | null;
  setbackFeet: number;
  radiusMiles: number;
  requestedRadiusMiles: number;
};

export type NearbyWellsResult = {
  wells: NearbyWell[];
  stats: NearbyWellStats;
  setbacks: typeof SETBACKS;
  source: string;
  location: WellGeoPoint;
  cost: DrillingCostBand | null;
};

export type NearbyWellsQuery = {
  address?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  radiusMiles?: number | string | null;
};

async function resolveLocation(
  query: NearbyWellsQuery,
  fetchImpl: typeof fetch
): Promise<WellGeoPoint> {
  const lat = typeof query.lat === 'number' ? query.lat : parseCoord(query.lat ?? null);
  const lng = typeof query.lng === 'number' ? query.lng : parseCoord(query.lng ?? null);
  if (lat && lng) {
    return {
      lat,
      lng,
      city: null,
      formatted: query.address?.trim() || `${lat}, ${lng}`,
      source: 'nominatim',
    };
  }
  if (!query.address?.trim()) {
    throw new Error('Enter an address (or lat/lng).');
  }
  const geo = await geocodeWellAddress(query.address, fetchImpl);
  if (!geo) {
    throw new Error('Could not find that address. Try adding the city and ZIP.');
  }
  return geo;
}

export function summarizeWells(
  wells: NearbyWell[],
  radiusMiles: number,
  requestedRadiusMiles: number
): NearbyWellStats {
  const depthRows = wellsWithDepth(wells);
  const depths = depthRows.map((well) => well.total_drill_depth) as number[];
  const yields = wells
    .map((well) => well.well_yield)
    .filter((n): n is number => typeof n === 'number' && n > 0);
  const domesticDepths = domesticWellsWithDepth(wells).map((well) => well.total_drill_depth) as number[];
  const domesticMedian = median(domesticDepths);
  const county = wells[0]?.county || '';
  return {
    totalWells: wells.length,
    avgDepth: depths.length ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : null,
    minDepth: depths.length ? Math.min(...depths) : null,
    maxDepth: depths.length ? Math.max(...depths) : null,
    avgYield: yields.length ? Math.round((yields.reduce((a, b) => a + b, 0) / yields.length) * 10) / 10 : null,
    domesticMedianDepth: domesticMedian == null ? null : roundFootage(domesticMedian),
    setbackFeet: SETBACKS[county] || 50,
    radiusMiles,
    requestedRadiusMiles,
  };
}

export function costFromStats(stats: NearbyWellStats): DrillingCostBand | null {
  const footage = stats.domesticMedianDepth || stats.avgDepth;
  return footage ? internalAirRotaryCostBand(footage) : null;
}

export async function lookupNearbyWells(
  query: NearbyWellsQuery,
  fetchImpl: typeof fetch = fetch
): Promise<NearbyWellsResult> {
  const requestedRadius = Number(query.radiusMiles ?? 2);
  const radiusMiles = Number.isFinite(requestedRadius) && requestedRadius > 0 ? requestedRadius : 2;
  const location = await resolveLocation(query, fetchImpl);

  const radii = [radiusMiles];
  if (radiusMiles < 5) radii.push(5);
  if (radiusMiles < 10) radii.push(10);

  let usedRadius = radiusMiles;
  let wells: NearbyWell[] = [];
  let lastError: Error | null = null;

  for (const radius of radii) {
    try {
      wells = await queryCnraWells(location.lat, location.lng, radius, fetchImpl);
      usedRadius = radius;
      if (wellsWithDepth(wells).length >= 3 || radius === radii[radii.length - 1]) {
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Well lookup failed');
    }
  }

  if (wells.length === 0 && lastError) {
    throw lastError;
  }

  const stats = summarizeWells(wells, usedRadius, radiusMiles);
  const useful = wells.filter((well) => well.total_drill_depth || well.well_yield || well.static_water_level);
  const rest = wells.filter((well) => !well.total_drill_depth && !well.well_yield && !well.static_water_level);
  return {
    wells: [...useful, ...rest].slice(0, 50),
    stats,
    setbacks: SETBACKS,
    source: 'CA DWR Well Completion Reports (CNRA datastore)',
    location,
    cost: costFromStats(stats),
  };
}
