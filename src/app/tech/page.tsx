'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import {
  MessageSquare,
  Bell,
  Settings,
  Play,
  Square,
  CheckCircle2,
  ChevronRight,
  Home,
  Calendar,
  Clock,
  Search,
  MoreHorizontal,
  MapPin,
  Plus,
  LogIn,
} from 'lucide-react';
import { format, startOfWeek, endOfWeek } from 'date-fns';

export default function TechHomePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [clockInTime, setClockInTime] = useState<Date | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const today = format(new Date(), 'yyyy-MM-dd');
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const userName = user?.name?.split(' ')[0] || 'there';

  // Load clock-in state - MUST be before any conditional returns
  useEffect(() => {
    const savedClockIn = localStorage.getItem('tech_clock_in');
    if (savedClockIn) {
      const parsed = JSON.parse(savedClockIn);
      setIsClockedIn(true);
      setClockInTime(new Date(parsed.time));
    }
  }, []);

  // Fetch today's jobs - MUST be before any conditional returns
  useEffect(() => {
    if (authLoading || !user) return; // Skip fetch if not authenticated
    const fetchJobs = async () => {
      try {
        const url = user?.id 
          ? `/api/jobs?scheduled_date=${today}&assigned_to=${user.id}`
          : `/api/jobs?scheduled_date=${today}&limit=50`;
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
  }, [user?.id, today, authLoading, user]);

  // Show login prompt if not authenticated - AFTER all hooks
  if (!authLoading && !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="py-8 text-center">
            <div className="w-16 h-16 bg-[#1f3b4d] rounded-full flex items-center justify-center mx-auto mb-4">
              <LogIn className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Sign In Required</h2>
            <p className="text-gray-500 mb-6">Please sign in to access the tech app</p>
            <Button
              onClick={() => router.push('/login?redirect=/tech')}
              className="w-full bg-[#4e9271] hover:bg-[#3d7a5d]"
            >
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleClockToggle = () => {
    if (isClockedIn) {
      localStorage.removeItem('tech_clock_in');
      const entries = JSON.parse(localStorage.getItem('tech_time_entries') || '[]');
      entries.push({
        id: Date.now(),
        clockIn: clockInTime?.toISOString(),
        clockOut: new Date().toISOString(),
        userId: user?.id,
      });
      localStorage.setItem('tech_time_entries', JSON.stringify(entries));
      setIsClockedIn(false);
      setClockInTime(null);
    } else {
      const now = new Date();
      localStorage.setItem('tech_clock_in', JSON.stringify({ time: now.toISOString() }));
      setIsClockedIn(true);
      setClockInTime(now);
    }
  };

  const sortedJobs = [...jobs].sort((a, b) => {
    if (a.scheduled_time && b.scheduled_time) {
      return a.scheduled_time.localeCompare(b.scheduled_time);
    }
    return 0;
  });

  const completedCount = sortedJobs.filter(j => j.status === 'completed' || j.status === 'invoiced').length;
  const totalValue = sortedJobs.reduce((sum, j) => sum + (j.estimated_value || 150), 0);
  
  const weekStart = startOfWeek(new Date());
  const weekEnd = endOfWeek(new Date());

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-gray-500">{format(new Date(), 'EEEE, MMMM do')}</p>
          <div className="flex items-center gap-4">
            <Link href="/tech/messages" className="text-gray-600">
              <MessageSquare className="h-5 w-5" />
            </Link>
            <Link href="/tech/notifications" className="relative text-gray-600">
              <Bell className="h-5 w-5" />
              {jobs.filter(j => j.priority === 'urgent').length > 0 && (
                <span className="absolute -top-1 -right-1 h-2 w-2 bg-red-500 rounded-full" />
              )}
            </Link>
            <Link href="/tech/settings" className="text-gray-600">
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-[#1f3b4d]">{greeting}, {userName}</h1>
      </div>

      {/* Clock In Card */}
      <div className="px-4 -mt-1">
        <Card className="bg-white shadow-sm">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between">
              <p className="text-gray-700 font-medium">
                {isClockedIn ? `Started at ${clockInTime ? format(clockInTime, 'h:mm a') : ''}` : "Let's get started"}
              </p>
              <Button
                onClick={handleClockToggle}
                className={`px-6 py-2 rounded-md font-semibold ${
                  isClockedIn 
                    ? 'bg-red-500 hover:bg-red-600 text-white' 
                    : 'bg-[#4e9271] hover:bg-[#3d7a5d] text-white'
                }`}
              >
                {isClockedIn ? (
                  <>
                    <Square className="h-4 w-4 mr-2 fill-current" />
                    Clock Out
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Clock In
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Map Preview */}
      <div className="px-4 mt-4">
        <div className="relative h-48 bg-[#e8f4ea] rounded-xl overflow-hidden">
          {/* Simplified map background */}
          <div className="absolute inset-0 opacity-50">
            <svg viewBox="0 0 400 200" className="w-full h-full">
              <path d="M0,100 Q100,80 200,100 T400,100" stroke="#c5dfc9" strokeWidth="3" fill="none" />
              <path d="M50,150 Q150,130 250,150 T400,140" stroke="#c5dfc9" strokeWidth="2" fill="none" />
            </svg>
          </div>
          
          {/* Job markers */}
          {sortedJobs.slice(0, 3).map((job, idx) => (
            <div 
              key={job.id}
              className="absolute flex items-center gap-1 bg-white rounded-full px-2 py-1 shadow-md"
              style={{ 
                top: `${30 + idx * 25}%`, 
                left: `${20 + idx * 20}%` 
              }}
            >
              <div className="h-3 w-3 bg-[#1f3b4d] rounded-full" />
              <span className="text-xs font-medium text-[#1f3b4d]">
                {job.scheduled_time?.slice(0, 5) || '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Visits Summary */}
      <div className="px-4 mt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-bold text-gray-900">
              {sortedJobs.length} visit{sortedJobs.length !== 1 ? 's' : ''} worth ${totalValue.toLocaleString()}
            </p>
            <p className="text-sm text-gray-500">
              {completedCount} visit{completedCount !== 1 ? 's' : ''} complete
            </p>
          </div>
          <Link 
            href="/tech/schedule"
            className="flex items-center gap-1 text-sm font-medium text-gray-700 border border-gray-300 rounded-full px-4 py-2"
          >
            View all
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Job Cards */}
      <div className="px-4 mt-4 space-y-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1f3b4d]" />
          </div>
        ) : sortedJobs.length === 0 ? (
          <Card className="bg-white">
            <CardContent className="py-8 text-center">
              <Calendar className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium text-gray-900">No jobs scheduled</p>
              <p className="text-sm text-gray-500">Enjoy your day off!</p>
            </CardContent>
          </Card>
        ) : (
          sortedJobs.map((job) => <JobCard key={job.id} job={job} />)
        )}
      </div>

      {/* This Week Section */}
      <div className="px-4 mt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-gray-900">This week</p>
            <p className="text-sm text-gray-500">
              {format(weekStart, 'MMM d')} - {format(weekEnd, 'd')}
            </p>
          </div>
          <Link href="/tech/timesheet" className="text-[#4e9271] font-medium text-sm">
            View timesheet
          </Link>
        </div>
      </div>

      {/* FAB */}
      <Link
        href="/tech/jobs/new"
        className="fixed bottom-24 right-4 h-14 w-14 bg-[#1f3b4d] rounded-full flex items-center justify-center shadow-lg"
      >
        <Plus className="h-6 w-6 text-white" />
      </Link>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-2 safe-area-pb">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <Link href="/tech" className="flex flex-col items-center py-2 text-[#1f3b4d]">
            <Home className="h-5 w-5" />
            <span className="text-xs mt-1 font-medium">Home</span>
          </Link>
          <Link href="/tech/schedule" className="flex flex-col items-center py-2 text-gray-400">
            <Calendar className="h-5 w-5" />
            <span className="text-xs mt-1">Schedule</span>
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

function JobCard({ job }: { job: any }) {
  const property = job.property;
  const customer = property?.customer;
  const isCompleted = job.status === 'completed' || job.status === 'invoiced';
  const isActive = job.status === 'in_progress';

  const formatTimeRange = () => {
    if (!job.scheduled_time) return '';
    const startTime = job.scheduled_time.slice(0, 5);
    // Estimate end time based on duration or default 2 hours
    const durationHours = job.estimated_duration 
      ? parseInt(job.estimated_duration.split(':')[0]) || 2 
      : 2;
    const [hours, mins] = job.scheduled_time.split(':').map(Number);
    const endHours = (hours + durationHours) % 24;
    const endTime = `${endHours}:${mins.toString().padStart(2, '0')}`;
    
    const formatTime = (time: string) => {
      const [h, m] = time.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hour = h % 12 || 12;
      return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
    };
    
    return `${formatTime(startTime)} - ${formatTime(endTime)}`;
  };

  return (
    <Link href={`/tech/jobs/${job.id}`}>
      <Card className={`bg-white overflow-hidden ${isActive ? 'ring-2 ring-[#4e9271]' : ''}`}>
        <div className="flex">
          {/* Left color bar */}
          <div className={`w-1 ${isCompleted ? 'bg-gray-300' : isActive ? 'bg-[#4e9271]' : 'bg-[#4e9271]'}`} />
          
          <CardContent className="flex-1 py-3 px-4">
            <div className="flex items-start gap-3">
              {/* Checkbox */}
              <div className="mt-1">
                {isCompleted ? (
                  <CheckCircle2 className="h-5 w-5 text-gray-400" />
                ) : (
                  <div className="h-5 w-5 rounded border-2 border-gray-300" />
                )}
              </div>
              
              {/* Job Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-gray-900">{customer?.name || 'Unknown Customer'}</h3>
                  {isActive && (
                    <span className="flex items-center gap-1 text-xs font-medium text-[#4e9271]">
                      Active
                      <span className="h-2 w-2 bg-[#4e9271] rounded-full" />
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600">{formatTimeRange()}</p>
                <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                  <MapPin className="h-3 w-3" />
                  {property?.address || 'No address'}
                </p>
                <p className="text-sm text-gray-500 mt-0.5">
                  {job.job_type}{job.description ? `, ${job.description.slice(0, 30)}` : ''}
                </p>
              </div>
              
              {/* Navigation button */}
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  if (property?.address) {
                    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(property.address)}`, '_blank');
                  }
                }}
                className="p-2 text-gray-400 hover:text-[#1f3b4d]"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </CardContent>
        </div>
      </Card>
    </Link>
  );
}
