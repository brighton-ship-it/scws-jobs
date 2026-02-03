'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Plus, 
  Search, 
  Inbox, 
  CheckCircle, 
  Clock, 
  AlertTriangle, 
  ArrowRight, 
  Phone, 
  Mail, 
  MapPin,
  Calendar,
  RefreshCw,
  Loader2,
  ExternalLink
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import type { BookingRequest } from '@/types/database';

const serviceTypeLabels: Record<string, string> = {
  pump_repair: 'Well Pump Repair',
  no_water: 'No Water Emergency',
  low_pressure: 'Low Water Pressure',
  inspection: 'Well Inspection',
  new_well: 'New Well Drilling',
  other: 'Other Service',
};

const statusOptions = [
  { value: 'all', label: 'All Requests' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'cancelled', label: 'Cancelled' },
];

function formatPhone(phone: string): string {
  if (phone.length === 10) {
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
  }
  if (phone.length === 11 && phone[0] === '1') {
    return `(${phone.slice(1, 4)}) ${phone.slice(4, 7)}-${phone.slice(7)}`;
  }
  return phone;
}

export default function RequestsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/booking');
      if (res.ok) {
        const data = await res.json();
        setRequests(data.bookings || []);
      }
    } catch (error) {
      console.error('Failed to fetch requests:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter requests
  const filteredRequests = requests.filter(req => {
    const matchesSearch = 
      req.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      req.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (serviceTypeLabels[req.service_type] || req.service_type).toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || req.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Stats
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const confirmedCount = requests.filter(r => r.status === 'confirmed').length;
  const scheduledCount = requests.filter(r => r.status === 'scheduled').length;
  const urgentCount = requests.filter(r => r.service_type === 'no_water' && r.status === 'pending').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Service Requests</h1>
          <p className="text-gray-500">Online booking requests from customers</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchRequests}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button>
            <Plus className="h-4 w-4" />
            New Request
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar Stats */}
        <div className="lg:col-span-1 space-y-4">
          {/* Overview Card */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-4">Overview</h3>
            <div className="space-y-3">
              <button 
                onClick={() => setStatusFilter('pending')}
                className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors ${
                  statusFilter === 'pending' ? 'bg-green-50 text-green-700' : 'hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Inbox className="h-4 w-4" />
                  Pending
                </span>
                <span className="font-semibold">{pendingCount}</span>
              </button>
              <button 
                onClick={() => setStatusFilter('confirmed')}
                className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors ${
                  statusFilter === 'confirmed' ? 'bg-green-50 text-green-700' : 'hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Confirmed
                </span>
                <span className="font-semibold">{confirmedCount}</span>
              </button>
              <button 
                onClick={() => setStatusFilter('scheduled')}
                className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors ${
                  statusFilter === 'scheduled' ? 'bg-green-50 text-green-700' : 'hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Scheduled
                </span>
                <span className="font-semibold">{scheduledCount}</span>
              </button>
              {urgentCount > 0 && (
                <button 
                  onClick={() => setStatusFilter('pending')}
                  className="w-full flex items-center justify-between p-2 rounded-lg transition-colors text-red-600 bg-red-50 hover:bg-red-100"
                >
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    No Water (Urgent)
                  </span>
                  <span className="font-semibold">{urgentCount}</span>
                </button>
              )}
            </div>
          </div>

          {/* Stats Card */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-4">Total Requests</h3>
            <div className="space-y-4">
              <div>
                <p className="text-3xl font-bold text-gray-900">{requests.length}</p>
                <p className="text-sm text-gray-500">All time</p>
              </div>
              <div className="border-t border-gray-200 pt-4">
                <p className="text-2xl font-bold text-green-600">
                  {requests.filter(r => r.status === 'scheduled' || r.job_id).length}
                </p>
                <p className="text-sm text-gray-500">Converted to jobs</p>
              </div>
            </div>
          </div>

          {/* Embed Instructions */}
          <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
            <h3 className="font-semibold text-blue-900 mb-2">Embed Widget</h3>
            <p className="text-sm text-blue-700 mb-3">
              Add booking to your website:
            </p>
            <code className="text-xs bg-blue-100 p-2 rounded block overflow-x-auto">
              {`<div id="scws-booking"></div>\n<script src="${typeof window !== 'undefined' ? window.location.origin : ''}/embed/booking-widget.js"></script>`}
            </code>
          </div>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3 space-y-4">
          {/* Search & Filters */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search requests..."
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
                {statusOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Requests List */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-gray-400" />
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Inbox className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p className="font-medium">No requests found</p>
                <p className="text-sm mt-1">
                  {statusFilter === 'pending' 
                    ? 'New booking requests will appear here' 
                    : 'Try changing the filter'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {filteredRequests.map((request) => (
                  <div 
                    key={request.id} 
                    className={`p-4 hover:bg-gray-50 transition-colors ${
                      request.service_type === 'no_water' ? 'bg-red-50 border-l-4 border-red-500' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          {request.service_type === 'no_water' && (
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                          )}
                          <h3 className="font-medium text-gray-900">
                            {serviceTypeLabels[request.service_type] || request.service_type}
                          </h3>
                          <Badge 
                            variant={
                              request.status === 'pending' ? 'warning' :
                              request.status === 'confirmed' ? 'info' :
                              request.status === 'scheduled' ? 'success' :
                              request.status === 'cancelled' ? 'default' : 'default'
                            }
                            size="sm"
                          >
                            {request.status}
                          </Badge>
                          {request.customer_id && (
                            <Badge variant="success" size="sm">Existing Customer</Badge>
                          )}
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                            via {request.source}
                          </span>
                        </div>
                        
                        <p className="font-medium text-gray-700">{request.customer_name}</p>
                        
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-gray-500">
                          <a href={`tel:${request.phone}`} className="flex items-center gap-1 hover:text-green-600">
                            <Phone className="h-3.5 w-3.5" />
                            {formatPhone(request.phone)}
                          </a>
                          {request.email && (
                            <a href={`mailto:${request.email}`} className="flex items-center gap-1 hover:text-green-600">
                              <Mail className="h-3.5 w-3.5" />
                              {request.email}
                            </a>
                          )}
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {request.address}, {request.city}
                          </span>
                        </div>

                        {(request.preferred_date || request.preferred_time) && (
                          <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
                            {request.preferred_date && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3.5 w-3.5" />
                                {format(new Date(request.preferred_date), 'MMM d, yyyy')}
                              </span>
                            )}
                            {request.preferred_time && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                {request.preferred_time}
                              </span>
                            )}
                          </div>
                        )}

                        {request.notes && (
                          <p className="mt-2 text-sm text-gray-600 bg-gray-50 p-2 rounded">
                            {request.notes}
                          </p>
                        )}

                        {request.job_id && (
                          <p className="mt-2 text-sm text-green-600 flex items-center gap-1">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Converted to Job
                            <Link href={`/jobs/${request.job_id}`} className="underline hover:no-underline">
                              #{request.job_id}
                            </Link>
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-sm text-gray-500">
                          {format(new Date(request.created_at), 'MMM d, h:mm a')}
                        </span>
                        {request.status === 'pending' && (
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline">
                              <Phone className="h-3.5 w-3.5 mr-1" />
                              Call
                            </Button>
                            <Button size="sm" className="bg-green-600 hover:bg-green-700">
                              <CheckCircle className="h-3.5 w-3.5 mr-1" />
                              Create Job
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
