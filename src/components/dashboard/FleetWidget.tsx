'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Truck, AlertTriangle, Calendar, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import type { VehicleWithUser } from '@/types/database';

export function FleetWidget() {
  const [vehicles, setVehicles] = useState<VehicleWithUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        // Fetch vehicles with registration due in next 60 days
        const res = await fetch('/api/vehicles?status=active&dueSoon=true&daysAhead=60');
        if (res.ok) {
          const data = await res.json();
          setVehicles(data.vehicles || []);
        }
      } catch (error) {
        console.error('Failed to fetch vehicles:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchVehicles();
  }, []);

  // Filter to show only vehicles that need attention (expired or due within 60 days)
  const vehiclesNeedingAttention = vehicles.filter(
    v => v.registration_status === 'expired' || 
         v.registration_status === 'due_soon' || 
         v.registration_status === 'upcoming'
  );

  const expiredCount = vehicles.filter(v => v.registration_status === 'expired').length;
  const dueSoonCount = vehicles.filter(v => v.registration_status === 'due_soon').length;

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-gray-400" />
            <CardTitle className="text-base">Fleet Registration</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (vehiclesNeedingAttention.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-gray-400" />
              <CardTitle className="text-base">Fleet Registration</CardTitle>
            </div>
            <Link href="/vehicles" className="text-sm text-green-600 hover:text-green-700 font-medium">
              View all
            </Link>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center gap-3 py-4 text-center justify-center">
            <div className="p-2 bg-green-100 rounded-full">
              <Truck className="h-5 w-5 text-green-600" />
            </div>
            <p className="text-sm text-gray-500">All registrations current</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={expiredCount > 0 ? 'border-red-200' : dueSoonCount > 0 ? 'border-yellow-200' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck className={`h-4 w-4 ${expiredCount > 0 ? 'text-red-500' : dueSoonCount > 0 ? 'text-yellow-500' : 'text-gray-400'}`} />
            <CardTitle className="text-base">Fleet Registration</CardTitle>
          </div>
          <Link href="/vehicles" className="text-sm text-green-600 hover:text-green-700 font-medium">
            View all
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Alert banner if expired */}
        {expiredCount > 0 && (
          <Link href="/vehicles?status=active">
            <div className="flex items-center gap-2 p-2 mb-3 bg-red-50 border border-red-100 rounded-lg hover:bg-red-100 transition-colors">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <span className="text-sm font-medium text-red-700">
                {expiredCount} vehicle{expiredCount !== 1 ? 's' : ''} with expired registration
              </span>
            </div>
          </Link>
        )}

        {/* Vehicle list */}
        <div className="space-y-2">
          {vehiclesNeedingAttention.slice(0, 4).map((vehicle) => (
            <Link 
              key={vehicle.id} 
              href={`/vehicles/${vehicle.id}`}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                  vehicle.registration_status === 'expired' ? 'bg-red-500' :
                  vehicle.registration_status === 'due_soon' ? 'bg-yellow-500' :
                  'bg-blue-500'
                }`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate group-hover:text-green-600 transition-colors">
                    {vehicle.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {vehicle.registration_due_date && format(new Date(vehicle.registration_due_date), 'MMM d, yyyy')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {vehicle.registration_status === 'expired' ? (
                  <Badge variant="destructive" size="sm">Expired</Badge>
                ) : vehicle.registration_status === 'due_soon' ? (
                  <Badge variant="warning" size="sm">{vehicle.days_until_due}d</Badge>
                ) : (
                  <Badge variant="default" size="sm">{vehicle.days_until_due}d</Badge>
                )}
                <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500" />
              </div>
            </Link>
          ))}
        </div>

        {vehiclesNeedingAttention.length > 4 && (
          <Link 
            href="/vehicles" 
            className="flex items-center justify-center gap-1 mt-3 pt-3 border-t text-sm text-green-600 hover:text-green-700 font-medium"
          >
            View all {vehiclesNeedingAttention.length} vehicles
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
