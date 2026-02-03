'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { TechLocation, User } from '@/types/database';

interface TechLocationWithUser extends TechLocation {
  user?: User;
}

interface UseTechLocationsOptions {
  /** Enable real-time updates via Supabase subscription */
  realtime?: boolean;
  /** Auto-refresh interval in milliseconds (fallback if realtime not available) */
  refreshInterval?: number;
}

interface UseTechLocationsResult {
  locations: TechLocationWithUser[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTechLocations(
  options: UseTechLocationsOptions = {}
): UseTechLocationsResult {
  const { realtime = true, refreshInterval = 30000 } = options;
  
  const [locations, setLocations] = useState<TechLocationWithUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLocations = useCallback(async () => {
    try {
      const response = await fetch('/api/tech/location');
      if (!response.ok) {
        throw new Error('Failed to fetch tech locations');
      }
      const data = await response.json();
      setLocations(data.locations || []);
      setError(null);
    } catch (err) {
      console.error('Error fetching tech locations:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  // Setup realtime subscription
  useEffect(() => {
    if (!realtime) return;

    const supabase = createClient();

    const channel = supabase
      .channel('tech_locations_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tech_locations',
        },
        async (payload) => {
          // Refetch to get user data
          await fetchLocations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [realtime, fetchLocations]);

  // Fallback polling interval
  useEffect(() => {
    if (realtime) return; // Skip if using realtime

    const interval = setInterval(fetchLocations, refreshInterval);
    return () => clearInterval(interval);
  }, [realtime, refreshInterval, fetchLocations]);

  return {
    locations,
    isLoading,
    error,
    refresh: fetchLocations,
  };
}

/**
 * Hook to update the current user's location
 */
export function useLocationTracking(techId: string | null) {
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateLocation = useCallback(async (position: GeolocationPosition) => {
    if (!techId) return;

    try {
      const response = await fetch('/api/tech/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tech_id: techId,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update location');
      }
      
      setError(null);
    } catch (err) {
      console.error('Error updating location:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [techId]);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser');
      return;
    }

    setIsTracking(true);
    setError(null);

    // Get initial position
    navigator.geolocation.getCurrentPosition(
      updateLocation,
      (err) => {
        console.error('Geolocation error:', err);
        setError(err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );

    // Watch for position changes
    const watchId = navigator.geolocation.watchPosition(
      updateLocation,
      (err) => {
        console.error('Geolocation error:', err);
        setError(err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000, // Allow 30 second cache
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      setIsTracking(false);
    };
  }, [updateLocation]);

  const stopTracking = useCallback(async () => {
    if (!techId) return;

    setIsTracking(false);

    // Optionally remove location from database
    try {
      await fetch(`/api/tech/location?tech_id=${techId}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('Error stopping tracking:', err);
    }
  }, [techId]);

  return {
    isTracking,
    error,
    startTracking,
    stopTracking,
  };
}
