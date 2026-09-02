'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Search, 
  MapPin, 
  Droplets, 
  Building2, 
  FileText, 
  Loader2, 
  AlertCircle, 
  CheckCircle2,
  Download,
  Save,
  ExternalLink,
  Info,
  User,
  Home,
  Ruler,
  Calendar,
  ChevronDown,
  ChevronUp,
  Navigation,
  FileCheck,
  Target,
  CircleDot,
} from 'lucide-react';
import { getMapsLibrary, isGoogleMapsConfigured, SOCAL_CENTER } from '@/components/maps/GoogleMapsLoader';
import jsPDF from 'jspdf';
import { detectCounty as detectCountyFromInput } from '@/lib/permits/county';
import { COUNTY_LABEL, PROPERTY_LINE_SETBACK_FT, type County as PermitCounty } from '@/lib/permits/types';

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

interface SepticPermit {
  apn: string;
  designation: string;
  type: 'SEPTIC' | 'SEWER' | 'UNKNOWN';
  latitude: number;
  longitude: number;
  full_address?: string;
  distance_feet?: number;
}

interface UtilityFeature {
  type: 'Feature';
  properties: {
    id: number;
    utility_type: string;
    source_table: string;
    city?: string;
    [key: string]: any;
  };
  geometry: any;
}

interface UtilityCoverage {
  hasCoverage: boolean;
  county?: string;
  availableTypes: string[];
  missingTypes: string[];
  recommendation: string;
  call811: boolean;
  note?: string;
}

// Utility colors for map layers - visible on satellite
const UTILITY_COLORS = {
  sewer: '#8B4513', // brown
  water: '#00BFFF', // bright cyan blue
  storm: '#00FF00', // bright green
  electric: '#FFFF00', // bright yellow
};

interface ResearchResult {
  parcel: ParcelInfo | null;
  wells: WellInfo[];
  septic: any | null;
  septicPermits: SepticPermit[];
  zoning: any | null;
  sources: { name: string; status: 'success' | 'error' | 'missing' | 'mock'; message?: string }[];
  county?: PermitCounty;
  searchPoint?: { lat: number; lng: number } | null;
  formattedAddress?: string;
  notes?: string[];
  cached?: boolean;
  structures?: { rings: number[][][]; areaSqFt?: number; onSubjectParcel?: boolean }[];
  proposedWell?: {
    lat: number;
    lng: number;
    source: string;
    meetsSetbacks: boolean;
    flags: string[];
    distances: {
      propertyLineFt: number | null;
      tankFt: number | null;
      leachFt: number | null;
      existingWellFt: number | null;
      structureFt: number | null;
    };
  } | null;
  dehDocuments?: Array<{
    fileRecordId: string;
    permitId?: string;
    subcategory?: string;
    viewUrl: string;
    geometryExtracted: boolean;
    note: string;
    isAsBuiltCandidate: boolean;
  }>;
  neighbors?: Array<{
    apn: string;
    siteAddress?: string;
    septicFlag?: string;
    tankLeach: string;
    distanceFt?: number;
  }>;
  wellsWithin250Ft?: number;
}

type County = PermitCounty;
type SearchType = 'apn' | 'address' | 'gps';

interface SepticLocation {
  lat: number;
  lng: number;
}

interface PermitFormData {
  proposedDepth: string;
  proposedDiameter: string;
  purpose: string;
  locationOnParcel: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  customerEmail: string;
}

const COUNTY_OPTIONS: { value: County; label: string }[] = [
  { value: 'san_diego', label: 'San Diego County' },
  { value: 'riverside', label: 'Riverside County' },
  { value: 'san_bernardino', label: 'San Bernardino County' },
];

// County boundaries (approximate)
function detectCountyFromCoords(lat: number, lng: number): County {
  return detectCountyFromInput({ lat, lng });
}

// Convert feet to meters
const feetToMeters = (feet: number) => feet * 0.3048;

// Calculate distance between two points in feet
function distanceBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231; // Earth radius in feet
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export default function PermitResearchPage() {
  const [searchType, setSearchType] = useState<SearchType>('address');
  const [apn, setApn] = useState('');
  const [address, setAddress] = useState('');
  const [gpsLat, setGpsLat] = useState('');
  const [gpsLng, setGpsLng] = useState('');
  const [county, setCounty] = useState<County>('san_diego');
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    parcel: true,
    wells: true,
    septic: true,
    zoning: true,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // Setback visualization state
  const [septicLocation, setSepticLocation] = useState<SepticLocation | null>(null);
  const [wellLocation, setWellLocation] = useState<SepticLocation | null>(null); // Proposed well location
  const [showSetbacks, setShowSetbacks] = useState(true);
  const [isPlacingSeptic, setIsPlacingSeptic] = useState(false);
  const [isPlacingWell, setIsPlacingWell] = useState(false);
  const isPlacingSepticRef = useRef(false); // Ref to track current state in click handler
  
  // Manual wells (known wells not in DWR database)
  const [manualWells, setManualWells] = useState<Array<{ lat: number; lng: number; label: string; depth?: number }>>([]);
  const [isPlacingManualWell, setIsPlacingManualWell] = useState(false);
  const isPlacingManualWellRef = useRef(false);
  const manualWellMarkersRef = useRef<google.maps.Marker[]>([]);
  const isPlacingWellRef = useRef(false);
  
  // PDF Export state
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  
  // Permit form state
  const [showPermitForm, setShowPermitForm] = useState(false);
  const [isGeneratingPermit, setIsGeneratingPermit] = useState(false);
  const [permitFormData, setPermitFormData] = useState<PermitFormData>({
    proposedDepth: '',
    proposedDiameter: '6',
    purpose: 'Domestic',
    locationOnParcel: '',
    customerName: '',
    customerAddress: '',
    customerPhone: '',
    customerEmail: '',
  });
  
  const mapRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const septicPermitMarkersRef = useRef<google.maps.Marker[]>([]); // Orange markers for septic parcels
  const parcelPolygonRef = useRef<google.maps.Polygon | null>(null);
  const setbackCirclesRef = useRef<google.maps.Circle[]>([]);
  const propertyLineSetbackRef = useRef<google.maps.Polygon | null>(null);
  const septicMarkerRef = useRef<google.maps.Marker | null>(null);
  const proposedWellSetbackRef = useRef<google.maps.Circle | null>(null); // Separate ref for proposed well setback
  const structurePolygonsRef = useRef<google.maps.Polygon[]>([]);
  
  // Coordinates for search
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  
  // Map ready state (to trigger drawing useEffect)
  const [mapReady, setMapReady] = useState(false);
  
  // Utility infrastructure state
  const [utilityLayers, setUtilityLayers] = useState<{
    sewer: boolean;
    water: boolean;
    storm: boolean;
    electric: boolean;
  }>({ sewer: true, water: true, storm: false, electric: false });
  const [utilityFeatures, setUtilityFeatures] = useState<UtilityFeature[]>([]);
  const [utilityCoverage, setUtilityCoverage] = useState<UtilityCoverage | null>(null);
  const [isLoadingUtilities, setIsLoadingUtilities] = useState(false);
  const utilityPolylinesRef = useRef<google.maps.Polyline[]>([]);
  const utilityMarkersRef = useRef<google.maps.Marker[]>([]);

  // Initialize map - runs when result changes (which makes mapRef available)
  useEffect(() => {
    let isMounted = true;
    
    async function initMap() {
      // Only init when we have results (which renders the map container)
      if (!isGoogleMapsConfigured() || !mapRef.current) {
        return;
      }
      
      // Already initialized
      if (mapInstanceRef.current) {
        return;
      }
      
      try {
        const { Map } = await getMapsLibrary();
        
        if (!isMounted || !mapRef.current) return;
        
        const map = new Map(mapRef.current, {
          center: coordinates || SOCAL_CENTER,
          zoom: coordinates ? 17 : 10,
          mapTypeControl: true,
          streetViewControl: false,
          mapTypeId: 'satellite',
        });
        
        mapInstanceRef.current = map;
        setMapReady(true);
        
        // Click handler added - but we'll use a separate useEffect for placement
        // to avoid stale closure issues
      } catch (err) {
        console.error('Error initializing map:', err);
      }
    }
    
    // Small delay to ensure DOM is ready after result renders
    const timer = setTimeout(initMap, 100);
    
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [result, coordinates]); // Re-run when result changes (which renders the map container)

  // Handle map clicks for placing septic/well
  const mapClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    
    // Remove old listener
    if (mapClickListenerRef.current) {
      google.maps.event.removeListener(mapClickListenerRef.current);
    }
    
    // Only add listener if in placement mode
    if (!isPlacingSeptic && !isPlacingWell && !isPlacingManualWell) {
      return;
    }
    
    mapClickListenerRef.current = google.maps.event.addListener(map, 'click', (e: google.maps.MapMouseEvent) => {
      
      if (isPlacingSeptic && e.latLng) {
        setSepticLocation({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        setIsPlacingSeptic(false);
      }
      
      if (isPlacingWell && e.latLng) {
        setWellLocation({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        setIsPlacingWell(false);
      }
      
      if (isPlacingManualWell && e.latLng) {
        const newWell = {
          lat: e.latLng.lat(),
          lng: e.latLng.lng(),
          label: `Manual ${manualWells.length + 1}`,
        };
        setManualWells(prev => [...prev, newWell]);
        setIsPlacingManualWell(false);
      }
    });
    
    return () => {
      if (mapClickListenerRef.current) {
        google.maps.event.removeListener(mapClickListenerRef.current);
        mapClickListenerRef.current = null;
      }
    };
  }, [isPlacingSeptic, isPlacingWell, isPlacingManualWell, manualWells.length, mapReady]);

  // Fetch utility data when coordinates change
  useEffect(() => {
    if (!coordinates) return;
    const point = coordinates;
    
    async function fetchUtilities() {
      setIsLoadingUtilities(true);
      try {
        // Fetch coverage info
        const coverageRes = await fetch(
          `/api/utilities/coverage?lat=${point.lat}&lng=${point.lng}`
        );
        if (coverageRes.ok) {
          const coverageData = await coverageRes.json();
          setUtilityCoverage(coverageData);
        }
        
        // Fetch nearby utilities
        const enabledTypes = Object.entries(utilityLayers)
          .filter(([_, enabled]) => enabled)
          .map(([type]) => type)
          .join(',');
        
        if (enabledTypes) {
          const nearbyRes = await fetch(
            `/api/utilities/nearby?lat=${point.lat}&lng=${point.lng}&radius=500&types=${enabledTypes}`
          );
          if (nearbyRes.ok) {
            const nearbyData = await nearbyRes.json();
            setUtilityFeatures(nearbyData.features || []);
          }
        }
      } catch (err) {
        console.error('Error fetching utilities:', err);
      } finally {
        setIsLoadingUtilities(false);
      }
    }
    
    fetchUtilities();
  }, [coordinates, utilityLayers]);

  // Render utility layers on map
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    const map = mapInstanceRef.current;
    
    // Clear existing utility layers
    utilityPolylinesRef.current.forEach(p => p.setMap(null));
    utilityPolylinesRef.current = [];
    utilityMarkersRef.current.forEach(m => m.setMap(null));
    utilityMarkersRef.current = [];
    
    // Draw utility features
    utilityFeatures.forEach((feature) => {
      const utilityType = feature.properties.utility_type;
      const color = UTILITY_COLORS[utilityType as keyof typeof UTILITY_COLORS] || '#888888';
      
      // Check if this type is enabled
      if (!utilityLayers[utilityType as keyof typeof utilityLayers]) return;
      
      if (!feature.geometry) return;
      
      const geom = typeof feature.geometry === 'string' 
        ? JSON.parse(feature.geometry) 
        : feature.geometry;
      
      if (geom.type === 'LineString' || geom.type === 'MultiLineString') {
        const coords = geom.type === 'MultiLineString' 
          ? geom.coordinates 
          : [geom.coordinates];
        
        coords.forEach((line: number[][]) => {
          if (!Array.isArray(line) || line.length < 2) return;
          const path = line.map((coord: number[]) => ({ lat: coord[1], lng: coord[0] }));
          const polyline = new google.maps.Polyline({
            path,
            strokeColor: color,
            strokeOpacity: 1.0,
            strokeWeight: 4,
            map,
            zIndex: 100,
          });
          utilityPolylinesRef.current.push(polyline);
        });
      } else if (geom.type === 'Point') {
        const marker = new google.maps.Marker({
          map,
          position: { lat: geom.coordinates[1], lng: geom.coordinates[0] },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: color,
            fillOpacity: 0.8,
            strokeColor: '#ffffff',
            strokeWeight: 1,
          },
          title: `${utilityType} - ${feature.properties.source_table}`,
        });
        utilityMarkersRef.current.push(marker);
      }
    });
  }, [utilityFeatures, utilityLayers, mapReady]);

  // Update map when results change
  useEffect(() => {
    
    // Always clear existing markers and polygons first
    if (mapInstanceRef.current) {
      markersRef.current.forEach(m => m.map = null);
      markersRef.current = [];
      septicPermitMarkersRef.current.forEach(m => {
        if ((m as any)._septicCircle) {
          (m as any)._septicCircle.setMap(null);
        }
        m.setMap(null);
      });
      septicPermitMarkersRef.current = [];
      if (parcelPolygonRef.current) {
        parcelPolygonRef.current.setMap(null);
        parcelPolygonRef.current = null;
      }
      setbackCirclesRef.current.forEach(c => c.setMap(null));
      setbackCirclesRef.current = [];
      if (propertyLineSetbackRef.current) {
        propertyLineSetbackRef.current.setMap(null);
        propertyLineSetbackRef.current = null;
      }
      structurePolygonsRef.current.forEach((p) => p.setMap(null));
      structurePolygonsRef.current = [];
    }
    
    // Now check if we should draw new results
    if (!mapInstanceRef.current || !result) {
      return;
    }
    
    const map = mapInstanceRef.current;
    
    // Draw parcel boundary
    if (result.parcel?.geometry?.rings) {
      const rings = result.parcel.geometry.rings[0];
      const parcelCoords = rings.map((pt: number[]) => ({ lat: pt[1], lng: pt[0] }));
      
      parcelPolygonRef.current = new google.maps.Polygon({
        paths: parcelCoords,
        strokeColor: '#10B981',
        strokeOpacity: 0.9,
        strokeWeight: 3,
        fillColor: '#10B981',
        fillOpacity: 0.15,
        map,
      });
      
      // Fit bounds to parcel
      const bounds = new google.maps.LatLngBounds();
      parcelCoords.forEach((coord: { lat: number; lng: number }) => bounds.extend(coord));
      map.fitBounds(bounds, 100);
      
      if (showSetbacks) {
        drawPropertyLineSetback(parcelCoords, map);
      }
    }

    (result.structures || []).forEach((structure) => {
      const sring = structure.rings?.[0];
      if (!sring || sring.length < 3) return;
      const path = sring.map((pt: number[]) => ({ lat: pt[1], lng: pt[0] }));
      const poly = new google.maps.Polygon({
        paths: path,
        strokeColor: '#6B7280',
        strokeOpacity: 0.9,
        strokeWeight: 1.5,
        fillColor: '#9CA3AF',
        fillOpacity: 0.25,
        map,
      });
      structurePolygonsRef.current.push(poly);
    });
    
    // Add well markers with depth labels (using regular Marker, not AdvancedMarker)
    // Declutter overlapping wells by spreading them in a spiral pattern
    if (result.wells.length > 0) {
      
      // Group wells by location (round to 5 decimal places ~1m precision)
      const locationGroups = new Map<string, { wells: typeof result.wells; indices: number[] }>();
      result.wells.forEach((well, index) => {
        if (!well.latitude || !well.longitude) return;
        const key = `${well.latitude.toFixed(5)},${well.longitude.toFixed(5)}`;
        if (!locationGroups.has(key)) {
          locationGroups.set(key, { wells: [], indices: [] });
        }
        locationGroups.get(key)!.wells.push(well);
        locationGroups.get(key)!.indices.push(index);
      });
      
      // Calculate offset positions for overlapping wells (spiral pattern)
      const getOffsetPosition = (lat: number, lng: number, index: number, total: number) => {
        if (total === 1) return { lat, lng };
        // Spiral offset: ~30 meters per step at this latitude
        const offsetMeters = 25; // Distance between markers
        const angle = (index * 2 * Math.PI) / Math.min(total, 8) + (index >= 8 ? Math.PI / 8 : 0);
        const radius = offsetMeters * (1 + Math.floor(index / 8) * 0.5); // Expand radius for outer rings
        const latOffset = (radius / 111000) * Math.cos(angle);
        const lngOffset = (radius / (111000 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle);
        return { lat: lat + latOffset, lng: lng + lngOffset };
      };
      
      // Track which wells we've processed
      const processedIndices = new Set<number>();
      
      locationGroups.forEach(({ wells: groupWells, indices }) => {
        const baseLat = groupWells[0].latitude;
        const baseLng = groupWells[0].longitude;
        
        groupWells.forEach((well, groupIndex) => {
          const originalIndex = indices[groupIndex];
          if (processedIndices.has(originalIndex)) return;
          processedIndices.add(originalIndex);
          
          const position = getOffsetPosition(baseLat, baseLng, groupIndex, groupWells.length);
          const isOffset = groupWells.length > 1;
          
          const marker = new google.maps.Marker({
            map,
            position,
            title: `Well #${well.wcr_number} - ${well.total_completed_depth || 'Unknown'}ft deep${isOffset ? ' (position approximate)' : ''}`,
          label: {
            text: String(originalIndex + 1),
            color: 'white',
            fontSize: '11px',
            fontWeight: 'bold',
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: '#3B82F6',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        });
        
        // Add info window with well details
        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div style="padding: 8px; min-width: 180px;">
              <strong style="font-size: 14px;">Well #${well.wcr_number}</strong><br/>
              ${well.total_completed_depth ? `<b>Depth:</b> ${well.total_completed_depth}ft<br/>` : ''}
              ${well.static_water_level ? `<b>Static Level:</b> ${well.static_water_level}ft<br/>` : ''}
              ${well.well_use ? `<b>Use:</b> ${well.well_use}<br/>` : ''}
              ${well.date_work_ended ? `<b>Date:</b> ${well.date_work_ended}<br/>` : ''}
              ${well.distance_from_parcel ? `<b>Distance:</b> ${well.distance_from_parcel.toLocaleString()}ft<br/>` : ''}
              ${isOffset ? `<i style="color: #666; font-size: 11px;">⚠️ ${groupWells.length} wells at this location<br/>Position spread for visibility</i>` : ''}
            </div>
          `,
        });
        
        marker.addListener('click', () => {
          infoWindow.open(map, marker);
        });
        
        markersRef.current.push(marker as any);
        });
      });
    }
    
    // Add septic permit markers (orange squares)
    if (result.septicPermits && result.septicPermits.length > 0) {
      result.septicPermits.forEach((permit, index) => {
        if (!permit.latitude || !permit.longitude) return;
        
        const position = { lat: permit.latitude, lng: permit.longitude };
        
        // Create circle showing 50ft setback radius around septic
        const circle = new google.maps.Circle({
          map,
          center: position,
          radius: 15.24, // 50 feet in meters
          fillColor: '#F97316', // Orange
          fillOpacity: 0.25,
          strokeColor: '#F97316',
          strokeWeight: 2,
          strokeOpacity: 0.8,
        });
        
        // Create small center marker for clicking
        const marker = new google.maps.Marker({
          map,
          position,
          title: `Septic - ${permit.apn}`,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: '#F97316', // Orange
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        });
        
        // Add info window with septic details
        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div style="padding: 8px; min-width: 180px;">
              <strong style="font-size: 14px; color: #F97316;">🚽 Septic Parcel</strong><br/>
              <b>APN:</b> ${permit.apn}<br/>
              <b>Status:</b> ${permit.designation}<br/>
              <b>Note:</b> Parcel centroid, not tank/leach location<br/>
              ${permit.distance_feet ? `<b>Distance:</b> ${permit.distance_feet.toLocaleString()}ft from subject` : ''}
            </div>
          `,
        });
        
        marker.addListener('click', () => {
          infoWindow.open(map, marker);
        });
        
        // Store both circle and marker for cleanup
        (marker as any)._septicCircle = circle;
        septicPermitMarkersRef.current.push(marker);
      });
    }
  }, [result, showSetbacks, mapReady]); // Include mapReady to trigger when map becomes available

  // Update septic marker and setback circles
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    
    // Clear existing septic marker and circles
    if (septicMarkerRef.current) {
      septicMarkerRef.current.setMap(null);
      septicMarkerRef.current = null;
    }
    setbackCirclesRef.current.forEach(c => c.setMap(null));
    setbackCirclesRef.current = [];
    
    if (septicLocation && showSetbacks) {
      // Add septic marker (using regular Marker)
      const marker = new google.maps.Marker({
        map,
        position: septicLocation,
        title: 'Septic System Location',
        label: {
          text: '🚽',
          fontSize: '18px',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 18,
          fillColor: '#F59E0B',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      });
      
      septicMarkerRef.current = marker;
      
      // Draw setback circles from septic
      // 50ft radius (red dashed)
      const circle50 = new google.maps.Circle({
        center: septicLocation,
        radius: feetToMeters(50),
        strokeColor: '#EF4444',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: '#EF4444',
        fillOpacity: 0.1,
        map,
      });
      setbackCirclesRef.current.push(circle50);
      
      // 100ft radius (orange dashed)
      const circle100 = new google.maps.Circle({
        center: septicLocation,
        radius: feetToMeters(100),
        strokeColor: '#F97316',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: '#F97316',
        fillOpacity: 0.05,
        map,
      });
      setbackCirclesRef.current.push(circle100);
    }
  }, [septicLocation, showSetbacks]);

  // Update proposed well marker
  const wellMarkerRef = useRef<google.maps.Marker | null>(null);
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    
    // Clear existing well marker
    if (wellMarkerRef.current) {
      wellMarkerRef.current.setMap(null);
      wellMarkerRef.current = null;
    }
    
    // Clear existing proposed well setback circle
    if (proposedWellSetbackRef.current) {
      proposedWellSetbackRef.current.setMap(null);
      proposedWellSetbackRef.current = null;
    }
    
    if (wellLocation) {
      // Add proposed well marker (small precise crosshair - blue to match legend)
      const marker = new google.maps.Marker({
        map,
        position: wellLocation,
        title: 'Proposed Well Location',
        icon: {
          path: 'M 0,-8 L 0,8 M -8,0 L 8,0', // Crosshair shape
          scale: 1,
          fillColor: '#3B82F6',
          fillOpacity: 1,
          strokeColor: '#3B82F6',
          strokeWeight: 3,
        },
      });
      
      wellMarkerRef.current = marker;
      
      // Draw setback circles from proposed well if showSetbacks
      if (showSetbacks) {
        // 50ft setback from well (blue to match legend)
        const wellCircle50 = new google.maps.Circle({
          center: wellLocation,
          radius: feetToMeters(50),
          strokeColor: '#3B82F6',
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: '#3B82F6',
          fillOpacity: 0.1,
          map,
        });
        // Store in separate ref so it clears properly when well is removed
        proposedWellSetbackRef.current = wellCircle50;
      }
    }
  }, [wellLocation, showSetbacks]);

  // Update manual well markers (known wells not in DWR)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    
    // Clear existing manual well markers
    manualWellMarkersRef.current.forEach(m => m.setMap(null));
    manualWellMarkersRef.current = [];
    
    // Add markers for each manual well
    manualWells.forEach((well, index) => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: well.lat, lng: well.lng },
        title: `${well.label}${well.depth ? ` - ${well.depth}ft deep` : ''}`,
        label: {
          text: `E${index + 1}`, // E for "Existing"
          color: 'white',
          fontSize: '10px',
          fontWeight: 'bold',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: '#8B5CF6', // Purple for manual/existing wells
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      });
      
      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 8px; min-width: 150px;">
            <strong style="font-size: 14px;">Existing Well (Manual)</strong><br/>
            ${well.depth ? `<b>Depth:</b> ${well.depth}ft<br/>` : ''}
            <b>GPS:</b> ${well.lat.toFixed(6)}, ${well.lng.toFixed(6)}<br/>
            <i style="color: #666; font-size: 11px;">Not in DWR database</i>
          </div>
        `,
      });
      
      marker.addListener('click', () => {
        infoWindow.open(map, marker);
      });
      
      manualWellMarkersRef.current.push(marker);
      
      // Draw 50ft setback circle if showSetbacks
      if (showSetbacks) {
        const circle = new google.maps.Circle({
          center: { lat: well.lat, lng: well.lng },
          radius: feetToMeters(50),
          strokeColor: '#8B5CF6',
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: '#8B5CF6',
          fillOpacity: 0.1,
          map,
        });
        setbackCirclesRef.current.push(circle);
      }
    });
  }, [manualWells, showSetbacks]);

  // Draw property line setback using proper edge offset
  // San Diego: 10ft setback, Riverside: 50ft setback
  function drawPropertyLineSetback(parcelCoords: { lat: number; lng: number }[], map: google.maps.Map) {
    if (parcelCoords.length < 3) return;
    
    // County-specific setback distances (property line setbacks)
    const setbackFeet = PROPERTY_LINE_SETBACK_FT[county];
    // Convert feet to degrees at ~33° latitude (~364000 ft per degree)
    const offsetDeg = setbackFeet / 364000;
    
    // Helper: get perpendicular unit vector (inward) for an edge
    const getInwardNormal = (p1: {lat: number, lng: number}, p2: {lat: number, lng: number}, centroid: {lat: number, lng: number}) => {
      const dx = p2.lng - p1.lng;
      const dy = p2.lat - p1.lat;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) return { lat: 0, lng: 0 };
      
      // Perpendicular vectors (two options)
      const n1 = { lat: dx / len, lng: -dy / len };
      const n2 = { lat: -dx / len, lng: dy / len };
      
      // Pick the one pointing toward centroid (inward)
      const mid = { lat: (p1.lat + p2.lat) / 2, lng: (p1.lng + p2.lng) / 2 };
      const toCentroid = { lat: centroid.lat - mid.lat, lng: centroid.lng - mid.lng };
      const dot1 = n1.lat * toCentroid.lat + n1.lng * toCentroid.lng;
      
      return dot1 > 0 ? n1 : n2;
    };
    
    // Calculate centroid
    const centroid = parcelCoords.reduce(
      (acc, coord) => ({ lat: acc.lat + coord.lat / parcelCoords.length, lng: acc.lng + coord.lng / parcelCoords.length }),
      { lat: 0, lng: 0 }
    );
    
    // Offset each edge inward and find intersections
    const n = parcelCoords.length;
    const offsetEdges: Array<{p1: {lat: number, lng: number}, p2: {lat: number, lng: number}}> = [];
    
    for (let i = 0; i < n; i++) {
      const p1 = parcelCoords[i];
      const p2 = parcelCoords[(i + 1) % n];
      const normal = getInwardNormal(p1, p2, centroid);
      
      offsetEdges.push({
        p1: { lat: p1.lat + normal.lat * offsetDeg, lng: p1.lng + normal.lng * offsetDeg },
        p2: { lat: p2.lat + normal.lat * offsetDeg, lng: p2.lng + normal.lng * offsetDeg }
      });
    }
    
    // Find intersection of consecutive offset edges with bounds checking
    const insetCoords: {lat: number, lng: number}[] = [];
    const maxOffsetDeg = offsetDeg * 3; // Max 3x the setback distance to catch wild points
    
    for (let i = 0; i < n; i++) {
      const edge1 = offsetEdges[i];
      const edge2 = offsetEdges[(i + 1) % n];
      const originalVertex = parcelCoords[(i + 1) % n];
      
      // Line intersection formula
      const x1 = edge1.p1.lng, y1 = edge1.p1.lat;
      const x2 = edge1.p2.lng, y2 = edge1.p2.lat;
      const x3 = edge2.p1.lng, y3 = edge2.p1.lat;
      const x4 = edge2.p2.lng, y4 = edge2.p2.lat;
      
      const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(denom) < 1e-10) {
        // Parallel edges, use endpoint
        insetCoords.push(edge1.p2);
      } else {
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
        const intersection = {
          lng: x1 + t * (x2 - x1),
          lat: y1 + t * (y2 - y1)
        };
        
        // Check if intersection is too far from original vertex (wild corner)
        const dist = Math.sqrt(
          Math.pow(intersection.lat - originalVertex.lat, 2) + 
          Math.pow(intersection.lng - originalVertex.lng, 2)
        );
        
        if (dist < maxOffsetDeg) {
          insetCoords.push(intersection);
        } else {
          // Wild intersection - fall back to simple inward offset from vertex
          const toCenter = {
            lat: (centroid.lat - originalVertex.lat),
            lng: (centroid.lng - originalVertex.lng)
          };
          const toCenterLen = Math.sqrt(toCenter.lat * toCenter.lat + toCenter.lng * toCenter.lng);
          if (toCenterLen > 0) {
            insetCoords.push({
              lat: originalVertex.lat + (toCenter.lat / toCenterLen) * offsetDeg,
              lng: originalVertex.lng + (toCenter.lng / toCenterLen) * offsetDeg
            });
          } else {
            insetCoords.push(edge1.p2);
          }
        }
      }
    }
    
    propertyLineSetbackRef.current = new google.maps.Polygon({
      paths: insetCoords,
      strokeColor: '#3B82F6',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: 'transparent',
      fillOpacity: 0,
      map,
    });
  }

  const handleSearch = async () => {
    if (searchType === 'apn' && !apn.trim()) {
      setError('Please enter an APN');
      return;
    }
    if (searchType === 'address' && !address.trim()) {
      setError('Please enter an address');
      return;
    }
    if (searchType === 'gps' && (!gpsLat.trim() || !gpsLng.trim())) {
      setError('Please enter both latitude and longitude');
      return;
    }

    setIsSearching(true);
    setError(null);
    setResult(null);
    setSaveSuccess(false);
    setSepticLocation(null);
    setWellLocation(null);

    try {
      let lat: number | undefined, lng: number | undefined;
      let searchApn = apn;
      let targetCounty = county;
      
      if (searchType === 'gps') {
        lat = parseFloat(gpsLat);
        lng = parseFloat(gpsLng);
        
        if (isNaN(lat) || isNaN(lng)) {
          setError('Invalid GPS coordinates');
          setIsSearching(false);
          return;
        }
        
        // Auto-detect county
        targetCounty = detectCountyFromCoords(lat, lng);
        setCounty(targetCounty);
        setCoordinates({ lat, lng });
        
        // Center map on coordinates
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setCenter({ lat, lng });
          mapInstanceRef.current.setZoom(17);
        }
      } else if (searchType === 'address') {
        targetCounty = detectCountyFromInput({ address, county: targetCounty });
        setCounty(targetCounty);
        if (isGoogleMapsConfigured()) {
          try {
            await getMapsLibrary();
            const geocoder = new google.maps.Geocoder();
            const geocodeResult = await new Promise<google.maps.GeocoderResult[]>((resolve, reject) => {
              geocoder.geocode({ address: address + ', California' }, (results, status) => {
                if (status === 'OK' && results) {
                  resolve(results);
                } else {
                  reject(new Error('Geocoding failed'));
                }
              });
            });

            if (geocodeResult[0]) {
              lat = geocodeResult[0].geometry.location.lat();
              lng = geocodeResult[0].geometry.location.lng();
              targetCounty = detectCountyFromInput({ lat, lng, address, county: targetCounty });
              setCounty(targetCounty);
              setCoordinates({ lat, lng });

              if (mapInstanceRef.current) {
                mapInstanceRef.current.setCenter({ lat, lng });
                mapInstanceRef.current.setZoom(17);
              }
            }
          } catch {
            // Server geocodes the address if Maps is missing or fails.
          }
        }
      }

      const response = await fetch('/api/permits/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apn: searchApn || undefined,
          address: address || undefined,
          county: targetCounty,
          lat,
          lng,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Research failed');
      }

      setResult(data);
      if (data.county) {
        setCounty(data.county);
      }
      if (data.proposedWell?.lat && data.proposedWell?.lng) {
        setWellLocation({ lat: data.proposedWell.lat, lng: data.proposedWell.lng });
        setCoordinates({ lat: data.proposedWell.lat, lng: data.proposedWell.lng });
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setCenter({ lat: data.proposedWell.lat, lng: data.proposedWell.lng });
          mapInstanceRef.current.setZoom(17);
        }
      } else if (data.searchPoint?.lat && data.searchPoint?.lng) {
        setCoordinates({ lat: data.searchPoint.lat, lng: data.searchPoint.lng });
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setCenter(data.searchPoint);
          mapInstanceRef.current.setZoom(17);
        }
      }
      
      // Pre-fill permit form with parcel address
      if (data.parcel?.siteAddress) {
        setPermitFormData(prev => ({
          ...prev,
          customerAddress: data.parcel.siteAddress,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSaveReport = async () => {
    if (!result) return;
    
    setIsSaving(true);
    try {
      const response = await fetch('/api/permits/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apn: result.parcel?.apn || apn,
          address: result.parcel?.siteAddress || address,
          county,
          parcel_info: result.parcel,
          wells_info: result.wells,
          septic_info: result.septic,
          zoning_info: result.zoning,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to save report');
      }
      
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save report');
    } finally {
      setIsSaving(false);
    }
  };

  // Export a to-scale DEH plot plan (parcel / wells / septic). Does not screenshot Maps.
  const handleExportPlotMap = async () => {
    if (!result) return;
    
    setIsExportingPdf(true);
    
    try {
      const response = await fetch('/api/permits/plot-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result,
          proposedWell: wellLocation || result.proposedWell || null,
          manualSeptic: septicLocation,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Plot plan export failed');
      }

      const blob = await response.blob();
      const filename = `PlotPlan_${result.parcel?.apn?.replace(/-/g, '') || 'property'}_${new Date().toISOString().split('T')[0]}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      
    } catch (err) {
      console.error('PDF export error:', err);
      setError(err instanceof Error ? err.message : 'Failed to export plot plan. Please try again.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Generate Permit Application PDF - fills actual county form
  const handleGeneratePermit = async (useOfficialForm: boolean = true) => {
    if (!result) return;
    
    setIsGeneratingPermit(true);
    
    try {
      if (useOfficialForm) {
        // Use API to fill actual county permit form
        const response = await fetch('/api/permits/generate-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            county,
            owner: {
              name: permitFormData.customerName || result.parcel?.ownerName || '',
              address: permitFormData.customerAddress?.split(',')[0] || result.parcel?.ownerAddress || '',
              city: permitFormData.customerAddress?.split(',')[1]?.trim() || result.parcel?.siteAddress?.split(',')[1]?.trim() || '',
              state: 'CA',
              zip: permitFormData.customerAddress?.match(/\d{5}/)?.[0] || '',
              phone: permitFormData.customerPhone || '',
              email: permitFormData.customerEmail || '',
            },
            property: {
              apn: result.parcel?.apn || '',
              siteAddress: result.parcel?.siteAddress?.split(',')[0] || '',
              city: result.parcel?.siteAddress?.split(',')[1]?.trim() || '',
              state: 'CA',
              zip: result.parcel?.siteAddress?.match(/\d{5}/)?.[0] || '',
              latitude: coordinates?.lat?.toFixed(6) || '',
              longitude: coordinates?.lng?.toFixed(6) || '',
            },
            proposedWell: {
              purpose: permitFormData.purpose === 'Domestic' ? 'domestic_drinking' : 
                       permitFormData.purpose === 'Irrigation' ? 'irrigation' :
                       permitFormData.purpose === 'Industrial' ? 'industrial' : 'other',
              purposeOther: permitFormData.purpose,
              workType: 'new',
              depth: permitFormData.proposedDepth,
              boreholeDiameter: permitFormData.proposedDiameter,
            },
          }),
        });
        
        if (!response.ok) {
          throw new Error('Failed to generate permit form');
        }
        
        // Download the PDF
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${county}-well-permit-${result.parcel?.apn?.replace(/-/g, '') || 'application'}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        setShowPermitForm(false);
        return;
      }
      
      // Fallback: Generate summary PDF with jsPDF
      const pdf = new jsPDF('portrait', 'mm', 'letter');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      
      // Header
      pdf.setFillColor(16, 185, 129);
      pdf.rect(0, 0, pageWidth, 30, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(20);
      pdf.setFont('helvetica', 'bold');
      pdf.text('WELL PERMIT APPLICATION', pageWidth / 2, 15, { align: 'center' });
      pdf.setFontSize(12);
      pdf.text(`${county === 'san_diego' ? 'San Diego' : 'Riverside'} County`, pageWidth / 2, 24, { align: 'center' });
      
      let yPos = 45;
      
      // Contractor Information Section
      pdf.setTextColor(31, 41, 55);
      pdf.setFillColor(243, 244, 246);
      pdf.rect(15, yPos - 5, pageWidth - 30, 8, 'F');
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('CONTRACTOR INFORMATION', 20, yPos);
      yPos += 10;
      
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Company: Southern California Well Service', 20, yPos);
      yPos += 6;
      pdf.text('License: C-57 #1086994', 20, yPos);
      yPos += 6;
      pdf.text('Phone: (760) 440-8520', 20, yPos);
      yPos += 15;
      
      // Property Owner Section
      pdf.setFillColor(243, 244, 246);
      pdf.rect(15, yPos - 5, pageWidth - 30, 8, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text('PROPERTY OWNER / APPLICANT', 20, yPos);
      yPos += 10;
      
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Name: ${permitFormData.customerName || result.parcel?.ownerName || '_________________________'}`, 20, yPos);
      yPos += 6;
      pdf.text(`Address: ${permitFormData.customerAddress || result.parcel?.siteAddress || '_________________________'}`, 20, yPos);
      yPos += 6;
      pdf.text(`Phone: ${permitFormData.customerPhone || '_________________________'}`, 20, yPos);
      pdf.text(`Email: ${permitFormData.customerEmail || '_________________________'}`, 110, yPos);
      yPos += 15;
      
      // Property Information Section
      pdf.setFillColor(243, 244, 246);
      pdf.rect(15, yPos - 5, pageWidth - 30, 8, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text('PROPERTY INFORMATION', 20, yPos);
      yPos += 10;
      
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`APN: ${result.parcel?.apn || '_________________________'}`, 20, yPos);
      pdf.text(`County: ${county === 'san_diego' ? 'San Diego' : 'Riverside'}`, 110, yPos);
      yPos += 6;
      pdf.text(`Site Address: ${result.parcel?.siteAddress || '_________________________'}`, 20, yPos);
      yPos += 6;
      pdf.text(`Lot Size: ${result.parcel?.lotSizeAcres ? result.parcel.lotSizeAcres.toFixed(2) + ' acres' : '_________'}`, 20, yPos);
      pdf.text(`Zoning: ${result.parcel?.zoning || result.zoning?.designation || '_________'}`, 110, yPos);
      yPos += 15;
      
      // Proposed Well Information Section
      pdf.setFillColor(243, 244, 246);
      pdf.rect(15, yPos - 5, pageWidth - 30, 8, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text('PROPOSED WELL INFORMATION', 20, yPos);
      yPos += 10;
      
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Proposed Depth: ${permitFormData.proposedDepth || '_______'} feet`, 20, yPos);
      pdf.text(`Casing Diameter: ${permitFormData.proposedDiameter || '_______'} inches`, 110, yPos);
      yPos += 6;
      pdf.text(`Intended Use: ${permitFormData.purpose || '_________________________'}`, 20, yPos);
      yPos += 6;
      pdf.text(`Location on Parcel: ${permitFormData.locationOnParcel || '_________________________'}`, 20, yPos);
      yPos += 15;
      
      // Existing Wells Section
      pdf.setFillColor(243, 244, 246);
      pdf.rect(15, yPos - 5, pageWidth - 30, 8, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text('EXISTING WELLS ON PROPERTY / NEARBY', 20, yPos);
      yPos += 10;
      
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      if (result.wells.length > 0) {
        result.wells.slice(0, 5).forEach((well, i) => {
          pdf.text(`${i + 1}. WCR #${well.wcr_number} - Depth: ${well.total_completed_depth || 'N/A'}ft, Use: ${well.well_use || 'N/A'}`, 25, yPos);
          yPos += 5;
        });
        if (result.wells.length > 5) {
          pdf.text(`... and ${result.wells.length - 5} more wells within 1 mile`, 25, yPos);
          yPos += 5;
        }
      } else {
        pdf.text('No existing wells found within 1 mile radius', 25, yPos);
        yPos += 5;
      }
      yPos += 10;
      
      // Setback Distances Section
      pdf.setFillColor(243, 244, 246);
      pdf.rect(15, yPos - 5, pageWidth - 30, 8, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text('REQUIRED SETBACK DISTANCES', 20, yPos);
      yPos += 10;
      
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      const setbacks = [
        ['From Septic Tank', '50 feet minimum'],
        ['From Septic Leach Field', '100 feet minimum'],
        ['From Property Lines', '50 feet minimum (may vary)'],
        ['From Buildings', 'Per local requirements'],
        ['From Existing Wells', '50-100 feet recommended'],
      ];
      setbacks.forEach(([item, distance]) => {
        pdf.text(`• ${item}:`, 25, yPos);
        pdf.text(distance, 85, yPos);
        yPos += 5;
      });
      yPos += 10;
      
      // Signature Section
      pdf.setDrawColor(156, 163, 175);
      pdf.line(20, yPos + 15, 90, yPos + 15);
      pdf.line(110, yPos + 15, 180, yPos + 15);
      pdf.setFontSize(9);
      pdf.text('Property Owner Signature', 35, yPos + 20);
      pdf.text('Date', 140, yPos + 20);
      
      yPos += 30;
      pdf.line(20, yPos + 15, 90, yPos + 15);
      pdf.line(110, yPos + 15, 180, yPos + 15);
      pdf.text('Contractor Signature', 38, yPos + 20);
      pdf.text('Date', 140, yPos + 20);
      
      // Footer
      pdf.setFontSize(8);
      pdf.setTextColor(156, 163, 175);
      pdf.text('Form prepared by Southern California Well Service | (760) 440-8520', pageWidth / 2, pageHeight - 15, { align: 'center' });
      pdf.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
      
      // Download
      const filename = `WellPermit_${result.parcel?.apn?.replace(/-/g, '') || 'application'}_${new Date().toISOString().split('T')[0]}.pdf`;
      pdf.save(filename);
      
      setShowPermitForm(false);
    } catch (err) {
      console.error('Permit generation error:', err);
      setError('Failed to generate permit application. Please try again.');
    } finally {
      setIsGeneratingPermit(false);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const formatAPN = (value: string) => {
    const digits = value.replace(/\D/g, '');
    let formatted = '';
    if (digits.length > 0) formatted += digits.slice(0, 3);
    if (digits.length > 3) formatted += '-' + digits.slice(3, 6);
    if (digits.length > 6) formatted += '-' + digits.slice(6, 8);
    if (digits.length > 8) formatted += '-' + digits.slice(8, 10);
    return formatted;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Permit Research Tool</h1>
        <p className="text-gray-500">Paste a Ramona or Anza street address for a DEH office SITE PLAN: parcel, buildings, aerial, DEH as-built when traced, and a proposed-well pin that is never the parcel centroid.</p>
      </div>

      {/* Search Panel */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="space-y-4">
          {/* Search Type Toggle */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSearchType('address')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                searchType === 'address' 
                  ? 'bg-green-100 text-green-700 border border-green-200' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <MapPin className="h-4 w-4 inline mr-1.5" />
              Search by Address
            </button>
            <button
              onClick={() => setSearchType('apn')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                searchType === 'apn' 
                  ? 'bg-green-100 text-green-700 border border-green-200' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <FileText className="h-4 w-4 inline mr-1.5" />
              Search by APN
            </button>
            <button
              onClick={() => setSearchType('gps')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                searchType === 'gps' 
                  ? 'bg-green-100 text-green-700 border border-green-200' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Target className="h-4 w-4 inline mr-1.5" />
              GPS Coordinates
            </button>
          </div>

          {/* Search Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {searchType === 'address' && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Property Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Main St, Escondido, CA 92025"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
            )}
            
            {searchType === 'apn' && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Assessor Parcel Number (APN)
                </label>
                <input
                  type="text"
                  value={apn}
                  onChange={(e) => setApn(formatAPN(e.target.value))}
                  placeholder="XXX-XXX-XX-XX"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
            )}
            
            {searchType === 'gps' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
                  <input
                    type="text"
                    value={gpsLat}
                    onChange={(e) => setGpsLat(e.target.value)}
                    placeholder="33.1234"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
                  <input
                    type="text"
                    value={gpsLng}
                    onChange={(e) => setGpsLng(e.target.value)}
                    placeholder="-116.5678"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                </div>
              </>
            )}

            {searchType !== 'gps' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">County (auto from address)</label>
                <select
                  value={county}
                  onChange={(e) => setCounty(e.target.value as County)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                >
                  {COUNTY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}
            
            {searchType === 'gps' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">County (auto-detected)</label>
                <div className="px-4 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-600">
                  {COUNTY_LABEL[county]}
                </div>
              </div>
            )}
          </div>

          {/* Search Button */}
          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={handleSearch}
              disabled={isSearching}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {isSearching ? 'Searching...' : 'Search Property'}
            </button>

            {result && (
              <>
                <button
                  onClick={handleSaveReport}
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : saveSuccess ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {saveSuccess ? 'Saved!' : 'Save Report'}
                </button>
                
                <button
                  onClick={handleExportPlotMap}
                  disabled={isExportingPdf}
                  className="inline-flex items-center gap-2 px-4 py-2.5 border border-blue-300 text-blue-700 rounded-lg font-medium hover:bg-blue-50 disabled:opacity-50 transition-colors"
                >
                  {isExportingPdf ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Export Plot Plan
                </button>
                
                <button
                  onClick={() => setShowPermitForm(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 border border-purple-300 text-purple-700 rounded-lg font-medium hover:bg-purple-50 transition-colors"
                >
                  <FileCheck className="h-4 w-4" />
                  Generate Permit Application
                </button>
              </>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Data Sources Status */}
          {result && (
            <div className="flex flex-wrap gap-2 pt-2">
              {result.sources.map((source, i) => (
                <span
                  key={i}
                  title={source.message || source.status}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                    source.status === 'success'
                      ? 'bg-green-100 text-green-700'
                      : source.status === 'missing' || source.status === 'mock'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {source.status === 'success' ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : source.status === 'missing' || source.status === 'mock' ? (
                    <Info className="h-3 w-3" />
                  ) : (
                    <AlertCircle className="h-3 w-3" />
                  )}
                  {source.name}
                </span>
              ))}
              {result.cached && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                  Cached Result
                </span>
              )}
            </div>
          )}
          {result?.notes && result.notes.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              {result.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Coverage Alert Banner */}
      {utilityCoverage && !utilityCoverage.hasCoverage && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-6 w-6 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-800">Limited Utility Data Available</h3>
              <p className="text-amber-700 mt-1">{utilityCoverage.recommendation}</p>
              {utilityCoverage.note && (
                <p className="text-sm text-amber-600 mt-1">{utilityCoverage.note}</p>
              )}
              {utilityCoverage.call811 && (
                <div className="mt-3 flex items-center gap-3">
                  <a
                    href="tel:811"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors"
                  >
                    📞 Call 811
                  </a>
                  <a
                    href="https://call811.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-700 hover:text-amber-800 underline text-sm"
                  >
                    call811.com
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Utility Coverage Info */}
      {utilityCoverage && utilityCoverage.hasCoverage && utilityFeatures.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-green-800">Utility Data Available</h3>
                <span className="text-sm text-green-600">
                  {utilityFeatures.length} features within 500m
                </span>
              </div>
              <p className="text-sm text-green-700 mt-1">
                {utilityCoverage.availableTypes.join(', ')} data available for {utilityCoverage.county} County.
                {utilityCoverage.missingTypes.length > 0 && (
                  <span className="text-amber-600"> Missing: {utilityCoverage.missingTypes.join(', ')}</span>
                )}
              </p>
              <p className="text-xs text-green-600 mt-1">
                Always verify with 811 before excavation for safety.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Results Grid */}
      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Map with Setbacks */}
          <div className="lg:col-span-2" ref={mapContainerRef}>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
                <h3 className="font-semibold text-gray-900">Property Map with Setbacks</h3>
                <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 bg-green-500/30 border-2 border-green-500 rounded"></span>
                    Parcel
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                    Well
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 bg-amber-500 rounded"></span>
                    Septic
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 border-2 border-red-500 rounded-full"></span>
                    50ft well setback
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 border-2 border-orange-500 rounded-full"></span>
                    100ft septic setback
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-0 border border-blue-500"></span>
                    {PROPERTY_LINE_SETBACK_FT[result.county || county]}ft property setback
                  </span>
                </div>
              </div>
              
              {/* Map Controls */}
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showSetbacks}
                    onChange={(e) => setShowSetbacks(e.target.checked)}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  Show Setbacks
                </label>
                
                <button
                  onClick={() => {
                    setIsPlacingSeptic(true);
                    isPlacingSepticRef.current = true;
                    setIsPlacingWell(false);
                    isPlacingWellRef.current = false;
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    isPlacingSeptic 
                      ? 'bg-amber-100 text-amber-700 border border-amber-300' 
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <CircleDot className="h-4 w-4" />
                  {isPlacingSeptic ? 'Click map to place septic...' : 'Place Septic Location'}
                </button>
                
                {septicLocation && (
                  <button
                    onClick={() => setSepticLocation(null)}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    Clear Septic
                  </button>
                )}
                
                <button
                  onClick={() => {
                    setIsPlacingWell(true);
                    isPlacingWellRef.current = true;
                    setIsPlacingSeptic(false);
                    isPlacingSepticRef.current = false;
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    isPlacingWell 
                      ? 'bg-green-100 text-green-700 border border-green-300' 
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <Target className="h-4 w-4" />
                  {isPlacingWell ? 'Click map to place well...' : 'Place Well Location'}
                </button>
                
                {wellLocation && (
                  <button
                    onClick={() => setWellLocation(null)}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    Clear Well
                  </button>
                )}
                
                {/* Manual/Existing Wells */}
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => {
                    setIsPlacingManualWell(true);
                    setIsPlacingSeptic(false);
                    setIsPlacingWell(false);
                  }}
                  className={`flex items-center gap-1 px-3 py-1 border rounded text-sm ${
                    isPlacingManualWell 
                      ? 'bg-purple-100 border-purple-500 text-purple-700' 
                      : 'border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <CircleDot className="h-3 w-3" />
                  {isPlacingManualWell ? 'Click map...' : 'Add Existing Well'}
                </button>
                
                {/* Utility Layer Toggles */}
                <span className="text-gray-300">|</span>
                <span className="text-xs text-gray-500 uppercase tracking-wider">Utilities:</span>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={utilityLayers.sewer}
                    onChange={(e) => setUtilityLayers(prev => ({ ...prev, sewer: e.target.checked }))}
                    className="rounded border-gray-300 text-amber-800 focus:ring-amber-600"
                  />
                  <span className="w-2 h-2 rounded" style={{ backgroundColor: UTILITY_COLORS.sewer }}></span>
                  Sewer
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={utilityLayers.water}
                    onChange={(e) => setUtilityLayers(prev => ({ ...prev, water: e.target.checked }))}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="w-2 h-2 rounded" style={{ backgroundColor: UTILITY_COLORS.water }}></span>
                  Water
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={utilityLayers.storm}
                    onChange={(e) => setUtilityLayers(prev => ({ ...prev, storm: e.target.checked }))}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className="w-2 h-2 rounded" style={{ backgroundColor: UTILITY_COLORS.storm }}></span>
                  Storm
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={utilityLayers.electric}
                    onChange={(e) => setUtilityLayers(prev => ({ ...prev, electric: e.target.checked }))}
                    className="rounded border-gray-300 text-yellow-600 focus:ring-yellow-500"
                  />
                  <span className="w-2 h-2 rounded" style={{ backgroundColor: UTILITY_COLORS.electric }}></span>
                  Electric
                </label>
                {isLoadingUtilities && (
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading utilities...
                  </span>
                )}
                
                {manualWells.length > 0 && (
                  <button
                    onClick={() => setManualWells([])}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    Clear ({manualWells.length})
                  </button>
                )}
                
                {/* North Arrow */}
                <div className="ml-auto flex items-center gap-2 text-gray-500">
                  <Navigation className="h-5 w-5 transform rotate-0" />
                  <span className="text-xs font-medium">N</span>
                </div>
              </div>
              
              <div className="relative">
                <div 
                  ref={mapRef} 
                  className="h-[500px] w-full bg-gray-100"
                  onClick={(e) => {
                    // Fallback click handler for placement
                    if (!mapInstanceRef.current) return;
                    if (!isPlacingSeptic && !isPlacingWell && !isPlacingManualWell) return;
                    
                    const map = mapInstanceRef.current;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    
                    // Convert pixel to lat/lng
                    const bounds = map.getBounds();
                    const ne = bounds?.getNorthEast();
                    const sw = bounds?.getSouthWest();
                    if (!ne || !sw) return;
                    
                    const lat = ne.lat() - (y / rect.height) * (ne.lat() - sw.lat());
                    const lng = sw.lng() + (x / rect.width) * (ne.lng() - sw.lng());
                    
                    if (isPlacingSeptic) {
                      setSepticLocation({ lat, lng });
                      setIsPlacingSeptic(false);
                    }
                    if (isPlacingWell) {
                      setWellLocation({ lat, lng });
                      setIsPlacingWell(false);
                    }
                    if (isPlacingManualWell) {
                      setManualWells(prev => [...prev, { lat, lng, label: `Manual ${prev.length + 1}` }]);
                      setIsPlacingManualWell(false);
                    }
                  }}
                  style={{ cursor: (isPlacingSeptic || isPlacingWell || isPlacingManualWell) ? 'crosshair' : undefined }}
                />
                
                {/* Scale Bar Overlay */}
                <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded px-3 py-2 shadow-lg">
                  <div className="flex items-end gap-1">
                    <div className="border-l-2 border-b-2 border-r-2 border-gray-800 w-16 h-2"></div>
                    <span className="text-xs font-medium text-gray-700">~200ft</span>
                  </div>
                </div>
                
                {/* North Arrow Overlay */}
                <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm rounded-full p-2 shadow-lg">
                  <div className="relative w-8 h-8">
                    <Navigation className="h-8 w-8 text-gray-800" />
                    <span className="absolute -top-1 left-1/2 transform -translate-x-1/2 text-[10px] font-bold text-gray-800">N</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Parcel Information */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <button
              onClick={() => toggleSection('parcel')}
              className="w-full px-4 py-3 border-b border-gray-200 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-green-600" />
                <h3 className="font-semibold text-gray-900">Parcel Information</h3>
              </div>
              {expandedSections.parcel ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {expandedSections.parcel && (
              <div className="p-4 space-y-4">
                {result.parcel ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs text-gray-500 uppercase tracking-wider">APN</label>
                        <p className="font-mono font-medium text-gray-900">{result.parcel.apn}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 uppercase tracking-wider">Lot Size</label>
                        <p className="font-medium text-gray-900">
                          {result.parcel.lotSizeAcres 
                            ? `${result.parcel.lotSizeAcres.toFixed(2)} acres` 
                            : result.parcel.lotSizeSqFt 
                            ? `${result.parcel.lotSizeSqFt.toLocaleString()} sq ft`
                            : '—'}
                        </p>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1">
                        <User className="h-3 w-3" /> Owner
                      </label>
                      <p className="font-medium text-gray-900">
                        {result.parcel.ownerName || 'Unknown (not published on public GIS)'}
                      </p>
                      <p className="text-sm text-gray-500">
                        {result.parcel.ownerAddress || 'Unknown'}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1">
                        <Home className="h-3 w-3" /> Site Address
                      </label>
                      <p className="font-medium text-gray-900">{result.parcel.siteAddress || '—'}</p>
                    </div>
                  </>
                ) : (
                  <p className="text-gray-500 text-center py-4">No parcel data found</p>
                )}
              </div>
            )}
          </div>

          {/* Wells Information */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <button
              onClick={() => toggleSection('wells')}
              className="w-full px-4 py-3 border-b border-gray-200 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Droplets className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold text-gray-900">
                  Nearby Wells
                  {result.wells.length > 0 && (
                    <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                      {result.wells.length}
                    </span>
                  )}
                </h3>
              </div>
              {expandedSections.wells ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {expandedSections.wells && (
              <div className="p-4">
                {result.wells.length > 0 ? (
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {result.wells.map((well, i) => (
                      <div key={i} className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-5 h-5 bg-blue-500 text-white rounded-full text-xs flex items-center justify-center font-bold">
                              {i + 1}
                            </span>
                            <span className="font-mono text-sm font-medium">WCR #{well.wcr_number}</span>
                          </span>
                          <div className="flex items-center gap-2">
                            {well.distance_from_parcel && (
                              <span className="text-xs text-blue-600 font-medium">
                                {well.distance_from_parcel.toLocaleString()}ft
                              </span>
                            )}
                            {well.date_work_ended && (
                              <span className="text-xs text-gray-500 flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {well.date_work_ended}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div>
                            <span className="text-gray-500 text-xs">Depth</span>
                            <p className="font-medium">{well.total_completed_depth ? `${well.total_completed_depth} ft` : '—'}</p>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Static Level</span>
                            <p className="font-medium">{well.static_water_level ? `${well.static_water_level} ft` : '—'}</p>
                          </div>
                          <div>
                            <span className="text-gray-500 text-xs">Use</span>
                            <p className="font-medium truncate">{well.well_use || '—'}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-4">
                    No DWR wells returned. If the source is down, that is an honest GIS miss — locations were not invented.
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-3">
                  Data from CA DWR Well Completion Reports. Wells shown within 1 mile radius.
                </p>
              </div>
            )}
          </div>

          {/* Septic System */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <button
              onClick={() => toggleSection('septic')}
              className="w-full px-4 py-3 border-b border-gray-200 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="h-5 w-5 text-amber-600">🚽</div>
                <h3 className="font-semibold text-gray-900">
                  Septic System
                  {result.septicPermits && result.septicPermits.length > 0 && (
                    <span className="ml-2 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full">
                      {result.septicPermits.length} nearby
                    </span>
                  )}
                </h3>
              </div>
              {expandedSections.septic ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {expandedSections.septic && (
              <div className="p-4 space-y-4">
                {/* Property Designation */}
                {result.septic?.status === 'found' ? (
                  <div className={`p-4 rounded-lg border ${
                    result.septic.type === 'SEPTIC' 
                      ? 'bg-orange-50 border-orange-200' 
                      : result.septic.type === 'SEWER'
                      ? 'bg-blue-50 border-blue-200'
                      : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-lg ${result.septic.type === 'SEPTIC' ? 'text-orange-600' : 'text-blue-600'}`}>
                        {result.septic.type === 'SEPTIC' ? '🚽' : '🏭'}
                      </span>
                      <span className={`font-semibold ${
                        result.septic.type === 'SEPTIC' ? 'text-orange-800' : 'text-blue-800'
                      }`}>
                        This Property: {result.septic.type}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{result.septic.designation}</p>
                    <p className="text-xs text-gray-500 mt-1">Source: {result.septic.source}</p>
                  </div>
                ) : result.septic?.status === 'missing' || result.septic?.status === 'mock' ? (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex items-start gap-3">
                      <Info className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-yellow-800">Septic / sewer not in SCWS GIS</p>
                        <p className="text-sm text-yellow-700 mt-1">{result.septic.message}</p>
                        <p className="text-xs text-yellow-700 mt-2">
                          Tank and leach-field points are not invented. Place one on the map only if the office has a record or a site visit.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
                
                {/* Nearby Septic Parcels */}
                {result.septicPermits && result.septicPermits.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      Nearby septic parcels (centroids, not tank/leach geometry)
                    </h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {result.septicPermits.slice(0, 10).map((permit, i) => (
                        <div key={i} className="p-2 bg-orange-50 rounded border border-orange-100 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs text-gray-600">{permit.apn}</span>
                            {permit.distance_feet && (
                              <span className="text-xs text-orange-600 font-medium">
                                {permit.distance_feet.toLocaleString()}ft away
                              </span>
                            )}
                          </div>
                          {permit.full_address && (
                            <p className="text-xs text-gray-500 truncate">{permit.full_address}</p>
                          )}
                        </div>
                      ))}
                      {result.septicPermits.length > 10 && (
                        <p className="text-xs text-gray-500 text-center py-1">
                          +{result.septicPermits.length - 10} more septic parcels
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-orange-600 mt-2">
                      🔶 Orange markers are parcel centroids — tank and leach locations are unknown unless placed by the office
                    </p>
                  </div>
                )}
                
                {(result.dehDocuments || []).length > 0 && (
                  <div className="pt-2 border-t border-gray-200">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">DEH Document Library</h4>
                    <div className="space-y-2">
                      {result.dehDocuments!.map((doc) => (
                        <div key={doc.fileRecordId} className="p-2 bg-slate-50 rounded border border-slate-200 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs">FileRecordId {doc.fileRecordId}</span>
                            <a href={doc.viewUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
                              Open viewer
                            </a>
                          </div>
                          <p className="text-xs text-gray-600">{doc.subcategory || 'DEH-LWQD'}{doc.permitId ? ` · ${doc.permitId}` : ''}</p>
                          <p className="text-xs text-amber-700 mt-1">{doc.note}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(result.neighbors || []).length > 0 && (
                  <div className="pt-2 border-t border-gray-200">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Neighbor septic (250 ft / adjacent)</h4>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {result.neighbors!.slice(0, 12).map((n) => (
                        <div key={n.apn} className="text-xs flex justify-between gap-2">
                          <span className="font-mono">{n.apn}</span>
                          <span className="text-gray-600">
                            {n.tankLeach === 'as_built_extracted'
                              ? 'as-built traced onto GIS'
                              : n.tankLeach === 'as_built_on_file'
                              ? 'as-built on file, geometry not extracted'
                              : n.septicFlag || n.tankLeach}
                            {n.distanceFt != null ? ` · ${n.distanceFt} ft` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tip for manual placement */}
                <div className="pt-2 border-t border-gray-200">
                  <p className="text-xs text-gray-500">
                    <strong>Tip:</strong> Tank/leach are never invented. Place a septic mark only when the office has an as-built or a site visit.
                  </p>
                </div>
              </div>
            )}
          </div>

          {result.proposedWell && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 mb-2">Proposed well pin</h3>
              <p className="text-sm text-gray-700">
                {result.proposedWell.meetsSetbacks
                  ? 'Maximin to leach / tank / existing well on a grid. This is not the parcel centroid.'
                  : 'FLAG: no pocket meets 100 ft leach. Best available pin — not the parcel centroid.'}
              </p>
              <p className="font-mono text-xs text-gray-600 mt-2">
                {result.proposedWell.lat.toFixed(8)}, {result.proposedWell.lng.toFixed(8)} · {result.proposedWell.source}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
                <div>PL: {result.proposedWell.distances.propertyLineFt ?? '—'} ft</div>
                <div>Tank: {result.proposedWell.distances.tankFt ?? 'unknown'} ft</div>
                <div>Leach: {result.proposedWell.distances.leachFt ?? 'unknown'} ft</div>
                <div>Existing well: {result.proposedWell.distances.existingWellFt ?? '—'} ft</div>
              </div>
              {result.proposedWell.flags.length > 0 && (
                <ul className="mt-2 text-xs text-amber-800 list-disc pl-4">
                  {result.proposedWell.flags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-gray-500 mt-2">
                CNRA WCR within 250 ft: {result.wellsWithin250Ft === 0 ? '0 (NONE)' : result.wellsWithin250Ft ?? '—'}
              </p>
            </div>
          )}

          {/* Zoning */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <button
              onClick={() => toggleSection('zoning')}
              className="w-full px-4 py-3 border-b border-gray-200 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Ruler className="h-5 w-5 text-purple-600" />
                <h3 className="font-semibold text-gray-900">Zoning & Land Use</h3>
              </div>
              {expandedSections.zoning ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {expandedSections.zoning && (
              <div className="p-4">
                {result.zoning ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs text-gray-500 uppercase tracking-wider">Zoning Designation</label>
                        <p className="font-medium text-gray-900">{result.zoning.designation || '—'}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 uppercase tracking-wider">Land Use Code</label>
                        <p className="font-medium text-gray-900">{result.zoning.landUse || '—'}</p>
                      </div>
                    </div>
                    {result.zoning.note && (
                      <p className="text-xs text-gray-500 flex items-start gap-1.5 p-2 bg-gray-50 rounded">
                        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                        {result.zoning.note}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-4">No zoning data available</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!result && !isSearching && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-12 text-center">
          <Search className="h-12 w-12 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Search for a Property</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            Enter an address, APN, or GPS coordinates to look up parcel information, nearby wells, septic systems, and zoning data.
          </p>
        </div>
      )}

      {/* Permit Application Modal */}
      {showPermitForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-xl font-bold text-gray-900">Generate Permit Application</h2>
              <button
                onClick={() => setShowPermitForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Proposed Well Info */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Proposed Well Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Proposed Depth (ft)</label>
                    <input
                      type="text"
                      value={permitFormData.proposedDepth}
                      onChange={(e) => setPermitFormData(prev => ({ ...prev, proposedDepth: e.target.value }))}
                      placeholder="e.g., 400"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Casing Diameter (inches)</label>
                    <select
                      value={permitFormData.proposedDiameter}
                      onChange={(e) => setPermitFormData(prev => ({ ...prev, proposedDiameter: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    >
                      <option value="4">4"</option>
                      <option value="5">5"</option>
                      <option value="6">6"</option>
                      <option value="8">8"</option>
                      <option value="10">10"</option>
                      <option value="12">12"</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Intended Use</label>
                    <select
                      value={permitFormData.purpose}
                      onChange={(e) => setPermitFormData(prev => ({ ...prev, purpose: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    >
                      <option value="Domestic">Domestic</option>
                      <option value="Irrigation">Irrigation</option>
                      <option value="Agricultural">Agricultural</option>
                      <option value="Industrial">Industrial</option>
                      <option value="Municipal">Municipal</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Location on Parcel</label>
                    <input
                      type="text"
                      value={permitFormData.locationOnParcel}
                      onChange={(e) => setPermitFormData(prev => ({ ...prev, locationOnParcel: e.target.value }))}
                      placeholder="e.g., Southeast corner, 100ft from house"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>
              
              {/* Customer Info */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Customer Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name</label>
                    <input
                      type="text"
                      value={permitFormData.customerName}
                      onChange={(e) => setPermitFormData(prev => ({ ...prev, customerName: e.target.value }))}
                      placeholder={result?.parcel?.ownerName || 'Full name'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Mailing Address</label>
                    <input
                      type="text"
                      value={permitFormData.customerAddress}
                      onChange={(e) => setPermitFormData(prev => ({ ...prev, customerAddress: e.target.value }))}
                      placeholder={result?.parcel?.siteAddress || 'Full address'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={permitFormData.customerPhone}
                      onChange={(e) => setPermitFormData(prev => ({ ...prev, customerPhone: e.target.value }))}
                      placeholder="(760) 555-0100"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={permitFormData.customerEmail}
                      onChange={(e) => setPermitFormData(prev => ({ ...prev, customerEmail: e.target.value }))}
                      placeholder="customer@email.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>
              
              {/* Property Summary (read-only) */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Property Summary (from research)</h3>
                <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                  <p><strong>APN:</strong> {result?.parcel?.apn || 'N/A'}</p>
                  <p><strong>Address:</strong> {result?.parcel?.siteAddress || 'N/A'}</p>
                  <p><strong>Lot Size:</strong> {result?.parcel?.lotSizeAcres ? `${result.parcel.lotSizeAcres.toFixed(2)} acres` : 'N/A'}</p>
                  <p><strong>Zoning:</strong> {result?.parcel?.zoning || result?.zoning?.designation || 'N/A'}</p>
                  <p><strong>Nearby Wells:</strong> {result?.wells.length || 0} found within 1 mile</p>
                </div>
              </div>
              
              {/* Contractor Info (pre-filled) */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Contractor (SCWS)</h3>
                <div className="bg-green-50 rounded-lg p-4 space-y-1 text-sm">
                  <p><strong>Company:</strong> Southern California Well Service</p>
                  <p><strong>License:</strong> C-57 #1086994</p>
                  <p><strong>Phone:</strong> (760) 440-8520</p>
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-gray-200 sticky bottom-0 bg-white">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Generate:</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowPermitForm(false)}
                      className="px-4 py-2 text-gray-700 hover:text-gray-900"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleGeneratePermit(true)}
                    disabled={isGeneratingPermit}
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    {isGeneratingPermit ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                    <div className="text-left">
                      <div className="font-semibold">Official County Form</div>
                      <div className="text-xs opacity-80">Auto-fill DEH permit application</div>
                    </div>
                  </button>
                  <button
                    onClick={() => handleGeneratePermit(false)}
                    disabled={isGeneratingPermit}
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    {isGeneratingPermit ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    <div className="text-left">
                      <div className="font-semibold">Summary PDF</div>
                      <div className="text-xs text-gray-500">SCWS formatted summary</div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Info Banner */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
        <div className="flex gap-3">
          <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Data Sources</p>
            <ul className="list-disc list-inside space-y-0.5 text-blue-700">
              <li><strong>Parcel Data:</strong> San Diego County GIS, Riverside County GIS (real-time)</li>
              <li><strong>Well Data:</strong> California DWR Well Completion Reports (real-time)</li>
              <li><strong>Septic Data:</strong> Requires manual lookup with County DEH</li>
              <li><strong>Zoning:</strong> From County Assessor data - verify with local planning for official zoning</li>
              <li><strong>Utilities:</strong> City of San Diego, City of Riverside, CA Energy Commission - <em className="text-blue-600">always call 811 before excavation</em></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
