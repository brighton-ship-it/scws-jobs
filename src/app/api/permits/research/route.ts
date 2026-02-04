import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GIS Service endpoints
const GIS_ENDPOINTS = {
  san_diego: {
    parcels: 'https://gis-public.sandiegocounty.gov/arcgis/rest/services/sdep_warehouse/PARCELS_ALL/MapServer/0',
    assessor: 'https://gis-public.sandiegocounty.gov/arcgis/rest/services/sdep_warehouse/PARCELS_ALL/MapServer/0',
  },
  riverside: {
    parcels: 'https://content.rcflood.org/arcgis/rest/services/FacilitiesAndProperties/DynamicLayerEP/MapServer/5',
  },
  dwr_wells: 'https://gis.water.ca.gov/arcgis/rest/services/Environment/i07_WellCompletionReports/FeatureServer/0',
};

interface ParcelInfo {
  apn: string;
  ownerName?: string;
  ownerAddress?: string;
  siteAddress?: string;
  lotSizeAcres?: number;
  lotSizeSqFt?: number;
  geometry?: any;
  landUse?: string;
  zoning?: string;
}

interface WellInfo {
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
}

interface SepticInfo {
  status: 'found' | 'mock';
  type?: 'SEPTIC' | 'SEWER' | 'UNKNOWN';
  designation?: string;
  source?: string;
  latitude?: number;
  longitude?: number;
  message?: string;
  info?: any;
}

interface ResearchResult {
  parcel: ParcelInfo | null;
  wells: WellInfo[];
  septic: SepticInfo | null;
  septicPermits: SepticPermit[]; // Nearby septic parcels for mapping
  zoning: any | null;
  sources: { name: string; status: 'success' | 'error' | 'mock'; message?: string }[];
}

/**
 * Query ArcGIS REST API with proper error handling
 */
async function queryArcGIS(url: string, params: Record<string, string>): Promise<any> {
  const searchParams = new URLSearchParams({
    f: 'json',
    ...params,
  });

  const response = await fetch(`${url}/query?${searchParams.toString()}`, {
    headers: { 'Accept': 'application/json' },
    next: { revalidate: 3600 }, // Cache for 1 hour
  });

  if (!response.ok) {
    throw new Error(`ArcGIS query failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch parcel data from San Diego County GIS
 */
async function fetchSanDiegoParcel(apn: string): Promise<ParcelInfo | null> {
  try {
    // Format APN for query (remove dashes, 10 chars with leading zeros)
    const cleanApn = apn.replace(/-/g, '').padStart(10, '0');
    
    const result = await queryArcGIS(GIS_ENDPOINTS.san_diego.parcels, {
      where: `APN = '${cleanApn}'`,
      outFields: 'APN,OWN_NAME1,OWN_NAME2,OWN_ADDR1,OWN_ADDR2,SITUS_ADDRESS,SITUS_STREET,SITUS_SUFFIX,SITUS_COMMUNITY,SITUS_ZIP,ACREAGE,NUCLEUS_USE_CD,NUCLEUS_ZONE_CD',
      returnGeometry: 'true',
      outSR: '4326',
    });

    if (result.features && result.features.length > 0) {
      const feature = result.features[0];
      const attrs = feature.attributes;
      
      // Format APN with dashes (XXX-XXX-XX-XX)
      const rawApn = attrs.APN || '';
      const formattedApn = rawApn.length === 10 
        ? `${rawApn.slice(0,3)}-${rawApn.slice(3,6)}-${rawApn.slice(6,8)}-${rawApn.slice(8,10)}`
        : rawApn;
      
      // Build site address
      const siteAddr = [
        attrs.SITUS_ADDRESS,
        attrs.SITUS_STREET,
        attrs.SITUS_SUFFIX,
      ].filter(Boolean).join(' ');
      
      return {
        apn: formattedApn,
        ownerName: [attrs.OWN_NAME1, attrs.OWN_NAME2].filter(Boolean).join(' '),
        ownerAddress: [attrs.OWN_ADDR1, attrs.OWN_ADDR2].filter(Boolean).join(', '),
        siteAddress: [siteAddr, attrs.SITUS_COMMUNITY, attrs.SITUS_ZIP].filter(Boolean).join(', '),
        lotSizeAcres: attrs.ACREAGE,
        lotSizeSqFt: attrs.ACREAGE ? Math.round(attrs.ACREAGE * 43560) : undefined,
        geometry: feature.geometry,
        landUse: attrs.NUCLEUS_USE_CD,
        zoning: attrs.NUCLEUS_ZONE_CD,
      };
    }
    
    return null;
  } catch (error) {
    console.error('San Diego parcel fetch error:', error);
    throw error;
  }
}

/**
 * Fetch parcel data from Riverside County GIS
 */
async function fetchRiversideParcel(apn: string): Promise<ParcelInfo | null> {
  try {
    // Format APN for query
    const cleanApn = apn.replace(/-/g, '');
    
    const result = await queryArcGIS(GIS_ENDPOINTS.riverside.parcels, {
      where: `APN = '${cleanApn}' OR APN LIKE '%${cleanApn}%'`,
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
    });

    if (result.features && result.features.length > 0) {
      const feature = result.features[0];
      const attrs = feature.attributes;
      
      return {
        apn: attrs.APN,
        ownerName: attrs.OWNERNAME || attrs.OWNER_NAME,
        ownerAddress: attrs.OWNERADDR || attrs.OWNER_ADDR,
        siteAddress: attrs.SITEADDR || attrs.SITE_ADDRESS,
        lotSizeAcres: attrs.ACRES || attrs.ACREAGE,
        lotSizeSqFt: attrs.SQ_FEET || attrs.SHAPE_Area,
        geometry: feature.geometry,
        landUse: attrs.LANDUSE || attrs.LAND_USE,
        zoning: attrs.ZONING,
      };
    }
    
    return null;
  } catch (error) {
    console.error('Riverside parcel fetch error:', error);
    throw error;
  }
}

/**
 * Fetch wells from DWR Well Completion Reports
 * Uses envelope (bounding box) query in WGS84 for reliable results
 */
async function fetchDWRWells(lat: number, lng: number, radiusMeters: number = 1609): Promise<WellInfo[]> {
  try {
    // Convert radius from meters to approximate degrees
    // At ~33° latitude: 1 degree ≈ 111km lat, ~93km lng
    const latDegPerMeter = 1 / 111000;
    const lngDegPerMeter = 1 / (111000 * Math.cos(lat * Math.PI / 180));
    
    const latOffset = radiusMeters * latDegPerMeter;
    const lngOffset = radiusMeters * lngDegPerMeter;
    
    // Create bounding box envelope in WGS84
    const envelope = {
      xmin: lng - lngOffset,
      ymin: lat - latOffset,
      xmax: lng + lngOffset,
      ymax: lat + latOffset,
      spatialReference: { wkid: 4326 }
    };
    
    console.log('DWR wells query envelope:', envelope);
    
    const result = await queryArcGIS(GIS_ENDPOINTS.dwr_wells, {
      geometry: JSON.stringify(envelope),
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'WCRNumber,DateWorkEnded,TotalCompletedDepth,TopOfPerforatedInterval,BottomofPerforatedInterval,StaticWaterLevel,PlannedUseFormerUse,DecimalLatitude,DecimalLongitude',
      returnGeometry: 'false',
      resultRecordCount: '100', // Limit to 100 wells max
    });

    console.log('DWR wells response:', result.features?.length || 0, 'wells found');

    if (result.features) {
      // Filter to only wells with valid coordinates and calculate distance
      const wellsWithDistance = result.features
        .filter((f: any) => f.attributes.DecimalLatitude && f.attributes.DecimalLongitude)
        .map((f: any) => {
          const wellLat = f.attributes.DecimalLatitude;
          const wellLng = f.attributes.DecimalLongitude;
          // Calculate distance in meters using Haversine
          const R = 6371000; // Earth radius in meters
          const dLat = (wellLat - lat) * Math.PI / 180;
          const dLng = (wellLng - lng) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                    Math.cos(lat * Math.PI / 180) * Math.cos(wellLat * Math.PI / 180) *
                    Math.sin(dLng/2) * Math.sin(dLng/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          const distance = R * c;
          
          return {
            wcr_number: f.attributes.WCRNumber,
            date_work_ended: f.attributes.DateWorkEnded ? new Date(f.attributes.DateWorkEnded).toISOString().split('T')[0] : undefined,
            total_completed_depth: f.attributes.TotalCompletedDepth,
            top_of_perforations: f.attributes.TopOfPerforatedInterval,
            bottom_of_perforations: f.attributes.BottomofPerforatedInterval,
            static_water_level: f.attributes.StaticWaterLevel,
            well_use: f.attributes.PlannedUseFormerUse,
            latitude: wellLat,
            longitude: wellLng,
            distance_from_parcel: Math.round(distance * 3.28084), // Convert to feet
          };
        })
        // Filter to actual radius (envelope is square, so some may be outside circle)
        .filter((w: WellInfo) => (w.distance_from_parcel || 0) <= radiusMeters * 3.28084)
        // Sort by distance
        .sort((a: WellInfo, b: WellInfo) => (a.distance_from_parcel || 0) - (b.distance_from_parcel || 0));
      
      console.log('DWR wells after filtering:', wellsWithDistance.length, 'wells within radius');
      return wellsWithDistance;
    }
    
    return [];
  } catch (error) {
    console.error('DWR wells fetch error:', error);
    throw error;
  }
}

/**
 * Fetch parcel by coordinates using identify operation - San Diego
 */
async function fetchSanDiegoParcelByCoords(lat: number, lng: number): Promise<ParcelInfo | null> {
  try {
    // Use identify operation - SD County doesn't support spatial queries on points
    const baseUrl = 'https://gis-public.sandiegocounty.gov/arcgis/rest/services/sdep_warehouse/PARCELS_ALL/MapServer/identify';
    const params = new URLSearchParams({
      f: 'json',
      geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryPoint',
      sr: '4326',
      layers: 'all:0',
      tolerance: '1',
      mapExtent: `${lng - 0.001},${lat - 0.001},${lng + 0.001},${lat + 0.001}`,
      imageDisplay: '1000,1000,96',
      returnGeometry: 'true',
    });

    const response = await fetch(`${baseUrl}?${params.toString()}`, {
      headers: { 'Accept': 'application/json' },
    });
    
    if (!response.ok) throw new Error(`Identify failed: ${response.status}`);
    
    const result = await response.json();

    if (result.results && result.results.length > 0) {
      const feature = result.results[0];
      const attrs = feature.attributes;
      
      const rawApn = attrs.APN || '';
      const formattedApn = rawApn.length === 10 
        ? `${rawApn.slice(0,3)}-${rawApn.slice(3,6)}-${rawApn.slice(6,8)}-${rawApn.slice(8,10)}`
        : rawApn;
      
      const siteAddr = [attrs.SITUS_ADDRESS, attrs.SITUS_STREET, attrs.SITUS_SUFFIX].filter(Boolean).join(' ');
      
      return {
        apn: formattedApn,
        ownerName: [attrs.OWN_NAME1, attrs.OWN_NAME2].filter(Boolean).join(' '),
        ownerAddress: [attrs.OWN_ADDR1, attrs.OWN_ADDR2, attrs.OWN_ADDR3].filter(Boolean).join(', '),
        siteAddress: [siteAddr, attrs.SITUS_COMMUNITY, attrs.SITUS_ZIP].filter(Boolean).join(', '),
        lotSizeAcres: parseFloat(attrs.ACREAGE) || undefined,
        lotSizeSqFt: attrs.ACREAGE ? Math.round(parseFloat(attrs.ACREAGE) * 43560) : undefined,
        geometry: convertGeometryToWGS84(feature.geometry),
        landUse: attrs.NUCLEUS_USE_CD,
        zoning: attrs.NUCLEUS_ZONE_CD,
      };
    }
    return null;
  } catch (error) {
    console.error('San Diego parcel identify error:', error);
    throw error;
  }
}

/**
 * Convert geometry from Web Mercator (102100/3857) to WGS84 (4326) if needed
 */
function convertGeometryToWGS84(geometry: any): any {
  if (!geometry || !geometry.rings) return geometry;
  
  // Check if already in WGS84 (coordinates will be small decimal values)
  const firstPoint = geometry.rings[0]?.[0];
  if (!firstPoint) return geometry;
  
  // WGS84 coordinates are roughly: lng -180 to 180, lat -90 to 90
  // Web Mercator coordinates are roughly: x -20M to 20M, y -20M to 20M
  const isWebMercator = Math.abs(firstPoint[0]) > 180 || Math.abs(firstPoint[1]) > 90;
  
  if (!isWebMercator) {
    console.log('Geometry already in WGS84');
    return geometry;
  }
  
  console.log('Converting geometry from Web Mercator to WGS84');
  
  // Convert each ring
  const convertedRings = geometry.rings.map((ring: number[][]) => 
    ring.map((pt: number[]) => {
      // Web Mercator to WGS84 conversion
      const lng = (pt[0] / 20037508.34) * 180;
      let lat = (pt[1] / 20037508.34) * 180;
      lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
      return [lng, lat];
    })
  );
  
  return {
    ...geometry,
    rings: convertedRings,
    spatialReference: { wkid: 4326 },
  };
}

/**
 * Fetch parcel by coordinates (spatial query) - Riverside
 */
async function fetchRiversideParcelByCoords(lat: number, lng: number): Promise<ParcelInfo | null> {
  try {
    const result = await queryArcGIS(GIS_ENDPOINTS.riverside.parcels, {
      geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryPoint',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
    });

    if (result.features && result.features.length > 0) {
      const feature = result.features[0];
      const attrs = feature.attributes;
      
      return {
        apn: attrs.APN,
        ownerName: attrs.OWNERNAME || attrs.OWNER_NAME,
        ownerAddress: attrs.OWNERADDR || attrs.OWNER_ADDR,
        siteAddress: attrs.SITEADDR || attrs.SITE_ADDRESS,
        lotSizeAcres: attrs.ACRES || attrs.ACREAGE,
        lotSizeSqFt: attrs.SQ_FEET || attrs.SHAPE_Area,
        geometry: feature.geometry,
        landUse: attrs.LANDUSE || attrs.LAND_USE,
        zoning: attrs.ZONING,
      };
    }
    return null;
  } catch (error) {
    console.error('Riverside parcel by coords error:', error);
    throw error;
  }
}

interface SepticPermit {
  apn: string;
  designation: string;
  type: 'SEPTIC' | 'SEWER' | 'UNKNOWN';
  latitude: number;
  longitude: number;
  full_address?: string;
  distance_feet?: number;
}

/**
 * Fetch infrastructure status from our database
 */
async function fetchInfrastructureStatus(supabase: any, apn: string, lat?: number, lng?: number): Promise<any> {
  try {
    // Try by APN first
    if (apn) {
      const cleanApn = apn.replace(/-/g, '');
      const { data } = await supabase
        .from('parcel_infrastructure')
        .select('*')
        .eq('apn', cleanApn)
        .single();
      
      if (data) {
        return {
          status: 'found',
          type: data.sewer_septic_designation?.toLowerCase().includes('septic') ? 'SEPTIC' : 
                data.sewer_septic_designation?.toLowerCase().includes('sewer') ? 'SEWER' : 'UNKNOWN',
          designation: data.sewer_septic_designation,
          source: 'San Diego County SANGIS',
          latitude: data.latitude,
          longitude: data.longitude,
        };
      }
    }
    
    // Try by coordinates if no APN match
    if (lat && lng) {
      const { data } = await supabase
        .from('parcel_infrastructure')
        .select('*')
        .gte('latitude', lat - 0.001)
        .lte('latitude', lat + 0.001)
        .gte('longitude', lng - 0.001)
        .lte('longitude', lng + 0.001)
        .limit(1)
        .single();
      
      if (data) {
        return {
          status: 'found',
          type: data.sewer_septic_designation?.toLowerCase().includes('septic') ? 'SEPTIC' : 
                data.sewer_septic_designation?.toLowerCase().includes('sewer') ? 'SEWER' : 'UNKNOWN',
          designation: data.sewer_septic_designation,
          source: 'San Diego County SANGIS',
          latitude: data.latitude,
          longitude: data.longitude,
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('Infrastructure lookup error:', error);
    return null;
  }
}

/**
 * Fetch nearby septic permits within radius
 * Returns parcels marked as "septic" within the search radius for mapping
 */
async function fetchNearbySepticPermits(supabase: any, lat: number, lng: number, radiusMeters: number = 1609): Promise<SepticPermit[]> {
  try {
    // Convert radius to approximate degrees (1 mile ≈ 0.0145 degrees at CA latitude)
    const latDegPerMeter = 1 / 111000;
    const lngDegPerMeter = 1 / (111000 * Math.cos(lat * Math.PI / 180));
    
    const latOffset = radiusMeters * latDegPerMeter;
    const lngOffset = radiusMeters * lngDegPerMeter;
    
    console.log('Fetching nearby septic permits within', radiusMeters, 'm of', lat, lng);
    
    // Query parcels with septic designation within bounding box
    const { data, error } = await supabase
      .from('parcel_infrastructure')
      .select('apn, sewer_septic_designation, latitude, longitude, full_address')
      .gte('latitude', lat - latOffset)
      .lte('latitude', lat + latOffset)
      .gte('longitude', lng - lngOffset)
      .lte('longitude', lng + lngOffset)
      .ilike('sewer_septic_designation', '%septic%')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .limit(50);
    
    if (error) {
      console.error('Septic permits query error:', error);
      return [];
    }
    
    if (!data || data.length === 0) {
      console.log('No septic permits found in database');
      return [];
    }
    
    console.log('Found', data.length, 'septic parcels in bounding box');
    
    // Calculate distance and filter to actual radius
    const permits = data
      .map((record: any) => {
        const septicLat = parseFloat(record.latitude);
        const septicLng = parseFloat(record.longitude);
        
        // Calculate distance using Haversine
        const R = 6371000; // Earth radius in meters
        const dLat = (septicLat - lat) * Math.PI / 180;
        const dLng = (septicLng - lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat * Math.PI / 180) * Math.cos(septicLat * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distanceMeters = R * c;
        const distanceFeet = Math.round(distanceMeters * 3.28084);
        
        return {
          apn: record.apn,
          designation: record.sewer_septic_designation,
          type: 'SEPTIC' as const,
          latitude: septicLat,
          longitude: septicLng,
          full_address: record.full_address,
          distance_feet: distanceFeet,
        };
      })
      .filter((p: SepticPermit) => (p.distance_feet || 0) <= radiusMeters * 3.28084)
      .sort((a: SepticPermit, b: SepticPermit) => (a.distance_feet || 0) - (b.distance_feet || 0));
    
    console.log('Septic permits within radius:', permits.length);
    return permits;
  } catch (error) {
    console.error('Fetch nearby septic permits error:', error);
    return [];
  }
}

/**
 * Generate mock septic data (when no data found)
 */
function getMockSepticData(): any {
  return {
    status: 'mock',
    message: 'Septic records require manual lookup with County DEH',
    info: {
      permit_status: 'Unknown - requires manual research',
      notes: 'Contact San Diego County DEH at (858) 505-6700 or Riverside County DEH at (951) 358-5172',
    },
  };
}

/**
 * POST /api/permits/research - Research parcel data
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { apn, address, county, lat, lng } = body;

    if (!apn && !address && !lat && !lng) {
      return NextResponse.json(
        { error: 'Either APN, address, or GPS coordinates are required' },
        { status: 400 }
      );
    }

    const targetCounty = county || 'san_diego';
    const sources: ResearchResult['sources'] = [];
    let result: ResearchResult = {
      parcel: null,
      wells: [],
      septic: null,
      septicPermits: [], // Nearby septic parcels for mapping
      zoning: null,
      sources: [],
    };

    // Check cache first
    if (apn) {
      const { data: cached } = await supabase
        .from('permit_research_cache')
        .select('*')
        .eq('apn', apn)
        .eq('county', targetCounty)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (cached) {
        const cachedData = cached as any;
        // Fetch fresh septic permits (not cached)
        let septicPermits: SepticPermit[] = [];
        if (lat && lng) {
          try {
            septicPermits = await fetchNearbySepticPermits(supabase, lat, lng, 1609);
          } catch (e) {
            console.error('Failed to fetch septic permits for cached result:', e);
          }
        }
        return NextResponse.json({
          ...result,
          parcel: cachedData.parcel_data,
          wells: cachedData.wells_data || [],
          septic: cachedData.septic_data,
          septicPermits,
          zoning: cachedData.zoning_data,
          sources: cachedData.data_sources || [],
          cached: true,
        });
      }
    }

    // Fetch parcel data - by APN or by coordinates
    try {
      if (targetCounty === 'san_diego') {
        if (apn) {
          result.parcel = await fetchSanDiegoParcel(apn);
        } else if (lat && lng) {
          result.parcel = await fetchSanDiegoParcelByCoords(lat, lng);
        }
        sources.push({ name: 'San Diego County GIS', status: result.parcel ? 'success' : 'error', message: result.parcel ? undefined : 'Parcel not found' });
      } else if (targetCounty === 'riverside') {
        if (apn) {
          result.parcel = await fetchRiversideParcel(apn);
        } else if (lat && lng) {
          result.parcel = await fetchRiversideParcelByCoords(lat, lng);
        }
        sources.push({ name: 'Riverside County GIS', status: result.parcel ? 'success' : 'error', message: result.parcel ? undefined : 'Parcel not found' });
      }
    } catch (error) {
      sources.push({ 
        name: `${targetCounty === 'san_diego' ? 'San Diego' : 'Riverside'} County GIS`, 
        status: 'error', 
        message: error instanceof Error ? error.message : 'Failed to fetch parcel data' 
      });
    }

    // Get parcel centroid for well search
    let searchLat = lat;
    let searchLng = lng;
    
    if (result.parcel?.geometry) {
      // Calculate centroid from polygon rings
      const geom = result.parcel.geometry;
      if (geom.rings && geom.rings[0]) {
        const ring = geom.rings[0];
        const sumLat = ring.reduce((sum: number, pt: number[]) => sum + pt[1], 0);
        const sumLng = ring.reduce((sum: number, pt: number[]) => sum + pt[0], 0);
        searchLat = sumLat / ring.length;
        searchLng = sumLng / ring.length;
      }
    }

    // Fetch wells from DWR
    if (searchLat && searchLng) {
      try {
        result.wells = await fetchDWRWells(searchLat, searchLng, 1609); // 1 mile radius
        sources.push({ 
          name: 'CA DWR Well Completion Reports', 
          status: 'success',
          message: `Found ${result.wells.length} wells within 1 mile`
        });
      } catch (error) {
        sources.push({ 
          name: 'CA DWR Well Completion Reports', 
          status: 'error', 
          message: error instanceof Error ? error.message : 'Failed to fetch well data' 
        });
      }
    }

    // Septic/Sewer infrastructure data - check our database first
    const infrastructureData = await fetchInfrastructureStatus(
      supabase, 
      result.parcel?.apn || apn || '', 
      searchLat, 
      searchLng
    );
    
    if (infrastructureData && infrastructureData.status === 'found') {
      result.septic = infrastructureData;
      sources.push({ 
        name: 'Infrastructure Data', 
        status: 'success', 
        message: `Property is on ${infrastructureData.type}` 
      });
    } else {
      result.septic = getMockSepticData();
      sources.push({ name: 'Septic Records', status: 'mock', message: 'Manual lookup required' });
    }
    
    // Fetch nearby septic permits for mapping (within 1 mile)
    if (searchLat && searchLng) {
      try {
        result.septicPermits = await fetchNearbySepticPermits(supabase, searchLat, searchLng, 1609);
        if (result.septicPermits.length > 0) {
          sources.push({ 
            name: 'Nearby Septic Parcels', 
            status: 'success',
            message: `Found ${result.septicPermits.length} septic parcels within 1 mile`
          });
        }
      } catch (error) {
        console.error('Septic permits fetch error:', error);
        // Non-fatal - we still return other data
      }
    }

    // Zoning data (from parcel if available)
    if (result.parcel?.zoning || result.parcel?.landUse) {
      result.zoning = {
        designation: result.parcel.zoning,
        landUse: result.parcel.landUse,
        source: 'County Assessor Data',
        note: 'For official zoning, verify with local planning department',
      };
      sources.push({ name: 'Zoning Data', status: 'success' });
    } else {
      sources.push({ name: 'Zoning Data', status: 'error', message: 'Not available from parcel data' });
    }

    result.sources = sources;

    // Cache the results (septicPermits not cached - always queried fresh)
    if (apn && result.parcel) {
      await supabase.from('permit_research_cache').upsert({
        apn,
        county: targetCounty,
        parcel_data: result.parcel,
        parcel_geometry: result.parcel.geometry,
        wells_data: result.wells,
        septic_data: result.septic,
        zoning_data: result.zoning,
        data_sources: sources,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      } as any, {
        onConflict: 'apn,county',
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Permit research API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
