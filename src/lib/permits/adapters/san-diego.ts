import { asBuiltOnFile, searchDehDocuments } from '../deh-docs.ts';
import {
  fetchNearbyStructures,
  fetchParcelsInEnvelope,
  fetchRoadLabels,
  fetchSanDiegoParcel,
  fetchWwSepticFlags,
} from '../gis.ts';
import { COUNTY_SETBACKS } from '../types.ts';
import type { CountyAdapter } from './types.ts';

export const sanDiegoAdapter: CountyAdapter = {
  id: 'san_diego',
  label: 'San Diego County',
  gisName: 'San Diego County GIS',
  setbacks: COUNTY_SETBACKS.san_diego,
  portals: [
    {
      label: 'DEH Land Use / document library',
      url: 'https://file.sandiegocounty.gov/LUEG/LUEG_View',
      purpose: 'As-built PDFs (OutSystems viewer — not a curl-able file)',
    },
    {
      label: 'DEH Land and Water Quality — wells',
      url: 'https://www.sandiegocounty.gov/content/sdc/deh/lwqd.html',
      purpose: 'Well permits',
    },
  ],
  permitFormPath: 'public/forms/san-diego-well-permit.pdf',
  permitFormUrl:
    'https://www.sandiegocounty.gov/content/dam/sdc/deh/lwqd/Water%20Well%20Application.pdf',
  asBuiltBlocker: null,
  fetchParcel: (input) => fetchSanDiegoParcel(input),
  fetchParcelsInEnvelope: (bbox, fetchImpl) => fetchParcelsInEnvelope(bbox, fetchImpl, 'san_diego'),
  fetchBuildings: (lat, lng, fetchImpl, parcelRing) =>
    fetchNearbyStructures(lat, lng, fetchImpl, parcelRing, 'san_diego'),
  fetchRoads: (bbox, fetchImpl) => fetchRoadLabels(bbox, fetchImpl, 'san_diego'),
  fetchSepticFlags: async (bbox, fetchImpl) => fetchWwSepticFlags({ bbox }, fetchImpl),
  fetchCountyWells: async () => [],
  searchAsBuilts: async (apn, fetchImpl) => {
    const docs = await searchDehDocuments(apn, fetchImpl);
    return asBuiltOnFile(docs).length ? docs : docs;
  },
};
