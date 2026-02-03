'use client';

const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

// Track initialization state
let initPromise: Promise<void> | null = null;

// Cache promises for libraries
let mapsLibraryPromise: Promise<google.maps.MapsLibrary> | null = null;
let markerLibraryPromise: Promise<google.maps.MarkerLibrary> | null = null;
let directionsLibraryPromise: Promise<google.maps.DirectionsLibrary> | null = null;

function loadGoogleMaps(): Promise<void> {
  if (initPromise) return initPromise;
  
  initPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Cannot load Google Maps on server'));
      return;
    }
    
    // Check if already loaded
    if (typeof google !== 'undefined' && google.maps) {
      resolve();
      return;
    }
    
    // Create callback name
    const callbackName = '__googleMapsCallback';
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      resolve();
    };
    
    // Load the script
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,marker&v=weekly&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
  
  return initPromise;
}

export async function getMapsLibrary(): Promise<google.maps.MapsLibrary> {
  if (mapsLibraryPromise) return mapsLibraryPromise;
  
  mapsLibraryPromise = (async () => {
    await loadGoogleMaps();
    return google.maps.importLibrary('maps') as Promise<google.maps.MapsLibrary>;
  })();
  
  return mapsLibraryPromise;
}

export async function getMarkerLibrary(): Promise<google.maps.MarkerLibrary> {
  if (markerLibraryPromise) return markerLibraryPromise;
  
  markerLibraryPromise = (async () => {
    await loadGoogleMaps();
    return google.maps.importLibrary('marker') as Promise<google.maps.MarkerLibrary>;
  })();
  
  return markerLibraryPromise;
}

export async function getDirectionsLibrary(): Promise<google.maps.DirectionsLibrary> {
  if (directionsLibraryPromise) return directionsLibraryPromise;
  
  directionsLibraryPromise = (async () => {
    await loadGoogleMaps();
    return google.maps.importLibrary('routes') as unknown as Promise<google.maps.DirectionsLibrary>;
  })();
  
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
