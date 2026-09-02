import {
  fetchParcelsInEnvelope,
  fetchRivSepticFlags,
  fetchRivWellPermits,
  fetchRoadLabels,
  fetchRiversideParcel,
} from '../gis.ts';
import { COUNTY_SETBACKS } from '../types.ts';
import type { CountyAdapter } from './types.ts';

export const riversideAdapter: CountyAdapter = {
  id: 'riverside',
  label: 'Riverside County',
  gisName: 'Riverside County MMC GIS (Parcels, Public)',
  setbacks: COUNTY_SETBACKS.riverside,
  portals: [
    {
      label: 'Map My County (parcel report → Building and Safety Cases)',
      url: 'https://gis1.countyofriverside.us/Html5Viewer/index.html?viewer=MMC_Public',
      purpose: 'Septic sketches are often on the dwelling / mobile-home site-prep permit — not a DEH polygon',
    },
    {
      label: 'Find a well map (DEH)',
      url: 'https://countyofriverside.maps.arcgis.com/apps/webappviewer/index.html?id=52a006e2361d4819bc0dc711b53f5533',
      purpose: 'Archived well records',
    },
    {
      label: 'Riverside DEH wells program',
      url: 'https://rivcoeh.org/wells',
      purpose: 'Well permits / Ordinance 682',
    },
    {
      label: 'Land Use Permit Lookup',
      url: 'https://rivcoeh.org/gisrecord-research',
      purpose: 'Septic + wells + small water (no public as-built geometry API)',
    },
    {
      label: 'TLMA records request',
      url: 'https://building.rctlma.org/records-request',
      purpose: 'Building/septic sketches',
    },
  ],
  permitFormPath: 'public/forms/riverside-well-permit.pdf',
  permitFormUrl: 'https://rivcoeh.org/wells',
  asBuiltBlocker:
    'FLAG: septic as-built not found as drawable geometry. Riverside publishes OWTS permit POINTS (MMC layer 30) and well-permit POINTS (layer 33), not tank/leach polygons. Open Map My County → parcel report → Building and Safety Cases, plus rivcoeh.org Land Use Permit Lookup. Do not invent tanks.',
  fetchParcel: (input) => fetchRiversideParcel(input),
  fetchParcelsInEnvelope: (bbox, fetchImpl) => fetchParcelsInEnvelope(bbox, fetchImpl, 'riverside'),
  fetchBuildings: async () => [],
  fetchRoads: (bbox, fetchImpl) => fetchRoadLabels(bbox, fetchImpl, 'riverside'),
  fetchSepticFlags: (bbox, fetchImpl) => fetchRivSepticFlags(bbox, fetchImpl),
  fetchCountyWells: (bbox, fetchImpl) => fetchRivWellPermits(bbox, fetchImpl),
  searchAsBuilts: async () => [],
};
