'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JobStatusBadge, PriorityBadge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableEmpty } from '@/components/ui/table';
import { AssignedTeamInline } from '@/components/scheduling';
import type { User } from '@/types/database';
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
  Briefcase,
  Users,
  Filter,
  Loader2,
} from 'lucide-react';
import { format, isPast, isToday, isFuture, addDays } from 'date-fns';

// Job type from API
interface JobData {
  id: string;
  job_type: string;
  status: string;
  priority?: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  description: string | null;
  assigned_to: string | null;
  created_at: string;
  property?: {
    id: string;
    address: string;
    city: string;
    customer?: {
      id: string;
      name: string;
      email: string;
      phone: string;
    };
  };
  assigned_user?: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

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

// Get derived status for a job (Jobber-style)
const getDerivedStatus = (job: JobData) => {
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

export default function JobsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('schedule');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  // Data state
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [fieldCrew, setFieldCrew] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const [jobsRes, usersRes] = await Promise.all([
          fetch('/api/jobs?limit=500'),
          fetch('/api/users?role=field'),
        ]);

        if (!jobsRes.ok) throw new Error('Failed to fetch jobs');

        const [jobsData, usersData] = await Promise.all([
          jobsRes.json(),
          usersRes.json(),
        ]);

        setJobs(jobsData.jobs || []);
        setFieldCrew(usersData.users || []);
      } catch (err) {
        console.error('Failed to fetch data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Calculate job stats
  const stats = useMemo(() => {
    const today = new Date();
    const thirtyDaysFromNow = addDays(today, 30);
    
    let late = 0;
    let requiresInvoicing = 0;
    let actionRequired = 0;
    let unscheduled = 0;
    let endingWithin30Days = 0;

    jobs.forEach(job => {
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

      // Ending within 30 days (for recurring - scheduled jobs in range)
      if (job.scheduled_date) {
        const schedDate = new Date(job.scheduled_date);
        if (schedDate >= today && schedDate <= thirtyDaysFromNow) {
          endingWithin30Days++;
        }
      }
    });

    return { late, requiresInvoicing, actionRequired, unscheduled, endingWithin30Days };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesSearch =
        search === '' ||
        job.job_type?.toLowerCase().includes(search.toLowerCase()) ||
        job.property?.customer?.name?.toLowerCase().includes(search.toLowerCase()) ||
        job.property?.address?.toLowerCase().includes(search.toLowerCase()) ||
        job.id.includes(search);

      const derivedStatus = getDerivedStatus(job);
      const matchesStatus = statusFilter === 'all' || derivedStatus === statusFilter;
      
      // Assignee filter
      const matchesAssignee = 
        assigneeFilter === 'all' || 
        (assigneeFilter === 'unassigned' && !job.assigned_to) ||
        job.assigned_to === assigneeFilter;

      return matchesSearch && matchesStatus && matchesAssignee;
    });
  }, [jobs, search, statusFilter, assigneeFilter]);

  // Sort jobs
  const sortedJobs = useMemo(() => {
    return [...filteredJobs].sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';

      switch (sortField) {
        case 'client':
          aVal = a.property?.customer?.name || '';
          bVal = b.property?.customer?.name || '';
          break;
        case 'job_number':
          aVal = a.id;
          bVal = b.id;
          break;
        case 'property':
          aVal = a.property?.address || '';
          bVal = b.property?.address || '';
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
          aVal = a.job_type?.length || 0 * 100;
          bVal = b.job_type?.length || 0 * 100;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Loading jobs...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900">Failed to load jobs</h2>
        <p className="text-gray-500 mt-2">{error}</p>
        <Button onClick={() => window.location.reload()} className="mt-4">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-6 animate-fade-in">
      {/* Sidebar - Quick Filters - Jobber Style */}
      <div className="hidden lg:block w-56 flex-shrink-0">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0.5 pt-0">
            <button
              onClick={() => setStatusFilter('all')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                statusFilter === 'all' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span>All Jobs</span>
              <span className={statusFilter === 'all' ? 'text-emerald-600' : 'text-gray-400'}>{jobs.length}</span>
            </button>
            
            <div className="h-px bg-gray-100 my-2" />
            
            <button
              onClick={() => setStatusFilter('late')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                statusFilter === 'late' ? 'bg-red-50 text-red-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <AlertCircle className="h-4 w-4 text-red-500" />
                Late
              </span>
              <span className={stats.late > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}>{stats.late}</span>
            </button>
            
            <button
              onClick={() => setStatusFilter('requires_invoicing')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                statusFilter === 'requires_invoicing' ? 'bg-purple-50 text-purple-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <FileText className="h-4 w-4 text-purple-500" />
                Requires Invoicing
              </span>
              <span className={stats.requiresInvoicing > 0 ? 'text-purple-600 font-semibold' : 'text-gray-400'}>{stats.requiresInvoicing}</span>
            </button>
            
            <button
              onClick={() => setStatusFilter('action_required')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                statusFilter === 'action_required' ? 'bg-orange-50 text-orange-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                Action Required
              </span>
              <span className={stats.actionRequired > 0 ? 'text-orange-600 font-semibold' : 'text-gray-400'}>{stats.actionRequired}</span>
            </button>
            
            <button
              onClick={() => setStatusFilter('unscheduled')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                statusFilter === 'unscheduled' ? 'bg-amber-50 text-amber-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <CalendarX className="h-4 w-4 text-amber-500" />
                Unscheduled
              </span>
              <span className={stats.unscheduled > 0 ? 'text-amber-600 font-semibold' : 'text-gray-400'}>{stats.unscheduled}</span>
            </button>
          </CardContent>
        </Card>

        {/* Recent/Upcoming Stats */}
        <div className="mt-4 space-y-3">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Visits</p>
              <p className="text-sm text-gray-500 mt-0.5">Past 30 days</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">
                {jobs.filter(j => j.status === 'completed' || j.status === 'invoiced').length}
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="py-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Visits Scheduled</p>
              <p className="text-sm text-gray-500 mt-0.5">Next 30 days</p>
              <p className="text-2xl font-bold text-gray-900 mt-2">
                {jobs.filter(j => j.status === 'scheduled' && j.scheduled_date).length}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
            <p className="text-sm text-gray-500 mt-0.5">{filteredJobs.length} of {jobs.length} jobs</p>
          </div>
          <Button href="/jobs/new">
            <Plus className="h-4 w-4" />
            Create Job
          </Button>
        </div>

        {/* Filters Bar - Jobber Style */}
        <Card>
          <CardContent className="py-3.5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {/* Status dropdown */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
              >
                {statusFilters.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </select>

              {/* Assignee dropdown */}
              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
              >
                <option value="all">All Team Members</option>
                <option value="unassigned">Unassigned</option>
                {fieldCrew.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
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
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-10 pr-4 text-sm placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Jobs Table - Jobber style */}
        <Card className="overflow-hidden">
          <Table className="border-0 rounded-none">
            <TableHeader>
              <TableRow className="bg-gray-50/80">
                <TableCell header>
                  <button 
                    onClick={() => handleSort('client')}
                    className="flex items-center gap-1.5 hover:text-gray-900 transition-colors"
                  >
                    Client <SortIcon field="client" />
                  </button>
                </TableCell>
                <TableCell header>
                  <button 
                    onClick={() => handleSort('job_number')}
                    className="flex items-center gap-1.5 hover:text-gray-900 transition-colors"
                  >
                    Job # <SortIcon field="job_number" />
                  </button>
                </TableCell>
                <TableCell header>
                  <button 
                    onClick={() => handleSort('property')}
                    className="flex items-center gap-1.5 hover:text-gray-900 transition-colors"
                  >
                    Property <SortIcon field="property" />
                  </button>
                </TableCell>
                <TableCell header>
                  <button 
                    onClick={() => handleSort('schedule')}
                    className="flex items-center gap-1.5 hover:text-gray-900 transition-colors"
                  >
                    Schedule <SortIcon field="schedule" />
                  </button>
                </TableCell>
                <TableCell header>
                  <span className="flex items-center gap-1.5">
                    <Users className="h-4 w-4" />
                    Assigned
                  </span>
                </TableCell>
                <TableCell header>
                  <button 
                    onClick={() => handleSort('status')}
                    className="flex items-center gap-1.5 hover:text-gray-900 transition-colors"
                  >
                    Status <SortIcon field="status" />
                  </button>
                </TableCell>
                <TableCell header className="text-right">
                  <button 
                    onClick={() => handleSort('total')}
                    className="flex items-center gap-1.5 hover:text-gray-900 ml-auto transition-colors"
                  >
                    Total <SortIcon field="total" />
                  </button>
                </TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedJobs.length === 0 ? (
                <TableEmpty 
                  message="No jobs found" 
                  icon={<Briefcase className="h-8 w-8" />}
                />
              ) : (
                sortedJobs.map((job) => {
                  const derivedStatus = getDerivedStatus(job);
                  const mockTotal = (job.job_type?.length || 5) * 100 + 250; // Mock pricing
                  const assignedUsers = job.assigned_user ? [job.assigned_user] : [];

                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <Link href={`/jobs/${job.id}`} className="hover:text-emerald-600 transition-colors">
                          <p className="font-medium text-gray-900">{job.property?.customer?.name || 'Unknown'}</p>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/jobs/${job.id}`} className="hover:text-emerald-600 transition-colors">
                          <p className="font-medium text-gray-900">#{job.id.slice(0, 8)}</p>
                          <p className="text-sm text-gray-500">{job.job_type}</p>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <p className="text-gray-900">{job.property?.address || 'Unknown'}</p>
                        <p className="text-sm text-gray-500">{job.property?.city}</p>
                      </TableCell>
                      <TableCell>
                        {job.scheduled_date ? (
                          <>
                            {(job.status === 'completed' || job.status === 'invoiced') && (
                              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Completed</p>
                            )}
                            <p className="text-gray-900">
                              {format(new Date(job.scheduled_date), 'MMM d, yyyy')}
                            </p>
                            {job.scheduled_time && (
                              <p className="text-sm text-gray-500">{job.scheduled_time}</p>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-400 italic text-sm">Unscheduled</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <AssignedTeamInline users={assignedUsers} />
                      </TableCell>
                      <TableCell>
                        <JobStatusBadge status={derivedStatus} />
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="font-semibold text-gray-900">
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
