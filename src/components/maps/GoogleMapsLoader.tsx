'use client';

import { Loader } from '@googlemaps/js-api-loader';

// Singleton loader to prevent multiple script loads
let loaderInstance: Loader | null = null;
let mapsLibraryPromise: Promise<google.maps.MapsLibrary> | null = null;
let markerLibraryPromise: Promise<google.maps.MarkerLibrary> | null = null;
let directionsLibraryPromise: Promise<google.maps.DirectionsLibrary> | null = null;

const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

function getLoader(): Loader {
  if (!loaderInstance) {
    loaderInstance = new Loader({
      apiKey,
      version: 'weekly',
      libraries: ['places', 'marker', 'routes'],
    });
  }
  return loaderInstance;
}

export function getMapsLibrary(): Promise<google.maps.MapsLibrary> {
  if (mapsLibraryPromise) return mapsLibraryPromise;
  mapsLibraryPromise = getLoader().importLibrary('maps');
  return mapsLibraryPromise;
}

export function getMarkerLibrary(): Promise<google.maps.MarkerLibrary> {
  if (markerLibraryPromise) return markerLibraryPromise;
  markerLibraryPromise = getLoader().importLibrary('marker');
  return markerLibraryPromise;
}

export function getDirectionsLibrary(): Promise<google.maps.DirectionsLibrary> {
  if (directionsLibraryPromise) return directionsLibraryPromise;
  // Directions is part of routes
  directionsLibraryPromise = getLoader().importLibrary('routes') as unknown as Promise<google.maps.DirectionsLibrary>;
  return directionsLibraryPromise;
}

export function isGoogleMapsConfigured(): boolean {
  return !!apiKey;
}

// Southern California center (roughly San Diego/Riverside area)
export const SOCAL_CENTER = { lat: 33.1, lng: -116.8 };
export const DEFAULT_ZOOM = 9;

// Custom marker colors
export const MARKER_COLORS = {
  job: {
    scheduled: '#3B82F6', // blue
    in_progress: '#F59E0B', // amber
    completed: '#10B981', // green
    urgent: '#EF4444', // red
  },
  tech: '#8B5CF6', // purple for tech locations
};
