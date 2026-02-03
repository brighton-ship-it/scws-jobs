'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JobStatusBadge } from '@/components/ui/badge';
import { TaskList, CreateTaskModal } from '@/components/tasks';
import { ScheduleMap } from '@/components/schedule/ScheduleMap';
import { 
  mockJobs, 
  mockJobTypes,
  getPropertyById, 
  getCustomerById, 
  getUserById,
  getFieldCrew,
  getUnscheduledTasks,
  getAllTasksWithDetails,
} from '@/lib/mock-data';
import { getAllTasksWithDetails as getTasksWithDetails } from '@/lib/tasks';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  User,
  Plus,
  Map,
  ListTodo,
  X,
} from 'lucide-react';
import { 
  format, 
  startOfWeek, 
  endOfWeek, 
  addWeeks, 
  subWeeks, 
  eachDayOfInterval,
  isToday,
  isSameDay,
  parseISO,
} from 'date-fns';
import Link from 'next/link';

export default function SchedulePage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [showTasksSidebar, setShowTasksSidebar] = useState(true);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [taskRefreshKey, setTaskRefreshKey] = useState(0);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const fieldCrew = getFieldCrew();

  // Get jobs for the week
  const weekJobs = useMemo(() => {
    return mockJobs.filter(job => {
      if (!job.scheduled_date) return false;
      const jobDate = parseISO(job.scheduled_date);
      return jobDate >= weekStart && jobDate <= weekEnd;
    });
  }, [weekStart, weekEnd]);

  // Get unscheduled tasks
  const unscheduledTasks = useMemo(() => {
    return getTasksWithDetails().filter(t => !t.due_date && t.status !== 'completed');
  }, [taskRefreshKey]);

  // Get jobs count for a day
  const getJobCountForDay = (date: Date) => {
    return weekJobs.filter(job => 
      job.scheduled_date && isSameDay(parseISO(job.scheduled_date), date)
    ).length;
  };

  // Get jobs for a crew member on a date
  const getJobsForCrewOnDate = (userId: string, date: Date) => {
    return weekJobs.filter(job => 
      job.assigned_to === userId && 
      job.scheduled_date && 
      isSameDay(parseISO(job.scheduled_date), date)
    );
  };

  const getJobTypeColor = (jobType: string) => {
    const type = mockJobTypes.find(jt => jt.name === jobType);
    return type?.color || '#6B7280';
  };

  const handleTaskUpdated = () => {
    setTaskRefreshKey(k => k + 1);
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-140px)]">
      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col min-w-0 ${showMap && !showTasksSidebar ? 'lg:flex-row lg:gap-6' : ''}`}>
        {/* Calendar Section */}
        <div className={`flex-1 flex flex-col min-w-0 ${showMap ? 'lg:w-1/2' : ''}`}>
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Schedule</h2>
              <p className="text-gray-600">
                Week of {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentDate(new Date())}
              >
                Today
              </Button>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentDate(subWeeks(currentDate, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentDate(addWeeks(currentDate, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              
              {/* Map Toggle - hidden on mobile */}
              <div className="hidden lg:block border-l border-gray-200 pl-3">
                <Button
                  variant={showMap ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowMap(!showMap)}
                >
                  <Map className="h-4 w-4 mr-1" />
                  Map
                </Button>
              </div>

              {/* Tasks Toggle */}
              <Button
                variant={showTasksSidebar ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowTasksSidebar(!showTasksSidebar)}
              >
                <ListTodo className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Tasks</span>
              </Button>

              <Button href="/jobs/new">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline ml-1">New Job</span>
              </Button>
            </div>
          </div>

          {/* Week Grid by Crew */}
          <Card className="flex-1 overflow-hidden">
            <CardContent className="p-0 overflow-x-auto h-full">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="w-40 px-4 py-3 text-left text-sm font-medium text-gray-500 bg-gray-50 sticky left-0 z-10">
                      Crew
                    </th>
                    {weekDays.map(day => (
                      <th 
                        key={day.toISOString()} 
                        className={`px-2 py-3 text-center text-sm font-medium ${
                          isToday(day) ? 'bg-blue-50' : 'bg-gray-50'
                        }`}
                      >
                        <div className={isToday(day) ? 'text-blue-600' : 'text-gray-500'}>
                          {format(day, 'EEE')}
                        </div>
                        <div className={`text-lg ${isToday(day) ? 'text-blue-600 font-bold' : 'text-gray-900'}`}>
                          {format(day, 'd')}
                        </div>
                        {getJobCountForDay(day) > 0 && (
                          <div className="text-xs text-gray-400 mt-1">
                            {getJobCountForDay(day)} job{getJobCountForDay(day) !== 1 ? 's' : ''}
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fieldCrew.map(crew => (
                    <tr key={crew.id} className="border-b border-gray-100">
                      <td className="px-4 py-3 bg-gray-50 sticky left-0 z-10">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-medium">
                            {crew.name.charAt(0)}
                          </div>
                          <span className="text-sm font-medium text-gray-900">{crew.name}</span>
                        </div>
                      </td>
                      {weekDays.map(day => {
                        const dayJobs = getJobsForCrewOnDate(crew.id, day);
                        return (
                          <td 
                            key={day.toISOString()} 
                            className={`px-2 py-2 align-top ${isToday(day) ? 'bg-blue-50/30' : ''}`}
                          >
                            <div className="space-y-1">
                              {dayJobs.map(job => {
                                const property = getPropertyById(job.property_id);
                                return (
                                  <Link
                                    key={job.id}
                                    href={`/jobs/${job.id}/edit`}
                                    className="block p-2 rounded-lg border text-left hover:shadow-md transition-shadow"
                                    style={{ 
                                      borderColor: getJobTypeColor(job.job_type),
                                      backgroundColor: `${getJobTypeColor(job.job_type)}10`
                                    }}
                                  >
                                    <div className="text-xs font-medium text-gray-900 truncate">
                                      {job.scheduled_time}
                                    </div>
                                    <div className="text-xs text-gray-600 truncate">
                                      {job.job_type}
                                    </div>
                                    <div className="text-xs text-gray-400 truncate">
                                      {property?.city}
                                    </div>
                                  </Link>
                                );
                              })}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* Unassigned Row */}
                  <tr className="border-b border-gray-100">
                    <td className="px-4 py-3 bg-gray-50 sticky left-0 z-10">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium">
                          ?
                        </div>
                        <span className="text-sm font-medium text-gray-500">Unassigned</span>
                      </div>
                    </td>
                    {weekDays.map(day => {
                      const unassignedJobs = weekJobs.filter(job => 
                        !job.assigned_to && 
                        job.scheduled_date && 
                        isSameDay(parseISO(job.scheduled_date), day)
                      );
                      return (
                        <td 
                          key={day.toISOString()} 
                          className={`px-2 py-2 align-top ${isToday(day) ? 'bg-blue-50/30' : ''}`}
                        >
                          <div className="space-y-1">
                            {unassignedJobs.map(job => {
                              const property = getPropertyById(job.property_id);
                              return (
                                <Link
                                  key={job.id}
                                  href={`/jobs/${job.id}/edit`}
                                  className="block p-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 text-left hover:shadow-md transition-shadow"
                                >
                                  <div className="text-xs font-medium text-gray-900 truncate">
                                    {job.scheduled_time}
                                  </div>
                                  <div className="text-xs text-gray-600 truncate">
                                    {job.job_type}
                                  </div>
                                  <div className="text-xs text-gray-400 truncate">
                                    {property?.city}
                                  </div>
                                </Link>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Legend */}
          <Card className="mt-4">
            <CardHeader className="py-2">
              <CardTitle className="text-sm">Job Types</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              <div className="flex flex-wrap gap-4">
                {mockJobTypes.map(type => (
                  <div key={type.id} className="flex items-center gap-2">
                    <div 
                      className="h-3 w-3 rounded-full" 
                      style={{ backgroundColor: type.color }}
                    />
                    <span className="text-sm text-gray-600">{type.name}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Map Panel - Desktop Only */}
        {showMap && (
          <div className="hidden lg:block lg:w-1/2 lg:min-w-[400px]">
            <Card className="h-full">
              <CardHeader className="py-3 border-b flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Map className="h-4 w-4" />
                  Job Locations
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowMap(false)}
                  className="h-7 w-7 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="p-4 h-[calc(100%-60px)]">
                <ScheduleMap 
                  jobs={weekJobs} 
                  selectedDate={selectedDate || undefined}
                />
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Tasks Sidebar */}
      {showTasksSidebar && (
        <div className="w-80 shrink-0 hidden lg:block">
          <Card className="h-full flex flex-col">
            <CardHeader className="py-3 border-b flex flex-row items-center justify-between shrink-0">
              <CardTitle className="text-sm flex items-center gap-2">
                <ListTodo className="h-4 w-4" />
                Unscheduled Tasks
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreateTaskModal(true)}
                  className="h-7 w-7 p-0"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowTasksSidebar(false)}
                  className="h-7 w-7 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-3 flex-1 overflow-y-auto">
              <TaskList
                tasks={unscheduledTasks}
                compact
                showStatus={false}
                emptyMessage="No unscheduled tasks"
                onTaskUpdated={handleTaskUpdated}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create Task Modal */}
      <CreateTaskModal
        isOpen={showCreateTaskModal}
        onClose={() => setShowCreateTaskModal(false)}
        onTaskCreated={handleTaskUpdated}
      />
    </div>
  );
}
