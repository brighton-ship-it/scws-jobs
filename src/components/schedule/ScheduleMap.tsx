'use client';

import { useMemo } from 'react';
import { MapPin, AlertCircle } from 'lucide-react';
import type { Job, Property, MapMarker } from '@/types/database';
import { parseISO, isToday, isPast } from 'date-fns';

// Extended job type with included property from API
interface JobWithProperty extends Job {
  property?: {
    id: string;
    address: string;
    city?: string;
    lat?: number;
    lng?: number;
  };
  service_address?: string;
}

interface ScheduleMapProps {
  jobs: JobWithProperty[];
  selectedDate?: Date;
  className?: string;
}

// Helper to determine marker color based on job status
function getMarkerColor(job: Job): 'green' | 'orange' | 'red' | 'blue' {
  // Completed jobs are green
  if (job.status === 'completed' || job.status === 'invoiced') {
    return 'green';
  }
  
  // In progress jobs are orange
  if (job.status === 'in_progress') {
    return 'orange';
  }
  
  // Check if late (past scheduled date and not completed)
  if (job.scheduled_date) {
    const scheduledDate = parseISO(job.scheduled_date);
    if (isPast(scheduledDate) && !isToday(scheduledDate)) {
      return 'red';
    }
  }
  
  // Default: scheduled (blue)
  return 'blue';
}

// Color config for markers
const markerColors = {
  green: { bg: 'bg-green-500', border: 'border-green-600', label: 'Completed' },
  orange: { bg: 'bg-orange-500', border: 'border-orange-600', label: 'In Progress' },
  red: { bg: 'bg-red-500', border: 'border-red-600', label: 'Late' },
  blue: { bg: 'bg-blue-500', border: 'border-blue-600', label: 'Scheduled' },
};

export function ScheduleMap({ jobs, selectedDate, className = '' }: ScheduleMapProps) {
  // Build markers from jobs - using included property data
  const markers: MapMarker[] = useMemo(() => {
    return jobs
      .map(job => {
        // Use property data included in the job from API
        const property = job.property;
        if (!property || !property.lat || !property.lng) return null;
        
        return {
          id: job.id,
          lat: property.lat,
          lng: property.lng,
          job,
          property: property as Property,
          color: getMarkerColor(job),
        };
      })
      .filter((m): m is MapMarker => m !== null);
  }, [jobs]);

  // Count jobs by status
  const statusCounts = useMemo(() => {
    const counts = { green: 0, orange: 0, red: 0, blue: 0 };
    markers.forEach(m => counts[m.color]++);
    return counts;
  }, [markers]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Map Placeholder */}
      <div className="flex-1 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center p-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-200 mb-4">
            <MapPin className="h-8 w-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-700 mb-2">Map View</h3>
          <div className="flex items-center justify-center gap-2 text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-lg mb-4">
            <AlertCircle className="h-4 w-4" />
            <span>Google Maps API key required</span>
          </div>
          <p className="text-sm text-gray-500 max-w-xs">
            Add your Google Maps API key to enable the interactive map with job locations.
          </p>
        </div>

        {/* Mock marker positions */}
        {markers.length > 0 && (
          <div className="mt-6 w-full max-w-sm">
            <p className="text-xs font-medium text-gray-500 mb-2 text-center">
              {markers.length} job{markers.length !== 1 ? 's' : ''} with location data
            </p>
            <div className="grid grid-cols-4 gap-2">
              {markers.slice(0, 8).map((marker) => (
                <div
                  key={marker.id}
                  className={`
                    flex items-center justify-center p-2 rounded-lg text-white text-xs font-medium
                    ${markerColors[marker.color].bg}
                  `}
                  title={`${marker.job.job_type} - ${marker.property?.city || ''}`}
                >
                  <MapPin className="h-4 w-4" />
                </div>
              ))}
              {markers.length > 8 && (
                <div className="flex items-center justify-center p-2 rounded-lg bg-gray-300 text-gray-600 text-xs font-medium">
                  +{markers.length - 8}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs">
        {Object.entries(markerColors).map(([color, config]) => (
          <div key={color} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-full ${config.bg}`} />
            <span className="text-gray-600">
              {config.label}
              {statusCounts[color as keyof typeof statusCounts] > 0 && (
                <span className="text-gray-400 ml-1">
                  ({statusCounts[color as keyof typeof statusCounts]})
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Export types for Google Maps integration
export type { MapMarker };
export { getMarkerColor, markerColors };
