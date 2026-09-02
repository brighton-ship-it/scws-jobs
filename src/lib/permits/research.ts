import {
  hasLarc009777,
  largestOnParcelDwelling,
  LARC_009777_FILE_RECORD_ID,
  LARC_009777_SOURCE,
  markDocsExtracted,
  traceLarc009777,
} from './as-built.ts';
import { detectCounty, isCounty } from './county.ts';
import { asBuiltOnFile, fileRecordIds, searchDehDocuments } from './deh-docs.ts';
import {
  centroidFromRings,
  expandBboxFeet,
  fetchNearbyStructures,
  fetchParcelForCounty,
  fetchParcelsInEnvelope,
  fetchRoadLabels,
  fetchWwSepticFlags,
  geocodeAddress,
  haversineFeet,
  minDistanceToPolygonsFt,
  minRingsDistanceFt,
  ringBBox,
} from './gis.ts';
import { placeProposedWell, septicGeometryFromKnown, wellsAsPoints } from './place-well.ts';
import type {
  County,
  DataSource,
  DehDocument,
  NeighborParcel,
  ResearchResult,
  SepticInfo,
  SepticPermit,
} from './types.ts';
import { ADJACENT_GAP_FT, INVENTORY_RADIUS_FT, NEIGHBOR_ENVELOPE_FT } from './types.ts';
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
    message: `No septic/sewer record in public GIS for this parcel. Tank and leach-field locations were not invented. Confirm with ${phone} before drawing setbacks on a submittal.`,
  };
}

function designationType(text?: string | null): SepticInfo['type'] {
  const value = (text || '').toLowerCase();
  if (value.includes('septic')) return 'SEPTIC';
  if (value.includes('sewer')) return 'SEWER';
  return 'UNKNOWN';
}

function neighborTankLeach(flag: string | undefined, docs: DehDocument[]): NeighborParcel['tankLeach'] {
  if (docs.some((d) => d.isAsBuiltCandidate && d.geometryExtracted)) return 'as_built_extracted';
  if (docs.some((d) => d.isAsBuiltCandidate)) return 'as_built_on_file';
  if ((flag || '').toLowerCase().includes('septic')) return 'septic_connected';
  return 'unknown';
}

/**
 * Trace FileRecordId 36954960 (LARC_009777_1) onto county GIS for APN 129-092-71-00 only.
 * Neighbor as-builts stay listed as on-file until their FileRecordIds are wired.
 */
function applyKnownAsBuiltOverlay(
  result: ResearchResult,
  dehDocs: DehDocument[],
  notes: string[],
  sources: DataSource[]
): boolean {
  const apn = result.parcel?.apn;
  if (!hasLarc009777(apn, dehDocs)) return false;
  const dwelling = largestOnParcelDwelling(result.structures);
  const parcelRing = result.parcel?.geometry?.rings?.[0];
  if (!dwelling?.rings?.[0] || !parcelRing) return false;
  const overlay = traceLarc009777({ parcelRing, dwellingRing: dwelling.rings[0] });
  if (!overlay) return false;

  const docs = markDocsExtracted(dehDocs);
  result.dehDocuments = docs;
  result.septic = {
    ...(result.septic || { status: 'found', type: 'SEPTIC' }),
    status: 'found',
    type: result.septic?.type || 'SEPTIC',
    designation: result.septic?.designation || 'Known Septic Connected',
    locationUnknown: false,
    geometry: overlay.geometry,
    dehDocuments: docs,
    source: LARC_009777_SOURCE,
    message:
      `DEH as-built FileRecordId ${LARC_009777_FILE_RECORD_ID} (LARC_009777_1) traced onto county GIS parcel + dwelling. Tank/leach were not invented.`,
  };

  notes.push(
    `DEH as-built FileRecordId ${LARC_009777_FILE_RECORD_ID} (LARC_009777_1) traced onto county GIS — tank, leach, existing well W61895, and the 40 ft west easement are from that sheet, not a typical-layout guess.`
  );

  const dehSrc = sources.find((s) => s.name === 'DEH Document Library');
  if (dehSrc) {
    dehSrc.message = `${dehDocs.length} DEH-LWQD hit(s); FileRecordId ${LARC_009777_FILE_RECORD_ID} (LARC_009777_1) traced onto GIS`;
  }
  return true;
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
    proposedWell: null,
    dehDocuments: [],
    neighbors: [],
    roads: [],
    wellsWithin250Ft: 0,
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

  // Center inventory queries on the parcel interior when we have a ring; keep the geocode if not.
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
        name: 'CA DWR / CNRA Well Completion Reports',
        status: 'success',
        message: `Found ${result.wells.length} wells within 1 mile`,
      });
    } catch (error) {
      sources.push({
        name: 'CA DWR / CNRA Well Completion Reports',
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'DWR/CNRA query failed — well locations were not invented',
      });
      notes.push(
        'CA DWR / CNRA Well Completion Reports are unavailable or returned an error. Nearby well points were not invented.'
      );
    }
  } else {
    sources.push({
      name: 'CA DWR / CNRA Well Completion Reports',
      status: 'missing',
      message: 'Need a geocoded point or parcel to search wells',
    });
  }

  if (county === 'san_diego' && searchLat != null && searchLng != null) {
    try {
      result.structures = await fetchNearbyStructures(
        searchLat,
        searchLng,
        fetchImpl,
        result.parcel?.geometry?.rings?.[0]
      );
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

  let dehDocs: DehDocument[] = [];
  if (county === 'san_diego' && (result.parcel?.apn || input.apn)) {
    try {
      dehDocs = await searchDehDocuments(result.parcel?.apn || input.apn || '', fetchImpl);
      result.dehDocuments = dehDocs;
      const asBuilts = asBuiltOnFile(dehDocs);
      sources.push({
        name: 'DEH Document Library',
        status: dehDocs.length ? 'success' : 'missing',
        message: dehDocs.length
          ? `${dehDocs.length} DEH-LWQD hit(s)` +
            (asBuilts.length
              ? `; ${asBuilts.map((d) => `FileRecordId ${d.fileRecordId} (${d.subcategory})`).join('; ')} — as-built on file, geometry not extracted`
              : '')
          : 'No DEH-LWQD documents for this APN',
      });
      if (asBuilts.length && !hasLarc009777(result.parcel?.apn || input.apn, dehDocs)) {
        notes.push(
          `DEH as-built on file (${asBuilts.map((d) => `FileRecordId ${d.fileRecordId}`).join(', ')}); tank/leach geometry was not extracted. LUEG_View PDF is client-side only.`
        );
      }
    } catch (error) {
      sources.push({
        name: 'DEH Document Library',
        status: 'error',
        message: error instanceof Error ? error.message : 'DEH search failed',
      });
    }
  }

  let wwFlags: Awaited<ReturnType<typeof fetchWwSepticFlags>> = [];
  if (county === 'san_diego' && result.parcel?.geometry?.rings?.[0]) {
    try {
      const bbox = expandBboxFeet(ringBBox(result.parcel.geometry.rings[0]), NEIGHBOR_ENVELOPE_FT);
      wwFlags = await fetchWwSepticFlags({ bbox }, fetchImpl);
      const site = wwFlags.find((f) => f.apn === result.parcel?.apn);
      sources.push({
        name: 'WW_SEPTIC_SEWER_PUBLIC',
        status: site ? 'success' : wwFlags.length ? 'success' : 'missing',
        message: site
          ? `${site.designation} (parcel flag only — not tank/leach polygons)`
          : wwFlags.length
            ? `${wwFlags.length} nearby parcel flags (not tank GPS)`
            : 'No septic/sewer parcel flag in the public layer',
      });
    } catch (error) {
      sources.push({
        name: 'WW_SEPTIC_SEWER_PUBLIC',
        status: 'error',
        message: error instanceof Error ? error.message : 'Septic flag query failed',
      });
    }
  }

  const siteFlag = wwFlags.find((f) => f.apn === result.parcel?.apn);
  if (siteFlag) {
    result.septic = {
      status: 'found',
      type: designationType(siteFlag.designation),
      designation: siteFlag.designation,
      source: 'WW_SEPTIC_SEWER_PUBLIC (parcel flag, not tank/leach geometry)',
      locationUnknown: true,
      dehDocuments: dehDocs,
      message: asBuiltOnFile(dehDocs).length
        ? `${siteFlag.designation}. DEH as-built on file; geometry not extracted — tank/leach were not drawn.`
        : `${siteFlag.designation}. No tank/leach polygons in public GIS.`,
    };
  } else if (deps.lookupSiteSeptic) {
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
          dehDocuments: dehDocs,
        };
        sources.push({
          name: 'Septic / sewer record',
          status: 'success',
          message: `Property is on ${site.type}${site.locationUnknown ? ' (tank location not in GIS)' : ''}`,
        });
      } else {
        result.septic = { ...missingSeptic(county), dehDocuments: dehDocs };
        sources.push({
          name: 'Septic / sewer record',
          status: 'missing',
          message: result.septic.message,
        });
      }
    } catch {
      result.septic = { ...missingSeptic(county), dehDocuments: dehDocs };
      sources.push({
        name: 'Septic / sewer record',
        status: 'missing',
        message: result.septic.message,
      });
    }
  } else {
    result.septic = { ...missingSeptic(county), dehDocuments: dehDocs };
    if (county !== 'san_diego' || !siteFlag) {
      sources.push({
        name: 'Septic / sewer record',
        status: dehDocs.length ? 'success' : 'missing',
        message: dehDocs.length
          ? 'DEH documents listed; tank/leach geometry not extracted'
          : result.septic.message,
      });
    }
  }

  notes.push(
    'Streets and easements come from public road labels when present. Surveyed tank/leach geometry is drawn only from a parsed DEH as-built — never invented.'
  );

  const overlayApplied = applyKnownAsBuiltOverlay(result, dehDocs, notes, sources);

  const known = septicGeometryFromKnown(result.septic?.geometry);
  // As-built existing well (W61895) drives maximin. CNRA wells far off-parcel do not.
  const onParcelWells = result.wells.filter((w) => (w.distance_from_parcel || 9999) <= 80);
  result.proposedWell = placeProposedWell({
    rings: result.parcel?.geometry?.rings,
    county,
    tanks: known.tanks,
    leaches: known.leaches,
    existingWells: [...(known.existingWells || []), ...wellsAsPoints(onParcelWells)],
    structures: (result.structures || []).filter((s) => s.onSubjectParcel !== false),
    easements: known.easements,
  });

  if (result.proposedWell) {
    if (!known.tanks?.length && !known.leaches?.length && !overlayApplied) {
      result.proposedWell.flags.push(
        'Septic tank/leach setbacks not applied — no extracted as-built geometry. Confirm DEH archive before staking.'
      );
    }
    if (!result.proposedWell.meetsSetbacks) {
      notes.push(`Proposed-well pin is a best pocket with flagged setbacks: ${result.proposedWell.flags.join('; ')}`);
    } else {
      notes.push(
        `Proposed-well pin placed by setback search at ${result.proposedWell.lat.toFixed(8)}, ${result.proposedWell.lng.toFixed(8)} — not the parcel centroid.`
      );
    }
  } else if (centroid) {
    notes.push('Could not place a proposed-well pin inside the parcel. Centroid was not used as a silent fallback.');
  }

  const pin = result.proposedWell || (searchLat != null && searchLng != null ? { lat: searchLat, lng: searchLng } : null);
  result.wellsWithin250Ft = pin
    ? result.wells.filter(
        (w) => haversineFeet(pin.lat, pin.lng, w.latitude, w.longitude) <= INVENTORY_RADIUS_FT
      ).length
    : 0;
  sources.push({
    name: `CNRA WCR within ${INVENTORY_RADIUS_FT} ft`,
    status: 'success',
    message:
      result.wellsWithin250Ft === 0
        ? `0 (NONE) within ${INVENTORY_RADIUS_FT} ft of the proposed pin`
        : `${result.wellsWithin250Ft} well(s) within ${INVENTORY_RADIUS_FT} ft`,
  });

  if (county === 'san_diego' && result.parcel?.geometry?.rings?.[0]) {
    try {
      const subjectRing = result.parcel.geometry.rings[0];
      const bbox = expandBboxFeet(ringBBox(subjectRing), NEIGHBOR_ENVELOPE_FT);
      const nearbyParcels = await fetchParcelsInEnvelope(bbox, fetchImpl);
      const pinPt = result.proposedWell;
      const candidates: NeighborParcel[] = [];
      for (const parcel of nearbyParcels) {
        if (parcel.apn === result.parcel.apn) continue;
        const nRing = parcel.geometry?.rings?.[0];
        const ringDist = minRingsDistanceFt(subjectRing, nRing);
        const fromPin =
          pinPt && nRing
            ? Math.round(minDistanceToPolygonsFt(pinPt.lat, pinPt.lng, parcel.geometry!.rings))
            : undefined;
        const adjacent = ringDist <= ADJACENT_GAP_FT;
        const within250 = fromPin != null && fromPin <= INVENTORY_RADIUS_FT;
        const inNeighborhood = ringDist <= NEIGHBOR_ENVELOPE_FT;
        if (!adjacent && !within250 && !inNeighborhood) continue;
        const flag = wwFlags.find((f) => f.apn === parcel.apn);
        candidates.push({
          apn: parcel.apn,
          siteAddress: parcel.siteAddress,
          septicFlag: flag?.designation,
          system: designationType(flag?.designation),
          dehDocuments: [],
          tankLeach: neighborTankLeach(flag?.designation, []),
          distanceFt: fromPin,
          adjacent,
        });
      }
      candidates.sort((a, b) => {
        const da = a.distanceFt ?? (a.adjacent ? 0 : 9e9);
        const db = b.distanceFt ?? (b.adjacent ? 0 : 9e9);
        return da - db;
      });
      const toSearch = candidates.slice(0, 12);
      const docsByApn = await Promise.all(
        toSearch.map(async (n) => {
          try {
            return { apn: n.apn, docs: await searchDehDocuments(n.apn, fetchImpl) };
          } catch {
            return { apn: n.apn, docs: [] as DehDocument[] };
          }
        })
      );
      const docMap = new Map(docsByApn.map((row) => [row.apn, row.docs]));
      result.neighbors = toSearch
        .map((n) => {
          const docs = docMap.get(n.apn) || [];
          return {
            ...n,
            dehDocuments: docs,
            tankLeach: neighborTankLeach(n.septicFlag, docs),
            system: n.system === 'UNKNOWN' && (n.septicFlag || '').toLowerCase().includes('septic')
              ? 'SEPTIC'
              : n.system,
          };
        })
        .filter((n) => n.adjacent || (n.distanceFt != null && n.distanceFt <= INVENTORY_RADIUS_FT) || n.dehDocuments.length > 0);
      result.septicPermits = result.neighbors.map((n) => {
        const flag = wwFlags.find((f) => f.apn === n.apn);
        return {
          apn: n.apn,
          designation: n.septicFlag || n.system,
          type: n.system,
          latitude: flag?.lat || 0,
          longitude: flag?.lng || 0,
          full_address: n.siteAddress,
          distance_feet: n.distanceFt,
          locationKind: 'parcel_flag' as const,
        };
      }).filter((p) => p.latitude && p.longitude);
      const listedIds = result.neighbors.flatMap((n) => fileRecordIds(n.dehDocuments));
      const septicCount = result.neighbors.filter((n) => n.system === 'SEPTIC').length;
      const sewerCount = result.neighbors.filter((n) => n.system === 'SEWER').length;
      sources.push({
        name: 'Neighbor parcels',
        status: result.neighbors.length ? 'success' : 'missing',
        message: result.neighbors.length
          ? `${result.neighbors.length} neighbor(s) (${septicCount} septic / ${sewerCount} sewer / WW_SEPTIC flag only). FileRecordIds: ${listedIds.join(', ') || 'none'}. Tank/leach drawn only after a parsed as-built PDF — none extracted.`
          : `No neighbor parcels within ${NEIGHBOR_ENVELOPE_FT} ft`,
      });
      notes.push(
        'Neighbor tank/leach were not invented. WW_SEPTIC is a septic-vs-sewer flag. DEH FileRecordIds are listed; geometry waits on a parsed as-built PDF.'
      );
      try {
        result.roads = await fetchRoadLabels(bbox, fetchImpl);
      } catch {
        result.roads = [];
      }
    } catch (error) {
      sources.push({
        name: 'Neighbor parcels',
        status: 'error',
        message: error instanceof Error ? error.message : 'Neighbor parcel query failed',
      });
    }
  }

  const septicRadiusFeet = input.septicRadiusFeet || 500;
  if (deps.lookupNearbySeptic && searchLat != null && searchLng != null && !result.septicPermits.length) {
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
