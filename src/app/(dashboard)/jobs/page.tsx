'use client';


import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { JobStatusBadge } from '@/components/ui/Badge';
import {
  mockJobs,
  getPropertyById,
  getCustomerById,
  getUserById,
} from '@/lib/mock-data';
import {
  Search,
  Plus,
  Calendar,
  Clock,
  MapPin,
  User,
  Filter,
} from 'lucide-react';
import { format } from 'date-fns';

const statusFilters = [
  { value: 'all', label: 'All Jobs' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'invoiced', label: 'Invoiced' },
];

export default function JobsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredJobs = mockJobs.filter((job) => {
    const property = getPropertyById(job.property_id);
    const customer = property ? getCustomerById(property.customer_id) : null;

    const matchesSearch =
      job.job_type.toLowerCase().includes(search.toLowerCase()) ||
      customer?.name.toLowerCase().includes(search.toLowerCase()) ||
      property?.address.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === 'all' || job.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Sort by scheduled date, most recent first
  const sortedJobs = [...filteredJobs].sort((a, b) => {
    const dateA = a.scheduled_date ? new Date(a.scheduled_date).getTime() : 0;
    const dateB = b.scheduled_date ? new Date(b.scheduled_date).getTime() : 0;
    return dateB - dateA;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Jobs</h2>
          <p className="text-gray-600">{mockJobs.length} total jobs</p>
        </div>
        <Button href="/jobs/new">
          <Plus className="h-4 w-4" />
          Create Job
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search jobs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-10 pr-4 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <div className="flex gap-2">
                {statusFilters.map((filter) => (
                  <button
                    key={filter.value}
                    onClick={() => setStatusFilter(filter.value)}
                    className={`
                      rounded-lg px-3 py-1.5 text-sm font-medium transition-colors
                      ${statusFilter === filter.value
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-100'}
                    `}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Jobs List */}
      <div className="space-y-4">
        {sortedJobs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500">No jobs found</p>
            </CardContent>
          </Card>
        ) : (
          sortedJobs.map((job) => {
            const property = getPropertyById(job.property_id);
            const customer = property ? getCustomerById(property.customer_id) : null;
            const assignedUser = job.assigned_to ? getUserById(job.assigned_to) : null;

            return (
              <Link key={job.id} href={`/jobs/${job.id}`}>
                <Card className="hover:border-blue-300 hover:shadow-md transition-all cursor-pointer">
                  <CardContent className="py-4">
                    <div className="flex items-start gap-4">
                      {/* Date/Time Column */}
                      <div className="hidden sm:flex w-24 flex-col items-center justify-center rounded-lg bg-gray-100 py-3">
                        {job.scheduled_date ? (
                          <>
                            <span className="text-xs font-medium text-gray-500">
                              {format(new Date(job.scheduled_date), 'MMM')}
                            </span>
                            <span className="text-2xl font-bold text-gray-900">
                              {format(new Date(job.scheduled_date), 'd')}
                            </span>
                            {job.scheduled_time && (
                              <span className="text-xs text-gray-500">
                                {job.scheduled_time}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-gray-500">Unscheduled</span>
                        )}
                      </div>

                      {/* Main Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold text-gray-900">
                                {job.job_type}
                              </h3>
                              <JobStatusBadge status={job.status} />
                            </div>
                            <p className="text-gray-700 font-medium mt-1">
                              {customer?.name || 'Unknown Customer'}
                            </p>
                          </div>
                        </div>

                        {/* Details */}
                        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-gray-500">
                          {property && (
                            <div className="flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              <span>{property.city || property.address}</span>
                            </div>
                          )}

                          {/* Mobile date */}
                          {job.scheduled_date && (
                            <div className="flex items-center gap-1 sm:hidden">
                              <Calendar className="h-4 w-4" />
                              <span>
                                {format(new Date(job.scheduled_date), 'MMM d')}
                                {job.scheduled_time && ` at ${job.scheduled_time}`}
                              </span>
                            </div>
                          )}

                          {job.estimated_duration && (
                            <div className="flex items-center gap-1">
                              <Clock className="h-4 w-4" />
                              <span>{job.estimated_duration}</span>
                            </div>
                          )}

                          {assignedUser && (
                            <div className="flex items-center gap-1">
                              <User className="h-4 w-4" />
                              <span>{assignedUser.name}</span>
                            </div>
                          )}
                        </div>

                        {job.description && (
                          <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                            {job.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
