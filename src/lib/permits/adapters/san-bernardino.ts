import {
  fetchNearbyStructures,
  fetchParcelsInEnvelope,
  fetchRoadLabels,
  fetchSanBernardinoParcel,
} from '../gis.ts';
import { COUNTY_SETBACKS } from '../types.ts';
import type { CountyAdapter } from './types.ts';

export const sanBernardinoAdapter: CountyAdapter = {
  id: 'san_bernardino',
  label: 'San Bernardino County',
  gisName: 'San Bernardino County parcels (ArcGIS Online)',
  setbacks: COUNTY_SETBACKS.san_bernardino,
  portals: [
    {
      label: 'Assessor property info',
      url: 'https://arcpropertyinfo.sbcounty.gov/',
      purpose: 'Parcel / owner (owner often redacted per CA Gov Code 7928.205)',
    },
    {
      label: 'EHS — Land Use and Wastewater',
      url: 'https://ehs.sbcounty.gov/programs/waste/',
      purpose: 'OWTS / septic records',
    },
    {
      label: 'EHS — Safe drinking water / wells',
      url: 'https://ehs.sbcounty.gov/programs/safe-drinking-water/',
      purpose: 'Well permits',
    },
    {
      label: 'Official well permit application (blank PDF)',
      url: 'https://ehs.sbcounty.gov/wp-content/uploads/sites/97/Programs/WaterAndWaste/well-permit-application.pdf',
      purpose: 'Do not invent a form — this is the county blank',
    },
  ],
  permitFormPath: 'public/forms/san-bernardino-well-permit.pdf',
  permitFormUrl:
    'https://ehs.sbcounty.gov/wp-content/uploads/sites/97/Programs/WaterAndWaste/well-permit-application.pdf',
  asBuiltBlocker:
    'FLAG: septic as-built not found — do not invent. San Bernardino has no public tank/leach geometry API. Open ehs.sbcounty.gov (Land Use and Wastewater) and the assessor map. Parcel + aerial + buildings-if-any + DWR wells + setback circles still emit.',
  fetchParcel: (input) => fetchSanBernardinoParcel(input),
  fetchParcelsInEnvelope: (bbox, fetchImpl) =>
    fetchParcelsInEnvelope(bbox, fetchImpl, 'san_bernardino'),
  fetchBuildings: (lat, lng, fetchImpl, parcelRing) =>
    fetchNearbyStructures(lat, lng, fetchImpl, parcelRing, 'san_bernardino'),
  fetchRoads: (bbox, fetchImpl) => fetchRoadLabels(bbox, fetchImpl, 'san_bernardino'),
  fetchSepticFlags: async () => [],
  fetchCountyWells: async () => [],
  searchAsBuilts: async () => [],
};
