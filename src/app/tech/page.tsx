'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JobStatusBadge, PriorityBadge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import {
  Calendar,
  Clock,
  MapPin,
  Phone,
  ChevronRight,
  Play,
  Square,
  AlertCircle,
  CheckCircle2,
  Navigation,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

export default function TechJobsPage() {
  const { user } = useAuth();
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [clockInTime, setClockInTime] = useState<Date | null>(null);
  const [elapsedTime, setElapsedTime] = useState('0:00:00');

  // Load clock-in state from localStorage
  useEffect(() => {
    const savedClockIn = localStorage.getItem('tech_clock_in');
    if (savedClockIn) {
      const parsed = JSON.parse(savedClockIn);
      setIsClockedIn(true);
      setClockInTime(new Date(parsed.time));
    }
  }, []);

  // Update elapsed time
  useEffect(() => {
    if (!isClockedIn || !clockInTime) return;
    
    const interval = setInterval(() => {
      const now = new Date();
      const diff = Math.floor((now.getTime() - clockInTime.getTime()) / 1000);
      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = diff % 60;
      setElapsedTime(`${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isClockedIn, clockInTime]);

  const handleClockToggle = () => {
    if (isClockedIn) {
      // Clock out
      localStorage.removeItem('tech_clock_in');
      // Save time entry
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
      setElapsedTime('0:00:00');
    } else {
      // Clock in
      const now = new Date();
      localStorage.setItem('tech_clock_in', JSON.stringify({ time: now.toISOString() }));
      setIsClockedIn(true);
      setClockInTime(now);
    }
  };

  // Fetch today's jobs for current user
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const today = format(new Date(), 'yyyy-MM-dd');
  
  useEffect(() => {
    const fetchJobs = async () => {
      try {
        // Fetch jobs for today assigned to this user
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
  }, [user?.id, today]);
  
  const sortedJobs = [...jobs].sort((a, b) => {
    if (a.scheduled_time && b.scheduled_time) {
      return a.scheduled_time.localeCompare(b.scheduled_time);
    }
    return 0;
  });

  const completedCount = sortedJobs.filter(j => j.status === 'completed' || j.status === 'invoiced').length;
  const inProgressCount = sortedJobs.filter(j => j.status === 'in_progress').length;

  return (
    <div className="p-4 space-y-4">
      {/* Header with date */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#1f3b4d]">Today's Jobs</h1>
          <p className="text-sm text-gray-500">{format(new Date(), 'EEEE, MMMM d')}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500">{completedCount}/{sortedJobs.length} done</p>
        </div>
      </div>

      {/* Clock In/Out Card */}
      <Card className="bg-gradient-to-r from-[#1f3b4d] to-[#2d4f63]">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="text-white">
              <p className="text-sm opacity-80">
                {isClockedIn ? 'Clocked In' : 'Ready to start?'}
              </p>
              {isClockedIn && (
                <>
                  <p className="text-2xl font-bold font-mono">{elapsedTime}</p>
                  <p className="text-xs opacity-60">
                    Started at {clockInTime ? format(clockInTime, 'h:mm a') : ''}
                  </p>
                </>
              )}
            </div>
            <Button
              onClick={handleClockToggle}
              className={`h-14 w-14 rounded-full ${
                isClockedIn 
                  ? 'bg-red-500 hover:bg-red-600' 
                  : 'bg-[#4e9271] hover:bg-[#3d7a5d]'
              }`}
            >
              {isClockedIn ? (
                <Square className="h-6 w-6 fill-current" />
              ) : (
                <Play className="h-6 w-6 ml-1" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Jobs summary pills */}
      <div className="flex gap-2 overflow-x-auto py-1">
        <div className="flex-shrink-0 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-sm font-medium">
          {sortedJobs.filter(j => j.status === 'scheduled').length} Scheduled
        </div>
        {inProgressCount > 0 && (
          <div className="flex-shrink-0 px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 text-sm font-medium">
            {inProgressCount} In Progress
          </div>
        )}
        <div className="flex-shrink-0 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-sm font-medium">
          {completedCount} Completed
        </div>
      </div>

      {/* Job Cards */}
      <div className="space-y-3">
        {sortedJobs.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Calendar className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <h3 className="font-medium text-gray-900">No Jobs Today</h3>
              <p className="text-sm text-gray-500 mt-1">
                Check back later or view past jobs
              </p>
            </CardContent>
          </Card>
        ) : (
          sortedJobs.map((job) => <JobCard key={job.id} job={job} />)
        )}
      </div>
    </div>
  );
}

function JobCard({ job }: { job: any }) {
  // Property and customer come from API join
  const property = job.property;
  const customer = property?.customer;
  
  const priorityBorder = {
    low: 'border-l-gray-300',
    normal: 'border-l-blue-400',
    high: 'border-l-orange-400',
    urgent: 'border-l-red-500',
  };

  const statusIcon = {
    scheduled: <Clock className="h-5 w-5 text-blue-500" />,
    in_progress: <AlertCircle className="h-5 w-5 text-amber-500" />,
    completed: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
    invoiced: <CheckCircle2 className="h-5 w-5 text-teal-500" />,
  };

  const googleMapsUrl = property 
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        `${property.address}, ${property.city || ''} ${property.zip || ''}`
      )}`
    : null;

  return (
    <Link href={`/tech/jobs/${job.id}`}>
      <Card className={`border-l-4 ${priorityBorder[job.priority || 'normal']} active:bg-gray-50`}>
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            {/* Status icon */}
            <div className="flex-shrink-0 mt-0.5">
              {statusIcon[job.status]}
            </div>

            {/* Job info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{job.job_type}</h3>
                  <p className="text-sm text-gray-600 truncate">{customer?.name || 'Unknown'}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
              </div>

              {/* Time */}
              {job.scheduled_time && (
                <div className="flex items-center gap-1.5 mt-2 text-sm text-gray-500">
                  <Clock className="h-4 w-4" />
                  <span>{job.scheduled_time}</span>
                  {job.estimated_duration && (
                    <span className="text-gray-400">• {job.estimated_duration}</span>
                  )}
                </div>
              )}

              {/* Address */}
              {property && (
                <div className="flex items-center gap-1.5 mt-1 text-sm text-gray-500">
                  <MapPin className="h-4 w-4" />
                  <span className="truncate">{property.address}, {property.city}</span>
                </div>
              )}

              {/* Quick actions */}
              <div className="flex items-center gap-3 mt-3">
                {googleMapsUrl && (
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-sm font-medium"
                  >
                    <Navigation className="h-4 w-4" />
                    Navigate
                  </a>
                )}
                {customer?.phone && (
                  <a
                    href={`tel:${customer.phone}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-sm font-medium"
                  >
                    <Phone className="h-4 w-4" />
                    Call
                  </a>
                )}
              </div>

              {/* Status/Priority badges */}
              <div className="flex items-center gap-2 mt-3">
                <JobStatusBadge status={job.status} />
                {job.priority && job.priority !== 'normal' && (
                  <PriorityBadge priority={job.priority} />
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
