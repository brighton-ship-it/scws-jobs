'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Inbox, CheckCircle, Clock, AlertTriangle, ArrowRight, Phone, Mail, MapPin } from 'lucide-react';
import Badge from '@/components/ui/Badge';

// Mock data - will be replaced with Supabase
const mockRequests = [
  { 
    id: '1', 
    title: 'Water pressure low - need service call',
    contactName: 'Maria Santos',
    contactPhone: '(760) 555-0123',
    contactEmail: 'msantos@email.com',
    address: '1234 Oak Valley Rd, Valley Center, CA',
    requestedDate: '2026-01-28',
    source: 'website',
    status: 'new',
    createdAt: '2026-01-28',
  },
  { 
    id: '2', 
    title: 'Quote for new well drilling',
    contactName: 'Robert Chen',
    contactPhone: '(858) 555-0456',
    contactEmail: 'rchen@gmail.com',
    address: '5678 Mountain View Dr, Escondido, CA',
    requestedDate: '2026-01-25',
    source: 'phone',
    status: 'assessment_complete',
    createdAt: '2026-01-25',
    notes: 'Spoke with customer. Needs 400ft well for new construction. Site visit completed 1/27.',
  },
  { 
    id: '3', 
    title: 'Pump making noise',
    contactName: 'James Wilson',
    contactPhone: '(619) 555-0789',
    contactEmail: null,
    address: '9012 Highland Rd, Ramona, CA',
    requestedDate: '2026-01-20',
    source: 'referral',
    status: 'new',
    createdAt: '2026-01-20',
  },
  { 
    id: '4', 
    title: 'Annual service - Oak Tree Ranch',
    contactName: 'Oak Tree Ranch',
    contactPhone: '(760) 555-0321',
    contactEmail: 'office@oaktreeranch.com',
    address: '15000 Ranch Rd, Valley Center, CA',
    requestedDate: '2026-02-15',
    source: 'phone',
    status: 'converted',
    createdAt: '2026-01-15',
    convertedToJob: '#622',
  },
];

const statusOptions = [
  { value: 'all', label: 'All Requests' },
  { value: 'new', label: 'New' },
  { value: 'assessment_complete', label: 'Assessment Complete' },
  { value: 'converted', label: 'Converted' },
];

const sourceLabels: Record<string, string> = {
  website: 'Website',
  phone: 'Phone',
  referral: 'Referral',
  manual: 'Manual',
  other: 'Other',
};

export default function RequestsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Filter requests
  const filteredRequests = mockRequests.filter(req => {
    const matchesSearch = 
      req.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      req.contactName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      req.address.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || req.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Stats
  const newCount = mockRequests.filter(r => r.status === 'new').length;
  const assessmentCount = mockRequests.filter(r => r.status === 'assessment_complete').length;
  const convertedCount = mockRequests.filter(r => r.status === 'converted').length;
  const overdueCount = mockRequests.filter(r => 
    r.status === 'new' && 
    new Date(r.createdAt) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  ).length;

  // Conversion rate (last 30 days)
  const conversionRate = mockRequests.length > 0 
    ? Math.round((convertedCount / mockRequests.length) * 100) 
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Requests</h1>
          <p className="text-gray-500">Incoming work requests and leads</p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors">
          <Plus className="h-4 w-4" />
          New Request
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar Stats */}
        <div className="lg:col-span-1 space-y-4">
          {/* Overview Card */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-4">Overview</h3>
            <div className="space-y-3">
              <button 
                onClick={() => setStatusFilter('new')}
                className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors ${
                  statusFilter === 'new' ? 'bg-green-50 text-green-700' : 'hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Inbox className="h-4 w-4" />
                  New
                </span>
                <span className="font-semibold">{newCount}</span>
              </button>
              <button 
                onClick={() => setStatusFilter('assessment_complete')}
                className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors ${
                  statusFilter === 'assessment_complete' ? 'bg-green-50 text-green-700' : 'hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Assessment complete
                </span>
                <span className="font-semibold">{assessmentCount}</span>
              </button>
              <button 
                onClick={() => setStatusFilter('all')}
                className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors ${
                  overdueCount > 0 ? 'text-red-600' : ''
                } ${statusFilter === 'all' && overdueCount > 0 ? 'bg-red-50' : 'hover:bg-gray-50'}`}
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Overdue (7+ days)
                </span>
                <span className="font-semibold">{overdueCount}</span>
              </button>
            </div>
          </div>

          {/* Stats Card */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-4">Last 30 Days</h3>
            <div className="space-y-4">
              <div>
                <p className="text-3xl font-bold text-gray-900">{mockRequests.length}</p>
                <p className="text-sm text-gray-500">New requests</p>
              </div>
              <div className="border-t border-gray-200 pt-4">
                <p className="text-3xl font-bold text-green-600">{conversionRate}%</p>
                <p className="text-sm text-gray-500">Conversion rate</p>
              </div>
            </div>
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
            {filteredRequests.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Inbox className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p className="font-medium">No requests found</p>
                <p className="text-sm mt-1">New requests will appear here</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {filteredRequests.map((request) => (
                  <div key={request.id} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-medium text-gray-900">{request.title}</h3>
                          <Badge 
                            variant={
                              request.status === 'new' ? 'blue' :
                              request.status === 'assessment_complete' ? 'yellow' :
                              request.status === 'converted' ? 'green' : 'gray'
                            }
                            size="sm"
                          >
                            {request.status.replace('_', ' ')}
                          </Badge>
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                            via {sourceLabels[request.source]}
                          </span>
                        </div>
                        
                        <p className="font-medium text-gray-700">{request.contactName}</p>
                        
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-gray-500">
                          {request.contactPhone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3.5 w-3.5" />
                              {request.contactPhone}
                            </span>
                          )}
                          {request.contactEmail && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3.5 w-3.5" />
                              {request.contactEmail}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {request.address}
                          </span>
                        </div>

                        {request.notes && (
                          <p className="mt-2 text-sm text-gray-600 bg-gray-50 p-2 rounded">
                            {request.notes}
                          </p>
                        )}

                        {request.convertedToJob && (
                          <p className="mt-2 text-sm text-green-600">
                            Converted to Job {request.convertedToJob}
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-sm text-gray-500">
                          {new Date(request.createdAt).toLocaleDateString()}
                        </span>
                        {request.status !== 'converted' && (
                          <div className="flex gap-2">
                            <button className="text-sm text-green-600 hover:text-green-700 font-medium flex items-center gap-1">
                              Convert to Quote
                              <ArrowRight className="h-3.5 w-3.5" />
                            </button>
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
