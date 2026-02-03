'use client';


import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  mockJobs,
  getPropertyById,
  getCustomerById,
  getJobTypeByName,
  getFieldCrew,
} from '@/lib/mock-data';
import type { Job, Property } from '@/types/database';
import {
  Route,
  MapPin,
  Clock,
  Navigation,
  AlertCircle,
  Car,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import Link from 'next/link';

// Google Maps API placeholder - Brighton will add the key
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

interface RouteStop {
  job: Job;
  property: Property;
  customer: { name: string };
  order: number;
  estimatedArrival?: string;
  drivingTime?: number; // minutes from previous stop
  distance?: number; // miles from previous stop
}

export default function RouteOptimizationPage() {
  const [selectedCrew, setSelectedCrew] = useState<string>('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizedRoute, setOptimizedRoute] = useState<RouteStop[]>([]);
  const mapRef = useRef<HTMLDivElement>(null);

  const fieldCrew = useMemo(() => getFieldCrew(), []);
  const today = format(new Date(), 'yyyy-MM-dd');

  // Get today's jobs for selected crew member
  const crewJobs = useMemo(() => {
    if (!selectedCrew) return [];
    return mockJobs.filter(
      job =>
        job.scheduled_date === today &&
        job.assigned_to === selectedCrew &&
        (job.status === 'scheduled' || job.status === 'in_progress')
    );
  }, [selectedCrew, today]);

  // Build route stops with property info
  const routeStops = useMemo((): RouteStop[] => {
    return crewJobs
      .map((job, index) => {
        const property = getPropertyById(job.property_id);
        const customer = property ? getCustomerById(property.customer_id) : null;
        if (!property) return null;
        return {
          job,
          property,
          customer: { name: customer?.name || 'Unknown' },
          order: index + 1,
        };
      })
      .filter((stop): stop is RouteStop => stop !== null)
      .sort((a, b) => {
        // Sort by scheduled time
        if (!a.job.scheduled_time) return 1;
        if (!b.job.scheduled_time) return -1;
        return a.job.scheduled_time.localeCompare(b.job.scheduled_time);
      });
  }, [crewJobs]);

  // Simulated route optimization
  const optimizeRoute = async () => {
    setIsOptimizing(true);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // In a real implementation, this would:
    // 1. Send coordinates to Google Directions API
    // 2. Use the Directions API to optimize waypoint order
    // 3. Calculate driving times and distances

    // For now, simulate optimized route with mock driving data
    const optimized = routeStops.map((stop, index) => ({
      ...stop,
      order: index + 1,
      drivingTime: index === 0 ? 15 : Math.floor(Math.random() * 30) + 10,
      distance: index === 0 ? 8 : Math.floor(Math.random() * 20) + 5,
      estimatedArrival: calculateArrivalTime(stop.job.scheduled_time || '08:00', index),
    }));

    setOptimizedRoute(optimized);
    setIsOptimizing(false);
  };

  const calculateArrivalTime = (baseTime: string, index: number): string => {
    const [hours, minutes] = baseTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + index * 90; // ~90 min per job
    const newHours = Math.floor(totalMinutes / 60) % 24;
    const newMinutes = totalMinutes % 60;
    return `${newHours.toString().padStart(2, '0')}:${newMinutes.toString().padStart(2, '0')}`;
  };

  // Initialize map when API key is available
  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || !mapRef.current) return;

    // This would load the Google Maps script and initialize the map
    // For now, we show a placeholder
    // Map initialization would go here when API key is provided
  }, []);

  const displayRoute = optimizedRoute.length > 0 ? optimizedRoute : routeStops;
  const totalDistance = displayRoute.reduce((sum, stop) => sum + (stop.distance || 0), 0);
  const totalDrivingTime = displayRoute.reduce((sum, stop) => sum + (stop.drivingTime || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Route Optimization</h2>
          <p className="text-gray-600">Plan efficient routes for field crews</p>
        </div>
        <Link href="/dispatch">
          <Button variant="outline">← Back to Dispatch</Button>
        </Link>
      </div>

      {/* API Key Warning */}
      {!GOOGLE_MAPS_API_KEY && (
        <Card className="border-yellow-300 bg-yellow-50">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0" />
              <div>
                <p className="font-medium text-yellow-800">Google Maps API Key Required</p>
                <p className="text-sm text-yellow-700">
                  Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to your .env.local file to enable map features.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Crew Selection */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <label className="text-sm font-medium text-gray-700">
              Select Crew Member:
            </label>
            <select
              value={selectedCrew}
              onChange={(e) => {
                setSelectedCrew(e.target.value);
                setOptimizedRoute([]);
              }}
              className="flex-1 max-w-xs h-10 px-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Choose a crew member...</option>
              {fieldCrew.map(user => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
            
            {selectedCrew && routeStops.length > 1 && (
              <Button
                onClick={optimizeRoute}
                disabled={isOptimizing}
              >
                {isOptimizing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Optimizing...
                  </>
                ) : (
                  <>
                    <Route className="h-4 w-4" />
                    Optimize Route
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedCrew && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Route List */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Today&apos;s Route - {fieldCrew.find(u => u.id === selectedCrew)?.name}
                </CardTitle>
                <Badge variant="info">{displayRoute.length} stops</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {displayRoute.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                  <MapPin className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                  <p>No jobs scheduled for today</p>
                </div>
              ) : (
                <div className="divide-y">
                  {displayRoute.map((stop, index) => {
                    const jobType = getJobTypeByName(stop.job.job_type);
                    const isLast = index === displayRoute.length - 1;
                    
                    return (
                      <div key={stop.job.id} className="relative">
                        {/* Connector Line */}
                        {!isLast && (
                          <div className="absolute left-7 top-14 bottom-0 w-0.5 bg-gray-200" />
                        )}
                        
                        <div className="p-4 hover:bg-gray-50">
                          <div className="flex gap-3">
                            {/* Order Number */}
                            <div
                              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                              style={{ backgroundColor: jobType?.color || '#3B82F6' }}
                            >
                              {stop.order}
                            </div>

                            {/* Stop Details */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="font-medium text-gray-900">
                                    {stop.job.job_type}
                                  </p>
                                  <p className="text-sm text-gray-600">
                                    {stop.customer.name}
                                  </p>
                                </div>
                                {stop.job.priority === 'urgent' && (
                                  <Badge variant="danger">Urgent</Badge>
                                )}
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-500">
                                <div className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  <span>{stop.property.address}</span>
                                </div>
                                {stop.job.scheduled_time && (
                                  <div className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    <span>{stop.job.scheduled_time}</span>
                                  </div>
                                )}
                              </div>

                              {/* Driving info (after optimization) */}
                              {stop.drivingTime && (
                                <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
                                  <div className="flex items-center gap-1">
                                    <Car className="h-3 w-3" />
                                    <span>{stop.drivingTime} min drive</span>
                                  </div>
                                  <span>·</span>
                                  <span>{stop.distance} miles</span>
                                  {stop.estimatedArrival && (
                                    <>
                                      <span>·</span>
                                      <span>ETA: {stop.estimatedArrival}</span>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex-shrink-0">
                              <a
                                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                                  `${stop.property.address}, ${stop.property.city}, ${stop.property.zip}`
                                )}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 hover:bg-gray-100 rounded-lg inline-flex text-blue-600"
                                title="Open in Google Maps"
                              >
                                <Navigation className="h-4 w-4" />
                              </a>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
            
            {/* Route Summary */}
            {displayRoute.length > 0 && optimizedRoute.length > 0 && (
              <div className="border-t bg-gray-50 px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-4">
                    <div>
                      <span className="text-gray-500">Total Distance:</span>
                      <span className="ml-1 font-medium">{totalDistance} mi</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Driving Time:</span>
                      <span className="ml-1 font-medium">
                        {Math.floor(totalDrivingTime / 60)}h {totalDrivingTime % 60}m
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Generate full route link
                      const waypoints = displayRoute.map(s => 
                        `${s.property.address}, ${s.property.city}, ${s.property.zip}`
                      ).join('|');
                      window.open(
                        `https://www.google.com/maps/dir/${waypoints}`,
                        '_blank'
                      );
                    }}
                  >
                    <Navigation className="h-4 w-4" />
                    Open Full Route
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Map View */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Map View
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div
                ref={mapRef}
                className="h-[500px] bg-gray-100 rounded-b-xl flex items-center justify-center"
              >
                {GOOGLE_MAPS_API_KEY ? (
                  <div className="text-center text-gray-500">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                    <p>Loading map...</p>
                  </div>
                ) : (
                  <div className="text-center text-gray-400 p-6">
                    <MapPin className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium text-gray-500">Map Preview Unavailable</p>
                    <p className="text-sm mt-1">
                      Add your Google Maps API key to enable the interactive map.
                    </p>
                    {displayRoute.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs text-gray-400 mb-2">Scheduled locations:</p>
                        <div className="space-y-1 text-xs">
                          {displayRoute.map(stop => (
                            <div key={stop.job.id} className="flex items-center gap-2">
                              <div
                                className="w-4 h-4 rounded-full text-white text-[10px] flex items-center justify-center"
                                style={{ backgroundColor: getJobTypeByName(stop.job.job_type)?.color || '#3B82F6' }}
                              >
                                {stop.order}
                              </div>
                              <span>{stop.property.city}</span>
                              {stop.property.lat && stop.property.lng && (
                                <span className="text-gray-300">
                                  ({stop.property.lat.toFixed(2)}, {stop.property.lng.toFixed(2)})
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* No crew selected */}
      {!selectedCrew && (
        <Card>
          <CardContent className="py-12 text-center">
            <Route className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500">
              Select a crew member to view and optimize their route
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
