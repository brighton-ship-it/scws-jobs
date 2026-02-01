'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { JobStatusBadge, PriorityBadge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableEmpty } from '@/components/ui/Table';
import {
  mockJobs,
  getPropertyById,
  getCustomerById,
  getUserById,
} from '@/lib/mock-data';
import {
  Search,
  Plus,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  Clock,
  FileText,
  AlertTriangle,
  CalendarX,
} from 'lucide-react';
import { format, isPast, isToday, isFuture, addDays } from 'date-fns';

// Jobber-style status filters
const statusFilters = [
  { value: 'all', label: 'All Jobs' },
  { value: 'late', label: 'Late' },
  { value: 'requires_invoicing', label: 'Requires Invoicing' },
  { value: 'action_required', label: 'Action Required' },
  { value: 'unscheduled', label: 'Unscheduled' },
  { value: 'scheduled', label: 'Upcoming' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'invoiced', label: 'Archived' },
];

type SortField = 'client' | 'job_number' | 'property' | 'schedule' | 'status' | 'total';
type SortDirection = 'asc' | 'desc';

// Calculate job stats for sidebar
function useJobStats() {
  return useMemo(() => {
    const today = new Date();
    const thirtyDaysFromNow = addDays(today, 30);
    
    let late = 0;
    let requiresInvoicing = 0;
    let actionRequired = 0;
    let unscheduled = 0;
    let endingWithin30Days = 0;

    mockJobs.forEach(job => {
      // Late: has past scheduled date and not completed
      if (job.scheduled_date && isPast(new Date(job.scheduled_date)) && 
          !isToday(new Date(job.scheduled_date)) &&
          job.status !== 'completed' && job.status !== 'invoiced') {
        late++;
      }
      
      // Requires invoicing: completed but not invoiced
      if (job.status === 'completed') {
        requiresInvoicing++;
      }
      
      // Action required: urgent priority or in_progress
      if (job.priority === 'urgent' || job.priority === 'high') {
        actionRequired++;
      }
      
      // Unscheduled
      if (!job.scheduled_date || !job.assigned_to) {
        unscheduled++;
      }

      // Ending within 30 days (for recurring - mock as scheduled jobs in range)
      if (job.scheduled_date) {
        const schedDate = new Date(job.scheduled_date);
        if (schedDate >= today && schedDate <= thirtyDaysFromNow) {
          endingWithin30Days++;
        }
      }
    });

    return { late, requiresInvoicing, actionRequired, unscheduled, endingWithin30Days };
  }, []);
}

export default function JobsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('schedule');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  const stats = useJobStats();

  // Get derived status for a job (Jobber-style)
  const getDerivedStatus = (job: typeof mockJobs[0]) => {
    if (job.status === 'invoiced') return 'invoiced';
    if (job.status === 'completed') return 'requires_invoicing';
    
    if (!job.scheduled_date || !job.assigned_to) return 'unscheduled';
    
    const schedDate = new Date(job.scheduled_date);
    if (isPast(schedDate) && !isToday(schedDate) && job.status !== 'completed') {
      return 'late';
    }
    
    if (job.priority === 'urgent' || job.priority === 'high') {
      return 'action_required';
    }
    
    return job.status;
  };

  const filteredJobs = useMemo(() => {
    return mockJobs.filter((job) => {
      const property = getPropertyById(job.property_id);
      const customer = property ? getCustomerById(property.customer_id) : null;

      const matchesSearch =
        search === '' ||
        job.job_type.toLowerCase().includes(search.toLowerCase()) ||
        customer?.name.toLowerCase().includes(search.toLowerCase()) ||
        property?.address.toLowerCase().includes(search.toLowerCase()) ||
        job.id.includes(search);

      const derivedStatus = getDerivedStatus(job);
      const matchesStatus = statusFilter === 'all' || derivedStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [search, statusFilter]);

  // Sort jobs
  const sortedJobs = useMemo(() => {
    return [...filteredJobs].sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';

      const propA = getPropertyById(a.property_id);
      const propB = getPropertyById(b.property_id);
      const custA = propA ? getCustomerById(propA.customer_id) : null;
      const custB = propB ? getCustomerById(propB.customer_id) : null;

      switch (sortField) {
        case 'client':
          aVal = custA?.name || '';
          bVal = custB?.name || '';
          break;
        case 'job_number':
          aVal = a.id;
          bVal = b.id;
          break;
        case 'property':
          aVal = propA?.address || '';
          bVal = propB?.address || '';
          break;
        case 'schedule':
          aVal = a.scheduled_date ? new Date(a.scheduled_date).getTime() : 0;
          bVal = b.scheduled_date ? new Date(b.scheduled_date).getTime() : 0;
          break;
        case 'status':
          aVal = getDerivedStatus(a);
          bVal = getDerivedStatus(b);
          break;
        case 'total':
          // Mock total based on job type
          aVal = a.job_type.length * 100; // Placeholder
          bVal = b.job_type.length * 100;
          break;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      
      return sortDirection === 'asc' 
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }, [filteredJobs, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' 
      ? <ChevronUp className="h-4 w-4" />
      : <ChevronDown className="h-4 w-4" />;
  };

  return (
    <div className="flex gap-6">
      {/* Sidebar - Quick Filters */}
      <div className="hidden lg:block w-56 flex-shrink-0">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700">Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <button
              onClick={() => setStatusFilter('all')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                statusFilter === 'all' ? 'bg-green-50 text-green-700' : 'hover:bg-gray-50'
              }`}
            >
              <span>All Jobs</span>
              <span className="text-gray-500">{mockJobs.length}</span>
            </button>
            
            <div className="h-px bg-gray-100 my-2" />
            
            <button
              onClick={() => setStatusFilter('late')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                statusFilter === 'late' ? 'bg-red-50 text-red-700' : 'hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500" />
                Late
              </span>
              <span className={stats.late > 0 ? 'text-red-600 font-medium' : 'text-gray-500'}>{stats.late}</span>
            </button>
            
            <button
              onClick={() => setStatusFilter('requires_invoicing')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                statusFilter === 'requires_invoicing' ? 'bg-purple-50 text-purple-700' : 'hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-purple-500" />
                Requires Invoicing
              </span>
              <span className={stats.requiresInvoicing > 0 ? 'text-purple-600 font-medium' : 'text-gray-500'}>{stats.requiresInvoicing}</span>
            </button>
            
            <button
              onClick={() => setStatusFilter('action_required')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                statusFilter === 'action_required' ? 'bg-orange-50 text-orange-700' : 'hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                Action Required
              </span>
              <span className={stats.actionRequired > 0 ? 'text-orange-600 font-medium' : 'text-gray-500'}>{stats.actionRequired}</span>
            </button>
            
            <button
              onClick={() => setStatusFilter('unscheduled')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                statusFilter === 'unscheduled' ? 'bg-yellow-50 text-yellow-700' : 'hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <CalendarX className="h-4 w-4 text-yellow-500" />
                Unscheduled
              </span>
              <span className={stats.unscheduled > 0 ? 'text-yellow-600 font-medium' : 'text-gray-500'}>{stats.unscheduled}</span>
            </button>
          </CardContent>
        </Card>

        {/* Recent/Upcoming Stats */}
        <div className="mt-4 space-y-3">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs font-medium text-gray-500 uppercase">Recent Visits</p>
              <p className="text-sm text-gray-600">Past 30 days</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {mockJobs.filter(j => j.status === 'completed' || j.status === 'invoiced').length}
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="py-4">
              <p className="text-xs font-medium text-gray-500 uppercase">Visits Scheduled</p>
              <p className="text-sm text-gray-600">Next 30 days</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {mockJobs.filter(j => j.status === 'scheduled' && j.scheduled_date).length}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
            <p className="text-gray-600">{filteredJobs.length} of {mockJobs.length} jobs</p>
          </div>
          <Button href="/jobs/new">
            <Plus className="h-4 w-4" />
            Create Job
          </Button>
        </div>

        {/* Filters Bar */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              {/* Status dropdown */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              >
                {statusFilters.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </select>

              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search jobs..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-10 pr-4 text-sm placeholder-gray-500 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Jobs Table - Jobber style */}
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableCell header>
                  <button 
                    onClick={() => handleSort('client')}
                    className="flex items-center gap-1 hover:text-gray-900"
                  >
                    Client <SortIcon field="client" />
                  </button>
                </TableCell>
                <TableCell header>
                  <button 
                    onClick={() => handleSort('job_number')}
                    className="flex items-center gap-1 hover:text-gray-900"
                  >
                    Job # <SortIcon field="job_number" />
                  </button>
                </TableCell>
                <TableCell header>
                  <button 
                    onClick={() => handleSort('property')}
                    className="flex items-center gap-1 hover:text-gray-900"
                  >
                    Property <SortIcon field="property" />
                  </button>
                </TableCell>
                <TableCell header>
                  <button 
                    onClick={() => handleSort('schedule')}
                    className="flex items-center gap-1 hover:text-gray-900"
                  >
                    Schedule <SortIcon field="schedule" />
                  </button>
                </TableCell>
                <TableCell header>
                  <button 
                    onClick={() => handleSort('status')}
                    className="flex items-center gap-1 hover:text-gray-900"
                  >
                    Status <SortIcon field="status" />
                  </button>
                </TableCell>
                <TableCell header className="text-right">
                  <button 
                    onClick={() => handleSort('total')}
                    className="flex items-center gap-1 hover:text-gray-900 ml-auto"
                  >
                    Total <SortIcon field="total" />
                  </button>
                </TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedJobs.length === 0 ? (
                <TableEmpty message="No jobs found" />
              ) : (
                sortedJobs.map((job) => {
                  const property = getPropertyById(job.property_id);
                  const customer = property ? getCustomerById(property.customer_id) : null;
                  const derivedStatus = getDerivedStatus(job);
                  const mockTotal = (job.job_type.length * 100) + 250; // Mock pricing

                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <Link href={`/jobs/${job.id}`} className="hover:text-green-600">
                          <p className="font-medium text-gray-900">{customer?.name || 'Unknown'}</p>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/jobs/${job.id}`} className="hover:text-green-600">
                          <p className="font-medium text-gray-900">#{job.id}</p>
                          <p className="text-sm text-gray-500">{job.job_type}</p>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <p className="text-gray-900">{property?.address || 'Unknown'}</p>
                        <p className="text-sm text-gray-500">{property?.city}</p>
                      </TableCell>
                      <TableCell>
                        {job.scheduled_date ? (
                          <>
                            {job.status === 'completed' || job.status === 'invoiced' ? (
                              <p className="text-xs font-medium text-gray-500 uppercase">Completed</p>
                            ) : null}
                            <p className="text-gray-900">
                              {format(new Date(job.scheduled_date), 'MMM d, yyyy')}
                            </p>
                            {job.scheduled_time && (
                              <p className="text-sm text-gray-500">{job.scheduled_time}</p>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-400 italic">Unscheduled</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <JobStatusBadge status={derivedStatus} />
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="font-medium text-gray-900">
                          ${mockTotal.toLocaleString()}
                        </p>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
