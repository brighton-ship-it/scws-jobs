'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import {
  Home,
  Calendar,
  Clock,
  Search,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  MapPin,
  CheckCircle2,
} from 'lucide-react';
import { format, addDays, subDays, startOfWeek, eachDayOfInterval, isSameDay } from 'date-fns';

export default function TechSchedulePage() {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Get week days centered on selected date
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });

  // Fetch jobs for the selected date
  useEffect(() => {
    const fetchJobs = async () => {
      setLoading(true);
      try {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const url = user?.id 
          ? `/api/jobs?scheduled_date=${dateStr}&assigned_to=${user.id}`
          : `/api/jobs?scheduled_date=${dateStr}&limit=50`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setJobs(data.jobs || []);
        }
      } catch (err) {
        console.error('Failed to fetch jobs:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchJobs();
  }, [selectedDate, user?.id]);

  const sortedJobs = [...jobs].sort((a, b) => {
    if (a.scheduled_time && b.scheduled_time) {
      return a.scheduled_time.localeCompare(b.scheduled_time);
    }
    return 0;
  });

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white px-4 pt-4 pb-2 border-b">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-[#1f3b4d]">Schedule</h1>
          <button 
            onClick={() => setSelectedDate(new Date())}
            className="text-sm text-[#4e9271] font-medium"
          >
            Today
          </button>
        </div>

        {/* Month Navigator */}
        <div className="flex items-center justify-between mb-4">
          <button 
            onClick={() => setSelectedDate(subDays(selectedDate, 7))}
            className="p-2 text-gray-600"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="font-semibold text-gray-900">
            {format(selectedDate, 'MMMM yyyy')}
          </span>
          <button 
            onClick={() => setSelectedDate(addDays(selectedDate, 7))}
            className="p-2 text-gray-600"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Week Days */}
        <div className="flex justify-between">
          {weekDays.map((day) => {
            const isSelected = isSameDay(day, selectedDate);
            const isToday = isSameDay(day, new Date());
            
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDate(day)}
                className={`flex flex-col items-center py-2 px-3 rounded-xl transition-colors ${
                  isSelected 
                    ? 'bg-[#1f3b4d] text-white' 
                    : isToday 
                      ? 'bg-[#4e9271]/10 text-[#4e9271]'
                      : 'text-gray-600'
                }`}
              >
                <span className="text-xs font-medium">{format(day, 'EEE')}</span>
                <span className={`text-lg font-bold ${isSelected ? '' : isToday ? 'text-[#4e9271]' : ''}`}>
                  {format(day, 'd')}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Jobs List */}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-gray-900">
            {format(selectedDate, 'EEEE, MMMM d')}
          </h2>
          <span className="text-sm text-gray-500">
            {sortedJobs.length} job{sortedJobs.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1f3b4d]" />
          </div>
        ) : sortedJobs.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Calendar className="h-12 w-12 mx-auto text-gray-300 mb-3" />
              <p className="font-medium text-gray-900">No jobs scheduled</p>
              <p className="text-sm text-gray-500">Enjoy your day!</p>
            </CardContent>
          </Card>
        ) : (
          sortedJobs.map((job) => {
            const isCompleted = job.status === 'completed' || job.status === 'invoiced';
            const isActive = job.status === 'in_progress';
            
            return (
              <Link key={job.id} href={`/tech/jobs/${job.id}`}>
                <Card className={`overflow-hidden ${isActive ? 'ring-2 ring-[#4e9271]' : ''}`}>
                  <div className="flex">
                    <div className={`w-1 ${isCompleted ? 'bg-gray-300' : 'bg-[#4e9271]'}`} />
                    <CardContent className="flex-1 py-3 px-4">
                      <div className="flex items-start gap-3">
                        {isCompleted && <CheckCircle2 className="h-5 w-5 text-gray-400 mt-0.5" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-[#1f3b4d]">
                              {job.scheduled_time?.slice(0, 5) || '--:--'}
                            </span>
                            {isActive && (
                              <span className="text-xs font-medium text-[#4e9271] flex items-center gap-1">
                                Active <span className="h-2 w-2 bg-[#4e9271] rounded-full" />
                              </span>
                            )}
                          </div>
                          <p className="font-semibold text-gray-900">{job.property?.customer?.name || 'Unknown'}</p>
                          <p className="text-sm text-gray-600">{job.job_type}</p>
                          <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                            <MapPin className="h-3 w-3" />
                            {job.property?.address || 'No address'}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </div>
                </Card>
              </Link>
            );
          })
        )}
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-2 safe-area-pb">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <Link href="/tech" className="flex flex-col items-center py-2 text-gray-400">
            <Home className="h-5 w-5" />
            <span className="text-xs mt-1">Home</span>
          </Link>
          <Link href="/tech/schedule" className="flex flex-col items-center py-2 text-[#1f3b4d]">
            <Calendar className="h-5 w-5" />
            <span className="text-xs mt-1 font-medium">Schedule</span>
          </Link>
          <Link href="/tech/timesheet" className="flex flex-col items-center py-2 text-gray-400">
            <Clock className="h-5 w-5" />
            <span className="text-xs mt-1">Timesheet</span>
          </Link>
          <Link href="/tech/search" className="flex flex-col items-center py-2 text-gray-400">
            <Search className="h-5 w-5" />
            <span className="text-xs mt-1">Search</span>
          </Link>
          <Link href="/tech/more" className="flex flex-col items-center py-2 text-gray-400">
            <MoreHorizontal className="h-5 w-5" />
            <span className="text-xs mt-1">More</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
