'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ScheduleMap } from '@/components/schedule/ScheduleMap';
import { QuickCreateMenu } from '@/components/ui/quick-create-menu';
import { 
  mockJobs, 
  mockJobTypes,
  getPropertyById, 
  getCustomerById, 
  getUserById,
  getFieldCrew,
} from '@/lib/mock-data';
import { 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown,
  Check,
  MapPin,
  Plus,
} from 'lucide-react';
import { 
  format, 
  startOfWeek, 
  endOfWeek, 
  addWeeks, 
  subWeeks, 
  addDays,
  subDays,
  eachDayOfInterval,
  isToday,
  isSameDay,
  parseISO,
} from 'date-fns';
import Link from 'next/link';

type ViewMode = 'day' | 'list' | 'map';

export default function SchedulePage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 0 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const fieldCrew = getFieldCrew();

  // Get jobs for selected date
  const dayJobs = useMemo(() => {
    return mockJobs.filter(job => {
      if (!job.scheduled_date) return false;
      const jobDate = parseISO(job.scheduled_date);
      return isSameDay(jobDate, selectedDate);
    });
  }, [selectedDate]);

  // Get jobs for a crew member on selected date
  const getJobsForCrew = (userId: string) => {
    return dayJobs.filter(job => job.assigned_to === userId);
  };

  // Get completed/total count for a crew member
  const getJobCounts = (userId: string) => {
    const jobs = getJobsForCrew(userId);
    const completed = jobs.filter(j => j.status === 'completed').length;
    return { completed, total: jobs.length };
  };

  const getJobTypeColor = (jobType: string) => {
    const type = mockJobTypes.find(jt => jt.name === jobType);
    return type?.color || '#0d9488'; // Default teal
  };

  // Navigate week
  const goToPrevWeek = () => setSelectedDate(subWeeks(selectedDate, 1));
  const goToNextWeek = () => setSelectedDate(addWeeks(selectedDate, 1));
  const goToToday = () => setSelectedDate(new Date());

  // Job card component
  const JobCard = ({ job }: { job: typeof mockJobs[0] }) => {
    const property = getPropertyById(job.property_id);
    const customer = getCustomerById(job.customer_id);
    const isCompleted = job.status === 'completed';
    const color = getJobTypeColor(job.job_type);

    return (
      <Link
        href={`/jobs/${job.id}`}
        className="block bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
      >
        <div className="flex">
          {/* Color bar */}
          <div 
            className="w-1.5 shrink-0" 
            style={{ backgroundColor: color }}
          />
          
          {/* Content */}
          <div className="flex-1 p-3 min-w-0">
            {/* Job title with checkmark */}
            <div className="flex items-start gap-2">
              {isCompleted && (
                <div className="mt-0.5 h-4 w-4 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                  <Check className="h-2.5 w-2.5 text-white" />
                </div>
              )}
              <div className={`font-medium text-sm text-gray-900 ${isCompleted ? 'line-through text-gray-500' : ''}`}>
                {job.job_type}
              </div>
            </div>
            
            {/* Customer name */}
            <div className={`text-sm mt-1 ${isCompleted ? 'line-through text-gray-400' : 'text-gray-700'}`}>
              {customer?.name || 'Unknown Customer'}
            </div>
            
            {/* Time */}
            <div className={`text-xs mt-1 ${isCompleted ? 'text-gray-400' : 'text-gray-500'}`}>
              {job.scheduled_time || 'Anytime'}
            </div>
            
            {/* Address */}
            <div className={`text-xs mt-0.5 truncate ${isCompleted ? 'text-gray-400' : 'text-gray-500'}`}>
              {property?.address || property?.city || 'No address'}
            </div>
            
            {/* Notes (truncated) */}
            {job.notes && (
              <div className={`text-xs mt-1 truncate ${isCompleted ? 'text-gray-400' : 'text-gray-500'}`}>
                {job.notes}
              </div>
            )}
          </div>
        </div>
      </Link>
    );
  };

  // Staff column component
  const StaffColumn = ({ crew }: { crew: { id: string; name: string } }) => {
    const jobs = getJobsForCrew(crew.id);
    const { completed, total } = getJobCounts(crew.id);

    return (
      <div className="w-48 shrink-0 flex flex-col">
        {/* Header */}
        <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
          <div className="font-medium text-sm text-gray-900 truncate">
            {crew.name}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {completed}/{total}
          </div>
        </div>
        
        {/* Jobs */}
        <div className="flex-1 p-2 space-y-2 overflow-y-auto bg-amber-50/30">
          {jobs.length > 0 ? (
            jobs.map(job => <JobCard key={job.id} job={job} />)
          ) : (
            <div className="text-xs text-gray-400 text-center py-4">
              No jobs
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-[calc(100vh-100px)] flex flex-col bg-amber-50/50">
      {/* Top Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Month selector */}
          <button className="flex items-center gap-1 text-lg font-semibold text-gray-900">
            {format(selectedDate, 'MMMM')}
            <ChevronDown className="h-5 w-5 text-gray-400" />
          </button>
          
          {/* View toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('day')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'day' 
                  ? 'bg-white text-gray-900 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'list' 
                  ? 'bg-white text-gray-900 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'map' 
                  ? 'bg-white text-gray-900 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Map
            </button>
          </div>
          
          {/* Right icons */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={goToToday}>
              Today
            </Button>
            <Button variant="ghost" size="icon" onClick={goToPrevWeek}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={goToNextWeek}>
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Week Row */}
      <div className="bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex justify-between max-w-md mx-auto">
          {weekDays.map(day => {
            const isSelected = isSameDay(day, selectedDate);
            const isTodayDate = isToday(day);
            
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDate(day)}
                className="flex flex-col items-center py-1 px-2"
              >
                <span className={`text-xs font-medium ${
                  isSelected ? 'text-white' : isTodayDate ? 'text-green-600' : 'text-gray-500'
                }`}>
                  {format(day, 'EEEEE')}
                </span>
                <span className={`mt-1 w-8 h-8 flex items-center justify-center rounded-full text-sm font-semibold ${
                  isSelected 
                    ? 'bg-green-700 text-white' 
                    : isTodayDate 
                      ? 'text-green-600' 
                      : 'text-gray-900'
                }`}>
                  {format(day, 'd')}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content */}
      {viewMode === 'map' ? (
        <div className="flex-1 p-4">
          <ScheduleMap jobs={dayJobs} />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto">
          <div className="flex h-full min-w-max">
            {/* Staff columns */}
            {fieldCrew.map(crew => (
              <StaffColumn key={crew.id} crew={crew} />
            ))}
            
            {/* Unassigned column */}
            <div className="w-48 shrink-0 flex flex-col border-l border-gray-200">
              <div className="px-3 py-2 bg-gray-100 border-b border-gray-200">
                <div className="font-medium text-sm text-gray-500">
                  Unassigned
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {dayJobs.filter(j => !j.assigned_to).length} jobs
                </div>
              </div>
              <div className="flex-1 p-2 space-y-2 overflow-y-auto bg-gray-50/50">
                {dayJobs.filter(j => !j.assigned_to).map(job => (
                  <JobCard key={job.id} job={job} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Quick Create Menu */}
      <QuickCreateMenu />
    </div>
  );
}
