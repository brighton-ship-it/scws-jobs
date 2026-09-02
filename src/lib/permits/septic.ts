import { cleanApn } from './county.ts';
import { haversineFeet } from './gis.ts';
import type { County, SepticInfo, SepticPermit } from './types.ts';

type SupabaseLike = {
  from: (table: string) => any;
};

function designationType(text?: string | null): SepticInfo['type'] {
  const value = (text || '').toLowerCase();
  if (value.includes('septic')) return 'SEPTIC';
  if (value.includes('sewer')) return 'SEWER';
  return 'UNKNOWN';
}

export async function lookupSiteSeptic(
  supabase: SupabaseLike,
  apn: string,
  lat?: number,
  lng?: number,
  county: County = 'san_diego'
): Promise<SepticInfo | null> {
  try {
    if (county === 'san_diego' && apn) {
      const { data } = await supabase
        .from('parcel_infrastructure')
        .select('apn, sewer_septic_designation, latitude, longitude')
        .eq('apn', cleanApn(apn))
        .maybeSingle();
      if (data?.sewer_septic_designation) {
        return {
          status: 'found',
          type: designationType(data.sewer_septic_designation),
          designation: data.sewer_septic_designation,
          source: 'San Diego County SANGIS (parcel-level, not tank GPS)',
          latitude: data.latitude ?? undefined,
          longitude: data.longitude ?? undefined,
          locationUnknown: true,
        };
      }
    }

    if (county === 'riverside' && lat != null && lng != null) {
      const { data } = await supabase
        .from('riverside_septic_permits')
        .select('apn, site_address, city, latitude, longitude, project_type')
        .gte('latitude', lat - 0.0004)
        .lte('latitude', lat + 0.0004)
        .gte('longitude', lng - 0.0004)
        .lte('longitude', lng + 0.0004)
        .limit(1);
      if (data?.[0]) {
        return {
          status: 'found',
          type: 'SEPTIC',
          designation: data[0].project_type || 'OWTS permit on or next to this parcel',
          source: 'Riverside OWTS permits (parcel/site, not surveyed tank)',
          latitude: data[0].latitude ?? undefined,
          longitude: data[0].longitude ?? undefined,
          locationUnknown: true,
        };
      }
    }

    if (county === 'san_bernardino' && lat != null && lng != null) {
      const { data } = await supabase
        .from('sb_septic_permits')
        .select('apn, sewer_status, latitude, longitude')
        .gte('latitude', lat - 0.0004)
        .lte('latitude', lat + 0.0004)
        .gte('longitude', lng - 0.0004)
        .lte('longitude', lng + 0.0004)
        .limit(1);
      if (data?.[0]) {
        return {
          status: 'found',
          type: designationType(data[0].sewer_status),
          designation: data[0].sewer_status,
          source: 'San Bernardino septic permits (parcel-level)',
          latitude: data[0].latitude ?? undefined,
          longitude: data[0].longitude ?? undefined,
          locationUnknown: true,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function lookupNearbySeptic(
  supabase: SupabaseLike,
  lat: number,
  lng: number,
  radiusMeters: number,
  county: County
): Promise<SepticPermit[]> {
  const latOffset = radiusMeters / 111000;
  const lngOffset = radiusMeters / (111000 * Math.cos((lat * Math.PI) / 180));

  try {
    let rows: Array<{
      apn?: string;
      designation?: string;
      latitude?: number;
      longitude?: number;
      full_address?: string;
    }> = [];

    if (county === 'san_bernardino') {
      const { data, error } = await supabase
        .from('sb_septic_permits')
        .select('apn, sewer_status, latitude, longitude')
        .gte('latitude', lat - latOffset)
        .lte('latitude', lat + latOffset)
        .gte('longitude', lng - lngOffset)
        .lte('longitude', lng + lngOffset)
        .not('latitude', 'is', null)
        .limit(100);
      if (error) return [];
      rows = (data || []).map((r: any) => ({
        apn: r.apn,
        designation: r.sewer_status,
        latitude: r.latitude,
        longitude: r.longitude,
      }));
    } else if (county === 'riverside') {
      const { data, error } = await supabase
        .from('riverside_septic_permits')
        .select('apn, site_address, city, latitude, longitude, project_type')
        .gte('latitude', lat - latOffset)
        .lte('latitude', lat + latOffset)
        .gte('longitude', lng - lngOffset)
        .lte('longitude', lng + lngOffset)
        .not('latitude', 'is', null)
        .limit(100);
      if (error) return [];
      rows = (data || []).map((r: any) => ({
        apn: r.apn,
        designation: r.project_type || 'OWTS',
        latitude: r.latitude,
        longitude: r.longitude,
        full_address: r.site_address ? `${r.site_address}, ${r.city || ''}`.trim() : undefined,
      }));
    } else {
      const { data, error } = await supabase
        .from('parcel_infrastructure')
        .select('apn, sewer_septic_designation, latitude, longitude')
        .gte('latitude', lat - latOffset)
        .lte('latitude', lat + latOffset)
        .gte('longitude', lng - lngOffset)
        .lte('longitude', lng + lngOffset)
        .ilike('sewer_septic_designation', '%septic%')
        .not('latitude', 'is', null)
        .limit(100);
      if (error) return [];
      rows = (data || []).map((r: any) => ({
        apn: r.apn,
        designation: r.sewer_septic_designation,
        latitude: r.latitude,
        longitude: r.longitude,
      }));
    }

    return rows
      .filter((r) => r.latitude && r.longitude)
      .map((r) => ({
        apn: r.apn || '—',
        designation: r.designation || 'SEPTIC',
        type: 'SEPTIC' as const,
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        full_address: r.full_address,
        distance_feet: Math.round(haversineFeet(lat, lng, Number(r.latitude), Number(r.longitude))),
      }))
      .filter((p) => (p.distance_feet || 0) <= radiusMeters * 3.28084)
      .sort((a, b) => (a.distance_feet || 0) - (b.distance_feet || 0));
  } catch {
    return [];
  }
}
