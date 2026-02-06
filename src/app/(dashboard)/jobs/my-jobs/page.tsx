'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JobStatusBadge, PriorityBadge } from '@/components/ui/badge';
import { AssignedTeamAvatars } from '@/components/scheduling';
import {
  mockJobs,
  getPropertyById,
  getCustomerById,
  getJobsAssignedToUser,
  getTodaysJobsForUser,
  getActiveJobsAssignedToUser,
  getAssignedUsersForJob,
} from '@/lib/mock-data';
import { useAuth } from '@/contexts/AuthContext';
import {
  Calendar,
  Clock,
  MapPin,
  Phone,
  User,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  ChevronRight,
  CalendarDays,
  ListTodo,
} from 'lucide-react';
import { format, isPast, isToday, isTomorrow, addDays, parseISO } from 'date-fns';

type ViewMode = 'today' | 'upcoming' | 'all';

export default function MyJobsPage() {
  const { user, loading } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>('today');

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-green-500 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Please log in to view your jobs.</p>
      </div>
    );
  }

  const allMyJobs = getJobsAssignedToUser(user.id);
  const todaysJobs = getTodaysJobsForUser(user.id);
  const activeJobs = getActiveJobsAssignedToUser(user.id);
  
  // Get upcoming jobs (next 7 days, excluding today)
  const upcomingJobs = useMemo(() => {
    const today = new Date();
    const weekFromNow = addDays(today, 7);
    return activeJobs.filter(job => {
      if (!job.scheduled_date) return false;
      const jobDate = parseISO(job.scheduled_date);
      return jobDate > today && jobDate <= weekFromNow;
    }).sort((a, b) => {
      if (!a.scheduled_date || !b.scheduled_date) return 0;
      return a.scheduled_date.localeCompare(b.scheduled_date);
    });
  }, [activeJobs]);

  // Group jobs by date for upcoming view
  const jobsByDate = useMemo(() => {
    const grouped: Record<string, typeof activeJobs> = {};
    upcomingJobs.forEach(job => {
      const date = job.scheduled_date || 'unscheduled';
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(job);
    });
    return grouped;
  }, [upcomingJobs]);

  const displayedJobs = viewMode === 'today' 
    ? todaysJobs 
    : viewMode === 'upcoming' 
    ? upcomingJobs 
    : allMyJobs;

  const completedToday = todaysJobs.filter(j => j.status === 'completed' || j.status === 'invoiced').length;
  const remainingToday = todaysJobs.filter(j => j.status === 'scheduled' || j.status === 'in_progress').length;

  const getDateLabel = (dateStr: string) => {
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    return format(date, 'EEEE, MMM d');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Jobs</h1>
          <p className="text-gray-600">
            Welcome back, {user.name.split(' ')[0]}! Here&apos;s your schedule.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('today')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'today'
                  ? 'bg-white shadow text-gray-900'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <CalendarDays className="h-4 w-4 inline mr-1.5" />
              Today
            </button>
            <button
              onClick={() => setViewMode('upcoming')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'upcoming'
                  ? 'bg-white shadow text-gray-900'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Calendar className="h-4 w-4 inline mr-1.5" />
              Upcoming
            </button>
            <button
              onClick={() => setViewMode('all')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'all'
                  ? 'bg-white shadow text-gray-900'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <ListTodo className="h-4 w-4 inline mr-1.5" />
              All
            </button>
          </div>
        </div>
      </div>

      {/* Today's Summary */}
      {viewMode === 'today' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-green-600 flex items-center justify-center">
                  <Briefcase className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-green-700">{todaysJobs.length}</p>
                  <p className="text-sm text-green-600 font-medium">Total Jobs Today</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-blue-600 flex items-center justify-center">
                  <Clock className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-blue-700">{remainingToday}</p>
                  <p className="text-sm text-blue-600 font-medium">Remaining</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-purple-50 to-violet-50 border-purple-200">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-purple-600 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-purple-700">{completedToday}</p>
                  <p className="text-sm text-purple-600 font-medium">Completed</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Jobs List */}
      {viewMode === 'upcoming' ? (
        // Grouped by date for upcoming view
        <div className="space-y-6">
          {Object.keys(jobsByDate).length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">No Upcoming Jobs</h3>
                <p className="text-gray-500">You don&apos;t have any jobs scheduled for the next 7 days.</p>
              </CardContent>
            </Card>
          ) : (
            Object.entries(jobsByDate).map(([date, jobs]) => (
              <div key={date}>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  {getDateLabel(date)}
                </h3>
                <div className="space-y-3">
                  {jobs.map(job => (
                    <JobCard key={job.id} job={job} showDate={false} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        // Regular list for today and all views
        <div className="space-y-3">
          {displayedJobs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Briefcase className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">
                  {viewMode === 'today' ? 'No Jobs Today' : 'No Jobs Assigned'}
                </h3>
                <p className="text-gray-500">
                  {viewMode === 'today' 
                    ? 'You don\'t have any jobs scheduled for today.'
                    : 'You don\'t have any jobs assigned to you yet.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            displayedJobs
              .sort((a, b) => {
                // Sort by time for today view
                if (viewMode === 'today' && a.scheduled_time && b.scheduled_time) {
                  return a.scheduled_time.localeCompare(b.scheduled_time);
                }
                // Sort by date for other views
                if (a.scheduled_date && b.scheduled_date) {
                  return a.scheduled_date.localeCompare(b.scheduled_date);
                }
                return 0;
              })
              .map(job => (
                <JobCard key={job.id} job={job} showDate={viewMode !== 'today'} />
              ))
          )}
        </div>
      )}
    </div>
  );
}

// Job Card Component
function JobCard({ job, showDate = true }: { job: typeof mockJobs[0]; showDate?: boolean }) {
  const property = getPropertyById(job.property_id);
  const customer = property ? getCustomerById(property.customer_id) : null;
  const assignedUsers = getAssignedUsersForJob(job.id);
  
  const isLate = job.scheduled_date && isPast(parseISO(job.scheduled_date)) && 
    !isToday(parseISO(job.scheduled_date)) && 
    job.status !== 'completed' && job.status !== 'invoiced';

  const priorityColors = {
    low: 'border-l-gray-300',
    normal: 'border-l-blue-400',
    high: 'border-l-orange-400',
    urgent: 'border-l-red-500',
  };

  return (
    <Link href={`/jobs/${job.id}`}>
      <Card className={`
        hover:shadow-md transition-all cursor-pointer border-l-4
        ${priorityColors[job.priority || 'normal']}
        ${isLate ? 'bg-red-50 border-red-200' : ''}
      `}>
        <CardContent className="py-4">
          <div className="flex items-start gap-4">
            {/* Time/Date Column */}
            <div className="w-20 flex-shrink-0 text-center">
              {showDate && job.scheduled_date ? (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase">
                    {format(parseISO(job.scheduled_date), 'MMM d')}
                  </p>
                  <p className="text-lg font-bold text-gray-900">
                    {format(parseISO(job.scheduled_date), 'EEE')}
                  </p>
                </div>
              ) : job.scheduled_time ? (
                <div>
                  <p className="text-lg font-bold text-gray-900">{job.scheduled_time}</p>
                  <p className="text-xs text-gray-500">{job.estimated_duration}</p>
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">TBD</p>
              )}
            </div>

            {/* Job Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{job.job_type}</h3>
                    <JobStatusBadge status={job.status} />
                    {job.priority && job.priority !== 'normal' && (
                      <PriorityBadge priority={job.priority} />
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{customer?.name || 'Unknown Customer'}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
              </div>

              {/* Location */}
              {property && (
                <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
                  <MapPin className="h-4 w-4" />
                  <span>{property.address}, {property.city}</span>
                </div>
              )}

              {/* Team */}
              {assignedUsers.length > 1 && (
                <div className="flex items-center gap-2 mt-2">
                  <User className="h-4 w-4 text-gray-400" />
                  <AssignedTeamAvatars users={assignedUsers} size="sm" maxDisplay={4} />
                </div>
              )}

              {/* Contact */}
              {customer?.phone && (
                <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
                  <Phone className="h-4 w-4" />
                  <a 
                    href={`tel:${customer.phone}`} 
                    onClick={(e) => e.stopPropagation()}
                    className="hover:text-green-600"
                  >
                    {customer.phone}
                  </a>
                </div>
              )}

              {/* Late Warning */}
              {isLate && (
                <div className="flex items-center gap-2 mt-2 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  <span className="font-medium">Overdue</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
