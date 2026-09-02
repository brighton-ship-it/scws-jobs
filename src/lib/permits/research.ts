import { detectCounty, isCounty } from './county.ts';
import { centroidFromRings, fetchNearbyStructures, fetchParcelForCounty, geocodeAddress } from './gis.ts';
import type {
  County,
  DataSource,
  ResearchResult,
  SepticInfo,
  SepticPermit,
} from './types.ts';
import { fetchDwrWells } from './wells.ts';

export interface ResearchInput {
  apn?: string;
  address?: string;
  county?: County | string;
  lat?: number;
  lng?: number;
  septicRadiusFeet?: number;
}

export interface ResearchDeps {
  fetchImpl?: typeof fetch;
  lookupSiteSeptic?: (
    apn: string,
    lat?: number,
    lng?: number,
    county?: County
  ) => Promise<SepticInfo | null>;
  lookupNearbySeptic?: (
    lat: number,
    lng: number,
    radiusMeters: number,
    county: County
  ) => Promise<SepticPermit[]>;
}

function missingSeptic(county: County): SepticInfo {
  const phone =
    county === 'riverside'
      ? 'Riverside County DEH at (951) 358-5172'
      : county === 'san_bernardino'
        ? 'San Bernardino County DEHS at (800) 442-2283'
        : 'San Diego County DEH at (858) 505-6700';
  return {
    status: 'missing',
    locationUnknown: true,
    message: `No septic/sewer record in SCWS GIS for this parcel. Tank and leach-field locations were not invented. Confirm with ${phone} before drawing setbacks on a submittal.`,
  };
}

export async function runPermitResearch(
  input: ResearchInput,
  deps: ResearchDeps = {}
): Promise<ResearchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sources: DataSource[] = [];
  const notes: string[] = [];

  if (!input.apn && !input.address && (input.lat == null || input.lng == null)) {
    throw new Error('Either APN, address, or GPS coordinates are required');
  }

  let lat = input.lat;
  let lng = input.lng;
  let formattedAddress = input.address;
  let geoCity: string | null = null;

  if ((lat == null || lng == null) && input.address) {
    const geo = await geocodeAddress(input.address, fetchImpl);
    if (geo) {
      lat = geo.lat;
      lng = geo.lng;
      formattedAddress = geo.formatted || input.address;
      geoCity = geo.city || null;
      sources.push({
        name: 'Address geocode',
        status: 'success',
        message: geo.formatted || `${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)}`,
      });
    } else {
      sources.push({
        name: 'Address geocode',
        status: 'error',
        message: 'Could not geocode that address',
      });
    }
  }

  const county = detectCounty({
    lat,
    lng,
    address: [input.address, formattedAddress, geoCity].filter(Boolean).join(', '),
    county: input.county && isCounty(String(input.county)) ? (input.county as County) : undefined,
  });

  const result: ResearchResult = {
    parcel: null,
    wells: [],
    septic: null,
    septicPermits: [],
    zoning: null,
    sources,
    county,
    searchPoint: lat != null && lng != null ? { lat, lng } : null,
    formattedAddress,
    notes,
    structures: [],
  };

  const gisName =
    county === 'san_diego'
      ? 'San Diego County GIS'
      : county === 'riverside'
        ? 'Riverside County Assessor GIS'
        : 'San Bernardino County GIS';

  try {
    result.parcel = await fetchParcelForCounty(county, {
      apn: input.apn,
      address: input.address,
      lat,
      lng,
      fetchImpl,
    });
    sources.push({
      name: gisName,
      status: result.parcel ? 'success' : 'missing',
      message: result.parcel
        ? `APN ${result.parcel.apn}`
        : 'Parcel not found — no boundary invented',
    });
    if (!result.parcel) {
      notes.push(`${gisName} did not return a parcel for this search. Plot plan will mark the geocoded point only.`);
    } else {
      if (!result.parcel.ownerName) {
        notes.push('Owner is not published on the public county parcel layer. Shown as unknown — not invented.');
      }
      if (input.address && result.parcel.siteAddress) {
        const searchedNum = input.address.match(/^\s*(\d+)/)?.[1];
        const situsNum = result.parcel.siteAddress.match(/^\s*(\d+)/)?.[1];
        if (searchedNum && situsNum && searchedNum !== situsNum) {
          notes.push(
            `Assessor situs is ${result.parcel.siteAddress}. Searched ${input.address} (unit / house number may share this tax lot).`
          );
        }
      }
    }
  } catch (error) {
    sources.push({
      name: gisName,
      status: 'error',
      message: error instanceof Error ? error.message : 'Parcel GIS failed',
    });
    notes.push(`Parcel GIS error: ${error instanceof Error ? error.message : 'unknown'}`);
  }

  let searchLat = lat;
  let searchLng = lng;
  const centroid = centroidFromRings(result.parcel?.geometry?.rings);
  if (centroid) {
    searchLat = centroid.lat;
    searchLng = centroid.lng;
    result.searchPoint = centroid;
  }

  if (searchLat != null && searchLng != null) {
    try {
      result.wells = await fetchDwrWells(searchLat, searchLng, { fetchImpl });
      sources.push({
        name: 'CA DWR Well Completion Reports',
        status: 'success',
        message: `Found ${result.wells.length} wells within 1 mile`,
      });
    } catch (error) {
      sources.push({
        name: 'CA DWR Well Completion Reports',
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'DWR query failed — well locations were not invented',
      });
      notes.push(
        'CA DWR Well Completion Reports are unavailable or returned an error. Nearby well points were not invented.'
      );
    }
  } else {
    sources.push({
      name: 'CA DWR Well Completion Reports',
      status: 'missing',
      message: 'Need a geocoded point or parcel to search wells',
    });
  }

  if (county === 'san_diego' && searchLat != null && searchLng != null) {
    try {
      result.structures = await fetchNearbyStructures(searchLat, searchLng, fetchImpl);
      sources.push({
        name: 'Building outlines',
        status: result.structures.length ? 'success' : 'missing',
        message: result.structures.length
          ? `${result.structures.length} footprints from San Diego BUILDING_OUTLINES`
          : 'No building outlines in the public envelope — footprints were not invented',
      });
    } catch (error) {
      sources.push({
        name: 'Building outlines',
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'BUILDING_OUTLINES query failed — footprints were not invented',
      });
    }
  } else {
    sources.push({
      name: 'Building outlines',
      status: 'missing',
      message: 'No public building-outline layer is wired for this county',
    });
  }

  notes.push(
    'Streets, easements, and surveyed tank/leach geometry are not in the public GIS used here. Shown as unknown.'
  );

  const septicRadiusFeet = input.septicRadiusFeet || 500;
  if (deps.lookupSiteSeptic) {
    try {
      const site = await deps.lookupSiteSeptic(
        result.parcel?.apn || input.apn || '',
        searchLat,
        searchLng,
        county
      );
      if (site && site.status === 'found') {
        result.septic = {
          ...site,
          locationUnknown: site.type === 'SEPTIC' && (site.latitude == null || site.longitude == null),
        };
        sources.push({
          name: 'Septic / sewer record',
          status: 'success',
          message: `Property is on ${site.type}${site.locationUnknown ? ' (tank location not in GIS)' : ''}`,
        });
      } else {
        result.septic = missingSeptic(county);
        sources.push({
          name: 'Septic / sewer record',
          status: 'missing',
          message: result.septic.message,
        });
      }
    } catch {
      result.septic = missingSeptic(county);
      sources.push({
        name: 'Septic / sewer record',
        status: 'missing',
        message: result.septic.message,
      });
    }
  } else {
    result.septic = missingSeptic(county);
    sources.push({
      name: 'Septic / sewer record',
      status: 'missing',
      message: result.septic.message,
    });
  }

  if (deps.lookupNearbySeptic && searchLat != null && searchLng != null) {
    try {
      result.septicPermits = await deps.lookupNearbySeptic(
        searchLat,
        searchLng,
        septicRadiusFeet * 0.3048,
        county
      );
      sources.push({
        name: 'Nearby septic parcels',
        status: result.septicPermits.length ? 'success' : 'missing',
        message: result.septicPermits.length
          ? `Found ${result.septicPermits.length} septic parcels within ${septicRadiusFeet} ft (parcel centroids, not tank locations)`
          : `No septic parcels within ${septicRadiusFeet} ft in SCWS data`,
      });
    } catch (error) {
      sources.push({
        name: 'Nearby septic parcels',
        status: 'error',
        message: error instanceof Error ? error.message : 'Septic parcel query failed',
      });
    }
  }

  if (result.parcel?.zoning || result.parcel?.landUse) {
    result.zoning = {
      designation: result.parcel.zoning,
      landUse: result.parcel.landUse,
      source: 'County Assessor GIS',
      note: 'Verify with the local planning department before relying on this for a submittal.',
    };
    sources.push({ name: 'Zoning', status: 'success' });
  } else {
    sources.push({ name: 'Zoning', status: 'missing', message: 'Not published on this parcel layer' });
  }

  result.sources = sources;
  return result;
}
