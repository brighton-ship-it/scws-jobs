'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  getMapsLibrary,
  getMarkerLibrary,
  isGoogleMapsConfigured,
  SOCAL_CENTER,
  DEFAULT_ZOOM,
} from './GoogleMapsLoader';
import type { Job, Property, User } from '@/types/database';
import { Loader2, AlertCircle, Navigation } from 'lucide-react';

interface RouteStop {
  job: Job;
  property: Property;
  customerName: string;
  order: number;
  color?: string;
}

interface RouteSegment {
  distance: string;
  duration: string;
  polyline?: string;
}

interface RouteOptimizationMapProps {
  stops: RouteStop[];
  startLocation?: { lat: number; lng: number; label?: string };
  height?: string;
  showRoute?: boolean;
  onRouteCalculated?: (segments: RouteSegment[], totalDistance: string, totalDuration: string, optimizedOrder?: number[]) => void;
  optimizeOrder?: boolean;
}

export function RouteOptimizationMap({
  stops,
  startLocation,
  height = '500px',
  showRoute = true,
  onRouteCalculated,
  optimizeOrder = false,
}: RouteOptimizationMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Initialize map
  useEffect(() => {
    if (!isGoogleMapsConfigured()) {
      setError('Google Maps API key not configured');
      setIsLoading(false);
      return;
    }

    let mounted = true;

    async function initMap() {
      try {
        const { Map } = await getMapsLibrary();

        if (!mounted || !mapRef.current) return;

        // Create map
        const map = new Map(mapRef.current, {
          center: SOCAL_CENTER,
          zoom: DEFAULT_ZOOM,
          mapId: 'route-optimization-map',
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });

        mapInstanceRef.current = map;

        // Create directions renderer
        directionsRendererRef.current = new google.maps.DirectionsRenderer({
          map,
          suppressMarkers: true, // We'll add our own markers
          polylineOptions: {
            strokeColor: '#3B82F6',
            strokeWeight: 5,
            strokeOpacity: 0.8,
          },
        });

        setIsLoading(false);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load map');
          setIsLoading(false);
        }
      }
    }

    initMap();

    return () => {
      mounted = false;
    };
  }, []);

  // Create stop marker element
  const createStopMarkerElement = useCallback((stop: RouteStop, index: number) => {
    const color = stop.color || '#3B82F6';
    const pin = document.createElement('div');
    pin.innerHTML = `
      <div style="
        position: relative;
        cursor: pointer;
      ">
        <div style="
          background-color: ${color};
          width: 32px;
          height: 32px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          border: 3px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <span style="
            transform: rotate(45deg);
            color: white;
            font-weight: 700;
            font-size: 14px;
          ">${index + 1}</span>
        </div>
      </div>
    `;
    return pin;
  }, []);

  // Create start marker element
  const createStartMarkerElement = useCallback(() => {
    const pin = document.createElement('div');
    pin.innerHTML = `
      <div style="
        background-color: #10B981;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
          <circle cx="12" cy="12" r="10" stroke="white" stroke-width="2" fill="none"/>
          <circle cx="12" cy="12" r="4" fill="white"/>
        </svg>
      </div>
    `;
    return pin;
  }, []);

  // Calculate and display route
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || isLoading || stops.length === 0) return;

    async function updateRoute() {
      const { AdvancedMarkerElement } = await getMarkerLibrary();
      const directionsService = new google.maps.DirectionsService();

      // Clear existing markers
      markersRef.current.forEach(marker => marker.map = null);
      markersRef.current = [];

      // Filter stops with valid coordinates
      const validStops = stops.filter(stop => stop.property.lat && stop.property.lng);

      if (validStops.length === 0) {
        setRouteError('No stops have valid coordinates');
        return;
      }

      // If only 1 stop and no start location, just show the marker
      if (validStops.length === 1 && !startLocation) {
        const stop = validStops[0];
        const position = { lat: stop.property.lat!, lng: stop.property.lng! };
        
        const marker = new AdvancedMarkerElement({
          map,
          position,
          content: createStopMarkerElement(stop, 0),
          title: `${stop.order}. ${stop.job.job_type}`,
        });
        markersRef.current.push(marker);
        
        map.setCenter(position);
        map.setZoom(14);
        return;
      }

      // Build waypoints for directions
      const waypoints = validStops.slice(1, -1).map(stop => ({
        location: new google.maps.LatLng(stop.property.lat!, stop.property.lng!),
        stopover: true,
      }));

      const origin = startLocation 
        ? new google.maps.LatLng(startLocation.lat, startLocation.lng)
        : new google.maps.LatLng(validStops[0].property.lat!, validStops[0].property.lng!);

      const destination = validStops.length > 1
        ? new google.maps.LatLng(
            validStops[validStops.length - 1].property.lat!,
            validStops[validStops.length - 1].property.lng!
          )
        : origin;

      // If we have a start location, include the first stop as a waypoint
      if (startLocation && validStops.length > 1) {
        waypoints.unshift({
          location: new google.maps.LatLng(validStops[0].property.lat!, validStops[0].property.lng!),
          stopover: true,
        });
      }

      try {
        const result = await directionsService.route({
          origin,
          destination,
          waypoints,
          optimizeWaypoints: optimizeOrder,
          travelMode: google.maps.TravelMode.DRIVING,
        });

        if (showRoute && directionsRendererRef.current) {
          directionsRendererRef.current.setDirections(result);
        }

        // Extract route info
        const route = result.routes[0];
        if (route) {
          const segments: RouteSegment[] = route.legs.map(leg => ({
            distance: leg.distance?.text || '',
            duration: leg.duration?.text || '',
          }));

          const totalDistance = route.legs.reduce((sum, leg) => sum + (leg.distance?.value || 0), 0);
          const totalDuration = route.legs.reduce((sum, leg) => sum + (leg.duration?.value || 0), 0);

          // Convert to readable format
          const distanceText = totalDistance >= 1000 
            ? `${(totalDistance / 1609.34).toFixed(1)} mi`
            : `${totalDistance} m`;
          
          const durationHours = Math.floor(totalDuration / 3600);
          const durationMins = Math.floor((totalDuration % 3600) / 60);
          const durationText = durationHours > 0 
            ? `${durationHours}h ${durationMins}m`
            : `${durationMins} min`;

          if (onRouteCalculated) {
            onRouteCalculated(
              segments,
              distanceText,
              durationText,
              route.waypoint_order
            );
          }
        }

        // Add markers
        // Start location marker
        if (startLocation) {
          const startMarker = new AdvancedMarkerElement({
            map,
            position: { lat: startLocation.lat, lng: startLocation.lng },
            content: createStartMarkerElement(),
            title: startLocation.label || 'Start',
            zIndex: 1000,
          });
          markersRef.current.push(startMarker);
        }

        // Stop markers (reordered if optimized)
        const orderedStops = optimizeOrder && route?.waypoint_order
          ? reorderStops(validStops, route.waypoint_order, !!startLocation)
          : validStops;

        orderedStops.forEach((stop, index) => {
          const position = { lat: stop.property.lat!, lng: stop.property.lng! };
          
          const marker = new AdvancedMarkerElement({
            map,
            position,
            content: createStopMarkerElement(stop, index),
            title: `${index + 1}. ${stop.job.job_type} - ${stop.customerName}`,
            zIndex: 500 - index,
          });

          markersRef.current.push(marker);
        });

        setRouteError(null);
      } catch (err) {
        console.error('Directions request failed:', err);
        setRouteError('Could not calculate route. Some addresses may be invalid.');

        // Still show markers even if route fails
        const bounds = new google.maps.LatLngBounds();

        if (startLocation) {
          const startMarker = new AdvancedMarkerElement({
            map,
            position: { lat: startLocation.lat, lng: startLocation.lng },
            content: createStartMarkerElement(),
            title: startLocation.label || 'Start',
          });
          markersRef.current.push(startMarker);
          bounds.extend({ lat: startLocation.lat, lng: startLocation.lng });
        }

        validStops.forEach((stop, index) => {
          const position = { lat: stop.property.lat!, lng: stop.property.lng! };
          bounds.extend(position);

          const marker = new AdvancedMarkerElement({
            map,
            position,
            content: createStopMarkerElement(stop, index),
            title: `${index + 1}. ${stop.job.job_type}`,
          });
          markersRef.current.push(marker);
        });

        map.fitBounds(bounds, { padding: 50 });
      }
    }

    updateRoute();
  }, [stops, startLocation, isLoading, showRoute, optimizeOrder, onRouteCalculated, createStopMarkerElement, createStartMarkerElement]);

  // Helper to reorder stops based on Google's optimization
  function reorderStops(stops: RouteStop[], waypointOrder: number[], hasStartLocation: boolean): RouteStop[] {
    if (hasStartLocation) {
      // First stop is included in waypoints, so we need to handle it
      const reordered: RouteStop[] = [];
      waypointOrder.forEach((originalIndex) => {
        reordered.push(stops[originalIndex]);
      });
      // Add last stop (destination, not in waypoint_order)
      reordered.push(stops[stops.length - 1]);
      return reordered;
    } else {
      // First stop is origin, waypoint_order is for middle stops
      const reordered: RouteStop[] = [stops[0]];
      waypointOrder.forEach((originalIndex) => {
        // waypoint_order indices are 0-based, relative to the waypoints array
        // which excludes first and last stops
        reordered.push(stops[originalIndex + 1]);
      });
      reordered.push(stops[stops.length - 1]);
      return reordered;
    }
  }

  if (error) {
    return (
      <div 
        className="flex flex-col items-center justify-center bg-gray-100 rounded-xl p-6"
        style={{ height }}
      >
        <AlertCircle className="h-12 w-12 text-gray-400 mb-3" />
        <p className="text-gray-600 font-medium">Map Unavailable</p>
        <p className="text-sm text-gray-500 mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative" style={{ height }}>
      <div ref={mapRef} className="w-full h-full rounded-xl" />
      
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-xl">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      )}

      {routeError && (
        <div className="absolute top-4 left-4 right-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{routeError}</span>
          </div>
        </div>
      )}

      {/* Open in Google Maps button */}
      {stops.length > 0 && (
        <div className="absolute bottom-4 right-4">
          <a
            href={buildGoogleMapsUrl(stops, startLocation)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <Navigation className="h-4 w-4" />
            Open in Google Maps
          </a>
        </div>
      )}
    </div>
  );
}

// Build Google Maps directions URL
function buildGoogleMapsUrl(
  stops: RouteStop[],
  startLocation?: { lat: number; lng: number }
): string {
  const validStops = stops.filter(stop => stop.property.lat && stop.property.lng);
  if (validStops.length === 0) return 'https://maps.google.com';

  const addresses = validStops.map(stop => 
    encodeURIComponent(`${stop.property.address}, ${stop.property.city}, ${stop.property.zip}`)
  );

  if (startLocation) {
    addresses.unshift(encodeURIComponent(`${startLocation.lat},${startLocation.lng}`));
  }

  if (addresses.length === 1) {
    return `https://www.google.com/maps/dir/?api=1&destination=${addresses[0]}`;
  }

  const origin = addresses[0];
  const destination = addresses[addresses.length - 1];
  const waypoints = addresses.slice(1, -1).join('|');

  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
  if (waypoints) {
    url += `&waypoints=${waypoints}`;
  }

  return url;
}
