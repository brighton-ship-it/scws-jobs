'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  getMapsLibrary,
  getMarkerLibrary,
  isGoogleMapsConfigured,
  SOCAL_CENTER,
  DEFAULT_ZOOM,
  MARKER_COLORS,
} from './GoogleMapsLoader';
import type { Job, Property, TechLocation, User } from '@/types/database';
import { MapPin, Loader2, AlertCircle, Navigation, User as UserIcon } from 'lucide-react';

interface JobWithProperty {
  job: Job;
  property: Property;
  customerName?: string;
}

interface TechLocationWithUser extends TechLocation {
  user?: User;
}

interface DispatchMapProps {
  jobs: JobWithProperty[];
  techLocations?: TechLocationWithUser[];
  selectedJobId?: string;
  onJobSelect?: (jobId: string) => void;
  height?: string;
  showTechLocations?: boolean;
}

export function DispatchMap({
  jobs,
  techLocations = [],
  selectedJobId,
  onJobSelect,
  height = '500px',
  showTechLocations = true,
}: DispatchMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());
  const techMarkersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([
          getMapsLibrary(),
          getMarkerLibrary(),
        ]);

        if (!mounted || !mapRef.current) return;

        // Create map
        const map = new Map(mapRef.current, {
          center: SOCAL_CENTER,
          zoom: DEFAULT_ZOOM,
          mapId: 'dispatch-map', // Required for advanced markers
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });

        mapInstanceRef.current = map;

        // Create info window
        infoWindowRef.current = new google.maps.InfoWindow();

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

  // Create job marker element
  const createJobMarkerElement = useCallback((job: Job, isSelected: boolean) => {
    const color = job.priority === 'urgent'
      ? MARKER_COLORS.job.urgent
      : MARKER_COLORS.job[job.status as keyof typeof MARKER_COLORS.job] || MARKER_COLORS.job.scheduled;

    const pin = document.createElement('div');
    pin.className = 'job-marker';
    pin.innerHTML = `
      <div style="
        background-color: ${color};
        width: ${isSelected ? '40px' : '32px'};
        height: ${isSelected ? '40px' : '32px'};
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        border: 3px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
      ">
        <svg 
          style="transform: rotate(45deg); width: 16px; height: 16px; color: white;"
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          stroke-width="2"
        >
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
      </div>
    `;
    return pin;
  }, []);

  // Create tech marker element
  const createTechMarkerElement = useCallback((tech: TechLocationWithUser) => {
    const pin = document.createElement('div');
    pin.className = 'tech-marker';
    pin.innerHTML = `
      <div style="
        background-color: ${MARKER_COLORS.tech};
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        position: relative;
      ">
        <svg 
          style="width: 18px; height: 18px; color: white;"
          viewBox="0 0 24 24" 
          fill="currentColor"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
        ${tech.heading !== null ? `
          <div style="
            position: absolute;
            top: -8px;
            right: -8px;
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-bottom: 10px solid ${MARKER_COLORS.tech};
            transform: rotate(${tech.heading}deg);
          "></div>
        ` : ''}
      </div>
      <div style="
        position: absolute;
        bottom: -20px;
        left: 50%;
        transform: translateX(-50%);
        background: white;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 600;
        white-space: nowrap;
        box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      ">${tech.user?.name?.split(' ')[0] || 'Tech'}</div>
    `;
    return pin;
  }, []);

  // Update job markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || isLoading) return;

    async function updateMarkers() {
      const { AdvancedMarkerElement } = await getMarkerLibrary();

      // Clear existing markers
      markersRef.current.forEach(marker => marker.map = null);
      markersRef.current.clear();

      const bounds = new google.maps.LatLngBounds();
      let hasValidCoords = false;

      // Create markers for each job
      jobs.forEach(({ job, property, customerName }) => {
        if (!property.lat || !property.lng) return;

        hasValidCoords = true;
        const position = { lat: property.lat, lng: property.lng };
        bounds.extend(position);

        const isSelected = job.id === selectedJobId;
        const markerElement = createJobMarkerElement(job, isSelected);

        const marker = new AdvancedMarkerElement({
          map,
          position,
          content: markerElement,
          title: `${job.job_type} - ${customerName || 'Customer'}`,
          zIndex: isSelected ? 1000 : job.priority === 'urgent' ? 500 : 100,
        });

        // Add click listener
        marker.addListener('click', () => {
          const infoContent = `
            <div style="padding: 8px; max-width: 250px;">
              <h3 style="margin: 0 0 8px; font-weight: 600; color: #111827;">${job.job_type}</h3>
              <p style="margin: 0 0 4px; font-size: 14px; color: #6B7280;">${customerName || 'Customer'}</p>
              <p style="margin: 0 0 8px; font-size: 13px; color: #9CA3AF;">${property.address}, ${property.city || ''}</p>
              ${job.scheduled_time ? `<p style="margin: 0 0 8px; font-size: 13px; color: #3B82F6;">⏰ ${job.scheduled_time}</p>` : ''}
              ${job.priority === 'urgent' ? `<span style="background: #FEE2E2; color: #DC2626; padding: 2px 8px; border-radius: 4px; font-size: 12px;">Urgent</span>` : ''}
              <div style="margin-top: 12px; display: flex; gap: 8px;">
                <a 
                  href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${property.address}, ${property.city}, ${property.zip}`)}" 
                  target="_blank"
                  style="display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; background: #3B82F6; color: white; border-radius: 6px; text-decoration: none; font-size: 13px;"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 11l19-9-9 19-2-8-8-2z"></path>
                  </svg>
                  Directions
                </a>
              </div>
            </div>
          `;

          infoWindowRef.current?.setContent(infoContent);
          infoWindowRef.current?.open(map, marker);

          if (onJobSelect) {
            onJobSelect(job.id);
          }
        });

        markersRef.current.set(job.id, marker);
      });

      // Fit bounds if we have valid coordinates
      if (hasValidCoords && jobs.length > 0) {
        if (jobs.length === 1) {
          map.setCenter(bounds.getCenter());
          map.setZoom(14);
        } else {
          map.fitBounds(bounds, { padding: 50 });
        }
      }
    }

    updateMarkers();
  }, [jobs, selectedJobId, isLoading, createJobMarkerElement, onJobSelect]);

  // Update tech location markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || isLoading || !showTechLocations) return;

    async function updateTechMarkers() {
      const { AdvancedMarkerElement } = await getMarkerLibrary();

      // Clear existing tech markers
      techMarkersRef.current.forEach(marker => marker.map = null);
      techMarkersRef.current.clear();

      // Create markers for each tech location
      techLocations.forEach(techLocation => {
        const position = { lat: techLocation.lat, lng: techLocation.lng };
        const markerElement = createTechMarkerElement(techLocation);

        const marker = new AdvancedMarkerElement({
          map,
          position,
          content: markerElement,
          title: techLocation.user?.name || 'Technician',
          zIndex: 2000, // Above job markers
        });

        // Add click listener for tech info
        marker.addListener('click', () => {
          const updatedAt = new Date(techLocation.updated_at);
          const timeAgo = getTimeAgo(updatedAt);

          const infoContent = `
            <div style="padding: 8px; max-width: 200px;">
              <h3 style="margin: 0 0 8px; font-weight: 600; color: #111827;">
                ${techLocation.user?.name || 'Technician'}
              </h3>
              <p style="margin: 0 0 4px; font-size: 12px; color: #6B7280;">
                📍 Updated ${timeAgo}
              </p>
              ${techLocation.speed !== null ? `
                <p style="margin: 0 0 4px; font-size: 12px; color: #6B7280;">
                  🚗 ${Math.round(techLocation.speed * 2.237)} mph
                </p>
              ` : ''}
              ${techLocation.accuracy !== null ? `
                <p style="margin: 0; font-size: 11px; color: #9CA3AF;">
                  Accuracy: ±${Math.round(techLocation.accuracy)}m
                </p>
              ` : ''}
            </div>
          `;

          infoWindowRef.current?.setContent(infoContent);
          infoWindowRef.current?.open(map, marker);
        });

        techMarkersRef.current.set(techLocation.tech_id, marker);
      });
    }

    updateTechMarkers();
  }, [techLocations, isLoading, showTechLocations, createTechMarkerElement]);

  // Helper function for time ago
  function getTimeAgo(date: Date): string {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
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
        {jobs.length > 0 && (
          <div className="mt-4 text-left w-full max-w-sm">
            <p className="text-xs text-gray-400 mb-2">Scheduled locations:</p>
            <div className="space-y-1">
              {jobs.slice(0, 5).map(({ job, property }) => (
                <div key={job.id} className="flex items-center gap-2 text-xs">
                  <MapPin className="h-3 w-3 text-gray-400" />
                  <span className="truncate">{property.address}, {property.city}</span>
                </div>
              ))}
              {jobs.length > 5 && (
                <p className="text-xs text-gray-400">+{jobs.length - 5} more</p>
              )}
            </div>
          </div>
        )}
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

      {/* Legend */}
      {!isLoading && (
        <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg p-3 text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MARKER_COLORS.job.scheduled }} />
              <span>Scheduled</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MARKER_COLORS.job.in_progress }} />
              <span>In Progress</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MARKER_COLORS.job.urgent }} />
              <span>Urgent</span>
            </div>
            {showTechLocations && techLocations.length > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MARKER_COLORS.tech }} />
                <span>Techs</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
