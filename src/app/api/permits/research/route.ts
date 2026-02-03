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

interface ResearchResult {
  parcel: ParcelInfo | null;
  wells: WellInfo[];
  septic: any | null;
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
 */
async function fetchDWRWells(lat: number, lng: number, radiusMeters: number = 1609): Promise<WellInfo[]> {
  try {
    // Convert lat/lng to Web Mercator for buffer
    const x = lng * 20037508.34 / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180;
    
    const result = await queryArcGIS(GIS_ENDPOINTS.dwr_wells, {
      geometry: JSON.stringify({
        x: x,
        y: y,
        spatialReference: { wkid: 102100 }
      }),
      geometryType: 'esriGeometryPoint',
      spatialRel: 'esriSpatialRelIntersects',
      distance: radiusMeters.toString(),
      units: 'esriSRUnit_Meter',
      outFields: 'WCRNUMBER,DateWorkEnded,TotalCompletedDepth,TopOfPerforations,BottomOfPerforations,StaticWaterLevel,PlannedUseFormerUse,LATITUDE,LONGITUDE',
      returnGeometry: 'false',
      outSR: '4326',
    });

    if (result.features) {
      return result.features.map((f: any) => ({
        wcr_number: f.attributes.WCRNUMBER,
        date_work_ended: f.attributes.DateWorkEnded ? new Date(f.attributes.DateWorkEnded).toISOString().split('T')[0] : undefined,
        total_completed_depth: f.attributes.TotalCompletedDepth,
        top_of_perforations: f.attributes.TopOfPerforations,
        bottom_of_perforations: f.attributes.BottomOfPerforations,
        static_water_level: f.attributes.StaticWaterLevel,
        well_use: f.attributes.PlannedUseFormerUse,
        latitude: f.attributes.LATITUDE,
        longitude: f.attributes.LONGITUDE,
      }));
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
    // Use identify operation instead of query (query doesn't support point spatial)
    const baseUrl = 'https://gis-public.sandiegocounty.gov/arcgis/rest/services/sdep_warehouse/PARCELS_ALL/MapServer/identify';
    const params = new URLSearchParams({
      f: 'json',
      geometry: JSON.stringify({ x: lng, y: lat }),
      geometryType: 'esriGeometryPoint',
      sr: '4326',
      layers: 'all:0',
      tolerance: '10',
      mapExtent: `${lng - 0.01},${lat - 0.01},${lng + 0.01},${lat + 0.01}`,
      imageDisplay: '400,400,96',
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
        geometry: feature.geometry,
        landUse: attrs.NUCLEUS_USE_CD,
        zoning: attrs.NUCLEUS_ZONE_CD,
      };
    }
    return null;
  } catch (error) {
    console.error('San Diego parcel by coords error:', error);
    throw error;
  }
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
        return NextResponse.json({
          ...result,
          parcel: cached.parcel_data,
          wells: cached.wells_data || [],
          septic: cached.septic_data,
          zoning: cached.zoning_data,
          sources: cached.data_sources || [],
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

    // Cache the results
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
      }, {
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
