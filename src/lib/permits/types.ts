export type County = 'san_diego' | 'riverside' | 'san_bernardino';

export type SourceStatus = 'success' | 'error' | 'missing';

export interface ParcelInfo {
  apn: string;
  ownerName?: string;
  ownerAddress?: string;
  siteAddress?: string;
  lotSizeAcres?: number;
  lotSizeSqFt?: number;
  geometry?: { rings: number[][][]; spatialReference?: { wkid: number } };
  landUse?: string;
  zoning?: string;
}

export interface WellInfo {
  wcr_number: string;
  date_work_ended?: string;
  total_completed_depth?: number;
  top_of_perforations?: number;
  bottom_of_perforations?: number;
  static_water_level?: number;
  well_use?: string;
  latitude: number;
  longitude: number;
  distance_from_parcel?: number;
  apn?: string;
  source?: string;
}

export interface SepticPermit {
  apn: string;
  designation: string;
  type: 'SEPTIC' | 'SEWER' | 'UNKNOWN';
  latitude: number;
  longitude: number;
  full_address?: string;
  distance_feet?: number;
  /** Parcel flag only — never treat as tank/leach GPS. */
  locationKind?: 'parcel_flag' | 'as_built';
}

export interface DehDocument {
  fileRecordId: string;
  permitId?: string;
  parcelNbr?: string;
  category?: string;
  subcategory?: string;
  description?: string;
  contentType?: string;
  viewUrl: string;
  /** True only after a known DEH as-built is traced onto county GIS — never guessed. */
  geometryExtracted: boolean;
  note: string;
  isAsBuiltCandidate: boolean;
}

export interface SepticGeometry {
  kind: 'tank' | 'leach' | 'existing_well' | 'easement';
  rings?: number[][][];
  lat?: number;
  lng?: number;
  label?: string;
  source: string;
}

export interface SepticInfo {
  status: 'found' | 'missing';
  type?: 'SEPTIC' | 'SEWER' | 'UNKNOWN';
  designation?: string;
  source?: string;
  latitude?: number;
  longitude?: number;
  message?: string;
  /** True when we only know the parcel is on septic, not the tank/leach location. */
  locationUnknown?: boolean;
  dehDocuments?: DehDocument[];
  geometry?: SepticGeometry[];
}

export interface NeighborParcel {
  apn: string;
  siteAddress?: string;
  septicFlag?: string;
  /** WW_SEPTIC flag only — never guessed from a typical layout. */
  system: 'SEPTIC' | 'SEWER' | 'UNKNOWN';
  dehDocuments: DehDocument[];
  tankLeach: 'as_built_extracted' | 'as_built_on_file' | 'septic_connected' | 'unknown';
  /** Proposed-well pin to nearest neighbor ring (ft). */
  distanceFt?: number;
  adjacent?: boolean;
}

export interface ProposedWell {
  lat: number;
  lng: number;
  source: 'setback_search' | 'best_pocket';
  meetsSetbacks: boolean;
  flags: string[];
  distances: {
    propertyLineFt: number | null;
    tankFt: number | null;
    leachFt: number | null;
    existingWellFt: number | null;
    structureFt: number | null;
  };
  wgs84: { lat: number; lng: number };
}

export interface DataSource {
  name: string;
  status: SourceStatus;
  message?: string;
}

export const COUNTY_LABEL: Record<County, string> = {
  san_diego: 'San Diego County',
  riverside: 'Riverside County',
  san_bernardino: 'San Bernardino County',
};

/** Property-line setback used on DEH plot plans, in feet. */
export const PROPERTY_LINE_SETBACK_FT: Record<County, number> = {
  san_diego: 10,
  riverside: 50,
  san_bernardino: 20,
};

export const TANK_SETBACK_FT = 50;
export const LEACH_SETBACK_FT = 100;
export const EXISTING_WELL_SETBACK_FT = 100;
export const SEPTIC_SETBACK_FT = 100;
/** Typical DEH well-to-structure setback (shown on plans). Placement uses BUILDING_CLEAR_FT. */
export const STRUCTURE_SETBACK_FT = 50;
/** Grid placement: stay this far off BUILDING_OUTLINES (NW house-to-PL strips are tighter than 100 ft). */
export const BUILDING_CLEAR_FT = 8;
export const WELL_SEARCH_RADIUS_FT = 5280;
/** Wells / septic / structures called out on the plot plan (feet). */
export const INVENTORY_RADIUS_FT = 250;
/** Envelope used to find abutters on ~400 ft-wide lots (centroid-to-centroid 220 ft misses the west lot). */
export const NEIGHBOR_ENVELOPE_FT = 600;
/** Rings this close are treated as sharing a property line. */
export const ADJACENT_GAP_FT = 40;

export const SCWS_CSLB = '1086994';
export const BLOCKED_CSLB = ['1059498', '1129498', '1013597', '1011552'] as const;

export interface StructureFootprint {
  rings: number[][][];
  areaSqFt?: number;
  onSubjectParcel?: boolean;
}

export interface RoadLabel {
  name: string;
  lat: number;
  lng: number;
}

export interface ResearchResult {
  parcel: ParcelInfo | null;
  wells: WellInfo[];
  septic: SepticInfo | null;
  septicPermits: SepticPermit[];
  zoning: { designation?: string; landUse?: string; source?: string; note?: string } | null;
  sources: DataSource[];
  county: County;
  searchPoint: { lat: number; lng: number } | null;
  formattedAddress?: string;
  notes: string[];
  cached?: boolean;
  structures: StructureFootprint[];
  proposedWell?: ProposedWell | null;
  dehDocuments?: DehDocument[];
  neighbors?: NeighborParcel[];
  roads?: RoadLabel[];
  wellsWithin250Ft?: number;
}
