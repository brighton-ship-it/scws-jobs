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
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

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

interface ResearchResult {
  parcel: ParcelInfo | null;
  wells: WellInfo[];
  septic: any | null;
  septicPermits: SepticPermit[];
  zoning: any | null;
  sources: { name: string; status: 'success' | 'error' | 'mock'; message?: string }[];
  cached?: boolean;
}

type County = 'san_diego' | 'riverside';
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
];

// County boundaries (approximate)
const COUNTY_BOUNDARIES = {
  san_diego: { minLat: 32.5, maxLat: 33.5, minLng: -117.6, maxLng: -116.0 },
  riverside: { minLat: 33.4, maxLat: 34.1, minLng: -117.7, maxLng: -114.4 },
};

function detectCountyFromCoords(lat: number, lng: number): County {
  const { san_diego, riverside } = COUNTY_BOUNDARIES;
  if (lat >= san_diego.minLat && lat <= san_diego.maxLat && 
      lng >= san_diego.minLng && lng <= san_diego.maxLng) {
    return 'san_diego';
  }
  if (lat >= riverside.minLat && lat <= riverside.maxLat && 
      lng >= riverside.minLng && lng <= riverside.maxLng) {
    return 'riverside';
  }
  return 'san_diego'; // Default
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
  
  // Coordinates for search
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  
  // Map ready state (to trigger drawing useEffect)
  const [mapReady, setMapReady] = useState(false);

  // Initialize map - runs when result changes (which makes mapRef available)
  useEffect(() => {
    let isMounted = true;
    
    async function initMap() {
      // Only init when we have results (which renders the map container)
      if (!isGoogleMapsConfigured() || !mapRef.current) {
        console.log('Map init skipped - no config or no mapRef');
        return;
      }
      
      // Already initialized
      if (mapInstanceRef.current) {
        console.log('Map already initialized');
        return;
      }
      
      try {
        console.log('Initializing map...');
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
        console.log('Map instance created successfully, mapReady set to true');
        
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
    if (!map) {
      console.log('Map click effect: no map instance');
      return;
    }
    
    // Remove old listener
    if (mapClickListenerRef.current) {
      google.maps.event.removeListener(mapClickListenerRef.current);
    }
    
    // Only add listener if in placement mode
    if (!isPlacingSeptic && !isPlacingWell) {
      console.log('Map click effect: not in placement mode');
      return;
    }
    
    console.log('Map click effect: attaching listener', { isPlacingSeptic, isPlacingWell });
    
    mapClickListenerRef.current = google.maps.event.addListener(map, 'click', (e: google.maps.MapMouseEvent) => {
      console.log('MAP CLICKED!', e.latLng?.toJSON());
      
      if (isPlacingSeptic && e.latLng) {
        setSepticLocation({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        setIsPlacingSeptic(false);
      }
      
      if (isPlacingWell && e.latLng) {
        setWellLocation({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        setIsPlacingWell(false);
      }
    });
    
    return () => {
      if (mapClickListenerRef.current) {
        google.maps.event.removeListener(mapClickListenerRef.current);
        mapClickListenerRef.current = null;
      }
    };
  }, [isPlacingSeptic, isPlacingWell, mapReady]);

  // Update map when results change
  useEffect(() => {
    console.log('Drawing useEffect triggered:', { mapReady, hasResult: !!result, hasMap: !!mapInstanceRef.current });
    if (!mapInstanceRef.current || !result) {
      console.log('Drawing skipped - map or result missing');
      return;
    }
    console.log('Drawing parcel, wells, and septic permits...');
    
    const map = mapInstanceRef.current;
    
    // Clear existing markers and polygons
    markersRef.current.forEach(m => m.map = null);
    markersRef.current = [];
    septicPermitMarkersRef.current.forEach(m => {
      // Also remove the attached circle
      if ((m as any)._septicCircle) {
        (m as any)._septicCircle.setMap(null);
      }
      m.setMap(null);
    });
    septicPermitMarkersRef.current = [];
    if (parcelPolygonRef.current) {
      parcelPolygonRef.current.setMap(null);
    }
    setbackCirclesRef.current.forEach(c => c.setMap(null));
    setbackCirclesRef.current = [];
    if (propertyLineSetbackRef.current) {
      propertyLineSetbackRef.current.setMap(null);
    }
    
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
      
      // Draw property line setback (50ft inward) if showSetbacks
      if (showSetbacks) {
        drawPropertyLineSetback(parcelCoords, map);
      }
    }
    
    // Add well markers with depth labels (using regular Marker, not AdvancedMarker)
    // Declutter overlapping wells by spreading them in a spiral pattern
    if (result.wells.length > 0) {
      console.log('Adding', result.wells.length, 'well markers');
      
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
      console.log('Added', markersRef.current.length, 'well markers');
    }
    
    // Add septic permit markers (orange squares)
    if (result.septicPermits && result.septicPermits.length > 0) {
      console.log('Adding', result.septicPermits.length, 'septic permit markers');
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
              <b>Setback:</b> 50ft radius shown<br/>
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
      console.log('Added', septicPermitMarkersRef.current.length, 'septic permit markers');
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
        setbackCirclesRef.current.push(wellCircle50);
      }
    }
  }, [wellLocation, showSetbacks]);

  // Draw property line setback using proper edge offset
  // San Diego: 10ft setback, Riverside: 50ft setback
  function drawPropertyLineSetback(parcelCoords: { lat: number; lng: number }[], map: google.maps.Map) {
    if (parcelCoords.length < 3) return;
    
    // County-specific setback distances
    const setbackFeet = county === 'san_diego' ? 10 : 50;
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
      } else if (searchType === 'address' && isGoogleMapsConfigured()) {
        // Wait for Maps library to load first
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
          setCoordinates({ lat, lng });
          
          // Center map on address
          if (mapInstanceRef.current) {
            mapInstanceRef.current.setCenter({ lat, lng });
            mapInstanceRef.current.setZoom(17);
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

  // Export Plot Map as PDF
  const handleExportPlotMap = async () => {
    if (!mapContainerRef.current || !result) return;
    
    setIsExportingPdf(true);
    
    try {
      // Capture the map
      const canvas = await html2canvas(mapContainerRef.current, {
        useCORS: true,
        scale: 2,
        logging: false,
      });
      
      const pdf = new jsPDF('landscape', 'mm', 'letter');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      
      // SCWS Letterhead
      pdf.setFillColor(16, 185, 129); // Green
      pdf.rect(0, 0, pageWidth, 25, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Southern California Well Service', 15, 12);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text('License C-57 #1011552 | (760) 440-8520', 15, 19);
      
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(14);
      pdf.text('PLOT MAP', pageWidth - 50, 15);
      
      // Map Image
      const mapImgData = canvas.toDataURL('image/png');
      const mapWidth = pageWidth - 30;
      const mapHeight = (canvas.height / canvas.width) * mapWidth;
      const maxMapHeight = pageHeight - 90;
      const finalMapHeight = Math.min(mapHeight, maxMapHeight);
      
      pdf.addImage(mapImgData, 'PNG', 15, 30, mapWidth, finalMapHeight);
      
      // Property Info Box
      const infoY = 30 + finalMapHeight + 5;
      pdf.setFillColor(249, 250, 251);
      const infoBoxHeight = wellLocation ? 42 : 35;
      pdf.rect(15, infoY, pageWidth - 30, infoBoxHeight, 'F');
      pdf.setDrawColor(229, 231, 235);
      pdf.rect(15, infoY, pageWidth - 30, infoBoxHeight);
      
      pdf.setTextColor(31, 41, 55);
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Property Information', 20, infoY + 8);
      
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      const col1X = 20;
      const col2X = 100;
      const col3X = 180;
      
      pdf.text(`APN: ${result.parcel?.apn || 'N/A'}`, col1X, infoY + 16);
      pdf.text(`Lot Size: ${result.parcel?.lotSizeAcres ? result.parcel.lotSizeAcres.toFixed(2) + ' acres' : 'N/A'}`, col2X, infoY + 16);
      pdf.text(`Zoning: ${result.parcel?.zoning || result.zoning?.designation || 'N/A'}`, col3X, infoY + 16);
      
      pdf.text(`County: ${county === 'san_diego' ? 'San Diego' : 'Riverside'}`, col3X + 20, infoY + 16);
      
      // Owner name on its own line to avoid overlap
      const ownerName = result.parcel?.ownerName || '';
      if (ownerName) {
        const truncatedOwner = ownerName.length > 60 ? ownerName.substring(0, 57) + '...' : ownerName;
        pdf.text(`Owner: ${truncatedOwner}`, col1X, infoY + 23);
      }
      pdf.text(`Wells Found: ${result.wells.length}`, col3X + 20, infoY + 23);
      
      // Proposed Well GPS Coordinates (if placed)
      if (wellLocation) {
        pdf.setFont('helvetica', 'bold');
        pdf.text('Proposed Well Location:', col1X, infoY + 30);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`GPS: ${wellLocation.lat.toFixed(6)}, ${wellLocation.lng.toFixed(6)}`, col1X + 45, infoY + 30);
      }
      
      // Legend
      const legendY = infoY + (wellLocation ? 35 : 28);
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Legend:', 20, legendY);
      pdf.setFont('helvetica', 'normal');
      
      // Green square - Parcel
      pdf.setFillColor(16, 185, 129);
      pdf.rect(45, legendY - 3, 4, 4, 'F');
      pdf.text('Parcel Boundary', 51, legendY);
      
      // Blue circle - Well
      pdf.setFillColor(59, 130, 246);
      pdf.circle(92, legendY - 1.5, 2, 'F');
      pdf.text('Well Location', 96, legendY);
      
      // Orange - Septic
      pdf.setFillColor(249, 115, 22);
      pdf.rect(130, legendY - 3, 4, 4, 'F');
      pdf.text('Septic', 136, legendY);
      
      // Red circle - 50ft setback
      pdf.setDrawColor(239, 68, 68);
      pdf.circle(160, legendY - 1.5, 2);
      pdf.text('50ft Setback', 164, legendY);
      
      // Blue line - Property setback
      pdf.setDrawColor(59, 130, 246);
      pdf.line(200, legendY - 1.5, 208, legendY - 1.5);
      pdf.text('50ft Property Setback', 210, legendY);
      
      // Well Data Table (if wells exist)
      if (result.wells.length > 0) {
        pdf.addPage();
        
        // Header
        pdf.setFillColor(16, 185, 129);
        pdf.rect(0, 0, pageWidth, 20, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Well Data - Nearby Wells Within 1 Mile', 15, 13);
        
        // Table headers
        pdf.setTextColor(107, 114, 128);
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'bold');
        const headers = ['#', 'WCR Number', 'Date', 'Depth (ft)', 'Static Level (ft)', 'Use'];
        const colWidths = [15, 50, 40, 40, 50, 60];
        let xPos = 15;
        headers.forEach((header, i) => {
          pdf.text(header, xPos, 30);
          xPos += colWidths[i];
        });
        
        // Table data
        pdf.setTextColor(31, 41, 55);
        pdf.setFont('helvetica', 'normal');
        let yPos = 38;
        result.wells.slice(0, 15).forEach((well, i) => {
          xPos = 15;
          pdf.text(String(i + 1), xPos, yPos);
          xPos += colWidths[0];
          pdf.text(well.wcr_number || 'N/A', xPos, yPos);
          xPos += colWidths[1];
          pdf.text(well.date_work_ended || 'N/A', xPos, yPos);
          xPos += colWidths[2];
          pdf.text(well.total_completed_depth?.toString() || 'N/A', xPos, yPos);
          xPos += colWidths[3];
          pdf.text(well.static_water_level?.toString() || 'N/A', xPos, yPos);
          xPos += colWidths[4];
          pdf.text(well.well_use || 'N/A', xPos, yPos);
          
          yPos += 8;
        });
      }
      
      // Footer on last page
      pdf.setTextColor(156, 163, 175);
      pdf.setFontSize(8);
      pdf.text(`Generated ${new Date().toLocaleString()} | Data from CA DWR & County GIS`, 15, pageHeight - 10);
      
      // Download
      const filename = `PlotMap_${result.parcel?.apn?.replace(/-/g, '') || 'property'}_${new Date().toISOString().split('T')[0]}.pdf`;
      pdf.save(filename);
      
    } catch (err) {
      console.error('PDF export error:', err);
      setError('Failed to export PDF. Please try again.');
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
      pdf.text('License: C-57 #1011552', 20, yPos);
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
        <p className="text-gray-500">Look up parcel information, wells, septic systems, and zoning for any property</p>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">County</label>
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
                  {county === 'san_diego' ? 'San Diego County' : 'Riverside County'}
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
                  Export Plot Map
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
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                    source.status === 'success'
                      ? 'bg-green-100 text-green-700'
                      : source.status === 'mock'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {source.status === 'success' ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : source.status === 'mock' ? (
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
        </div>
      </div>

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
                    50ft Setback
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 border-2 border-orange-500 rounded-full"></span>
                    100ft Setback
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-0 border border-blue-500"></span>
                    Property Setback
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
                    if (!isPlacingSeptic && !isPlacingWell) return;
                    
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
                    
                    console.log('DIV CLICKED - placing at:', lat, lng);
                    
                    if (isPlacingSeptic) {
                      setSepticLocation({ lat, lng });
                      setIsPlacingSeptic(false);
                    }
                    if (isPlacingWell) {
                      setWellLocation({ lat, lng });
                      setIsPlacingWell(false);
                    }
                  }}
                  style={{ cursor: (isPlacingSeptic || isPlacingWell) ? 'crosshair' : undefined }}
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
                      <p className="font-medium text-gray-900">{result.parcel.ownerName || '—'}</p>
                      <p className="text-sm text-gray-500">{result.parcel.ownerAddress || '—'}</p>
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
                  <p className="text-gray-500 text-center py-4">No wells found within 1 mile</p>
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
                ) : result.septic?.status === 'mock' ? (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex items-start gap-3">
                      <Info className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-yellow-800">Property Designation Unknown</p>
                        <p className="text-sm text-yellow-700 mt-1">{result.septic.message}</p>
                        <div className="mt-2 text-sm text-yellow-700">
                          <p><strong>San Diego County DEH:</strong> (858) 505-6700</p>
                          <p><strong>Riverside County DEH:</strong> (951) 358-5172</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                
                {/* Nearby Septic Parcels */}
                {result.septicPermits && result.septicPermits.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      Nearby Septic Parcels (within 1 mile)
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
                      🔶 Orange markers on map show nearby septic parcels
                    </p>
                  </div>
                )}
                
                {/* Tip for manual placement */}
                <div className="pt-2 border-t border-gray-200">
                  <p className="text-xs text-gray-500">
                    <strong>Tip:</strong> Use "Place Septic Location" above to manually mark septic tank location and view setback circles.
                  </p>
                </div>
              </div>
            )}
          </div>

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
                  <p><strong>License:</strong> C-57 #1011552</p>
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
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
