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
}

export interface SepticPermit {
  apn: string;
  designation: string;
  type: 'SEPTIC' | 'SEWER' | 'UNKNOWN';
  latitude: number;
  longitude: number;
  full_address?: string;
  distance_feet?: number;
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

export const SEPTIC_SETBACK_FT = 100;
export const STRUCTURE_SETBACK_FT = 50;
export const WELL_SEARCH_RADIUS_FT = 5280;
/** Wells / septic / structures called out on the plot plan (feet). */
export const INVENTORY_RADIUS_FT = 250;

export interface StructureFootprint {
  rings: number[][][];
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
}
