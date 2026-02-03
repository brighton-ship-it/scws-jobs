'use client';

import { useState, useMemo, useCallback } from 'react';
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
  Car,
  Loader2,
  CheckCircle,
  ArrowUpDown,
} from 'lucide-react';
import { format } from 'date-fns';
import Link from 'next/link';
import { RouteOptimizationMap, isGoogleMapsConfigured } from '@/components/maps';

interface RouteStop {
  job: Job;
  property: Property;
  customerName: string;
  order: number;
  estimatedArrival?: string;
  drivingTime?: string;
  distance?: string;
  color?: string;
}

interface RouteSegment {
  distance: string;
  duration: string;
}

export default function RouteOptimizationPage() {
  const [selectedCrew, setSelectedCrew] = useState<string>('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizedRoute, setOptimizedRoute] = useState<RouteStop[]>([]);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [totalDistance, setTotalDistance] = useState<string>('');
  const [totalDuration, setTotalDuration] = useState<string>('');

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
        const jobType = getJobTypeByName(job.job_type);
        if (!property) return null;
        return {
          job,
          property,
          customerName: customer?.name || 'Unknown',
          order: index + 1,
          color: jobType?.color || '#3B82F6',
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

  // Handle route calculation callback
  const handleRouteCalculated = useCallback((
    segments: RouteSegment[],
    totalDist: string,
    totalDur: string,
    optimizedOrder?: number[]
  ) => {
    setRouteSegments(segments);
    setTotalDistance(totalDist);
    setTotalDuration(totalDur);

    if (optimizedOrder && optimizedOrder.length > 0 && isOptimizing) {
      // Reorder stops based on Google's optimization
      const newOrder: RouteStop[] = [];
      optimizedOrder.forEach((originalIndex, newIndex) => {
        const stop = routeStops[originalIndex + 1]; // +1 because first stop is origin
        if (stop) {
          newOrder.push({ ...stop, order: newIndex + 2 }); // +2 to account for origin
        }
      });
      // Add first (origin) and last (destination) stops
      if (routeStops.length > 0) {
        newOrder.unshift({ ...routeStops[0], order: 1 });
        newOrder.push({ ...routeStops[routeStops.length - 1], order: newOrder.length + 1 });
      }
      
      // Update with driving info from segments
      const stopsWithDriving = newOrder.map((stop, index) => ({
        ...stop,
        drivingTime: segments[index]?.duration || '',
        distance: segments[index]?.distance || '',
      }));
      
      setOptimizedRoute(stopsWithDriving);
      setIsOptimizing(false);
    } else if (segments.length > 0 && !isOptimizing) {
      // Just update driving info without reordering
      const stopsWithDriving = routeStops.map((stop, index) => ({
        ...stop,
        drivingTime: segments[index]?.duration || '',
        distance: segments[index]?.distance || '',
      }));
      setOptimizedRoute(stopsWithDriving);
    }
  }, [routeStops, isOptimizing]);

  // Simulated route optimization (triggers Google Maps optimization)
  const optimizeRoute = async () => {
    setIsOptimizing(true);
    // The actual optimization happens in RouteOptimizationMap with optimizeOrder=true
    // This is just to trigger the state change
  };

  const displayRoute = optimizedRoute.length > 0 ? optimizedRoute : routeStops;

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
                setRouteSegments([]);
                setIsOptimizing(false);
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
            
            {selectedCrew && routeStops.length > 2 && (
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
                    <ArrowUpDown className="h-4 w-4" />
                    Optimize Order
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
                                    {stop.customerName}
                                  </p>
                                </div>
                                {stop.job.priority === 'urgent' && (
                                  <Badge variant="danger">Urgent</Badge>
                                )}
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-500">
                                <div className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  <span className="truncate max-w-[200px]">{stop.property.address}</span>
                                </div>
                                {stop.job.scheduled_time && (
                                  <div className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    <span>{stop.job.scheduled_time}</span>
                                  </div>
                                )}
                              </div>

                              {/* Driving info (after route calculation) */}
                              {stop.drivingTime && (
                                <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
                                  <div className="flex items-center gap-1">
                                    <Car className="h-3 w-3" />
                                    <span>{stop.drivingTime}</span>
                                  </div>
                                  {stop.distance && (
                                    <>
                                      <span>·</span>
                                      <span>{stop.distance}</span>
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
            {displayRoute.length > 0 && (totalDistance || totalDuration) && (
              <div className="border-t bg-gray-50 px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-4">
                    {totalDistance && (
                      <div>
                        <span className="text-gray-500">Total Distance:</span>
                        <span className="ml-1 font-medium">{totalDistance}</span>
                      </div>
                    )}
                    {totalDuration && (
                      <div>
                        <span className="text-gray-500">Driving Time:</span>
                        <span className="ml-1 font-medium">{totalDuration}</span>
                      </div>
                    )}
                  </div>
                  {optimizedRoute.length > 0 && (
                    <div className="flex items-center gap-1 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      <span className="text-xs font-medium">Optimized</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Map View */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Route className="h-4 w-4" />
                Route Map
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <RouteOptimizationMap
                stops={displayRoute}
                height="500px"
                showRoute={true}
                optimizeOrder={isOptimizing}
                onRouteCalculated={handleRouteCalculated}
              />
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
