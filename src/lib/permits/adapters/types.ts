import type {
  County,
  CountyPortal,
  CountySetbacks,
  CountyWellPermit,
  DehDocument,
  ParcelInfo,
  RoadLabel,
  StructureFootprint,
} from '../types.ts';
import type { WwSepticFlag } from '../gis.ts';

export interface ParcelQuery {
  apn?: string;
  address?: string;
  lat?: number;
  lng?: number;
  fetchImpl?: typeof fetch;
}

export interface CountyAdapter {
  id: County;
  label: string;
  gisName: string;
  setbacks: CountySetbacks;
  portals: CountyPortal[];
  permitFormPath: string | null;
  permitFormUrl: string | null;
  asBuiltBlocker: string | null;
  fetchParcel(input: ParcelQuery): Promise<ParcelInfo | null>;
  fetchParcelsInEnvelope(
    bbox: { minX: number; minY: number; maxX: number; maxY: number },
    fetchImpl?: typeof fetch
  ): Promise<ParcelInfo[]>;
  fetchBuildings(
    lat: number,
    lng: number,
    fetchImpl?: typeof fetch,
    parcelRing?: number[][]
  ): Promise<StructureFootprint[]>;
  fetchRoads(
    bbox: { minX: number; minY: number; maxX: number; maxY: number },
    fetchImpl?: typeof fetch
  ): Promise<RoadLabel[]>;
  fetchSepticFlags(
    bbox: { minX: number; minY: number; maxX: number; maxY: number },
    fetchImpl?: typeof fetch
  ): Promise<WwSepticFlag[]>;
  fetchCountyWells(
    bbox: { minX: number; minY: number; maxX: number; maxY: number },
    fetchImpl?: typeof fetch
  ): Promise<CountyWellPermit[]>;
  searchAsBuilts(apn: string, fetchImpl?: typeof fetch): Promise<DehDocument[]>;
}
