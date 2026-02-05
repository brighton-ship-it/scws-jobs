'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, Truck, AlertTriangle, RefreshCw, MoreVertical, Calendar, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { VehicleWithUser } from '@/types/database';
import { format } from 'date-fns';

const statusFilters = ['all', 'active', 'inactive', 'maintenance', 'sold'];

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<VehicleWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');

  const fetchVehicles = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (searchQuery) params.set('search', searchQuery);
      
      const res = await fetch(`/api/vehicles?${params}`);
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

  useEffect(() => {
    fetchVehicles();
  }, [statusFilter]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchVehicles();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Stats
  const totalVehicles = vehicles.length;
  const expiredCount = vehicles.filter(v => v.registration_status === 'expired').length;
  const dueSoonCount = vehicles.filter(v => v.registration_status === 'due_soon').length;
  const upcomingCount = vehicles.filter(v => v.registration_status === 'upcoming').length;

  const getStatusBadge = (vehicle: VehicleWithUser) => {
    switch (vehicle.registration_status) {
      case 'expired':
        return <Badge variant="destructive">🔴 Expired</Badge>;
      case 'due_soon':
        return <Badge variant="warning">⚠️ Due in {vehicle.days_until_due} days</Badge>;
      case 'upcoming':
        return <Badge variant="default">📅 Due in {vehicle.days_until_due} days</Badge>;
      default:
        return <Badge variant="success">✅ Current</Badge>;
    }
  };

  const getVehicleStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="success" size="sm">Active</Badge>;
      case 'inactive':
        return <Badge variant="default" size="sm">Inactive</Badge>;
      case 'maintenance':
        return <Badge variant="warning" size="sm">Maintenance</Badge>;
      case 'sold':
        return <Badge variant="default" size="sm">Sold</Badge>;
      default:
        return <Badge size="sm">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fleet Vehicles</h1>
          <p className="text-gray-500">Registration and fleet tracking</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchVehicles}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Link href="/vehicles/new">
            <Button>
              <Plus className="h-4 w-4" />
              Add Vehicle
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Truck className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalVehicles}</p>
              <p className="text-sm text-gray-500">Total Vehicles</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{expiredCount}</p>
              <p className="text-sm text-gray-500">Expired</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <Calendar className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-yellow-600">{dueSoonCount}</p>
              <p className="text-sm text-gray-500">Due in 30 Days</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Calendar className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{upcomingCount}</p>
              <p className="text-sm text-gray-500">Due in 60 Days</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, plate, make, model..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          >
            {statusFilters.map(status => (
              <option key={status} value={status}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Vehicles Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Vehicle</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Plate / VIN</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Registration</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Assigned To</th>
                <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin text-gray-400" />
                    Loading...
                  </td>
                </tr>
              ) : vehicles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    <Truck className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p className="font-medium">No vehicles found</p>
                    <p className="text-sm mt-1">Add your first vehicle to get started</p>
                    <Link href="/vehicles/new">
                      <Button className="mt-4">
                        <Plus className="h-4 w-4" />
                        Add Vehicle
                      </Button>
                    </Link>
                  </td>
                </tr>
              ) : (
                vehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/vehicles/${vehicle.id}`} className="block hover:text-green-600">
                        <p className="font-medium text-gray-900">{vehicle.name}</p>
                        {(vehicle.year || vehicle.make || vehicle.model) && (
                          <p className="text-sm text-gray-500">
                            {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}
                          </p>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-mono text-gray-900">{vehicle.license_plate || '—'}</p>
                      {vehicle.vin && (
                        <p className="text-xs text-gray-500 font-mono">{vehicle.vin}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {vehicle.registration_due_date ? (
                        <div>
                          {getStatusBadge(vehicle)}
                          <p className="text-xs text-gray-500 mt-1">
                            {format(new Date(vehicle.registration_due_date), 'MMM d, yyyy')}
                          </p>
                        </div>
                      ) : (
                        <span className="text-gray-400">Not set</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {vehicle.assigned_user ? (
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-green-100 flex items-center justify-center text-xs font-semibold text-green-700">
                            {vehicle.assigned_user.name?.charAt(0) || 'U'}
                          </div>
                          <span className="text-sm text-gray-700">{vehicle.assigned_user.name}</span>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-sm">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {getVehicleStatusBadge(vehicle.status)}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/vehicles/${vehicle.id}`}>
                        <button className="p-1.5 text-gray-400 hover:bg-gray-100 rounded transition-colors">
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
