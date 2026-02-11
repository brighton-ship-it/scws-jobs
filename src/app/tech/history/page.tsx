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
  MapPin,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';

interface Job {
  id: string;
  title: string;
  status: string;
  scheduled_date: string;
  customer: { name: string; address: string } | null;
}

export default function TechHistoryPage() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      if (!user?.id) return;
      
      try {
        const res = await fetch(`/api/jobs?assigned_to=${user.id}&status=completed&limit=50`);
        if (res.ok) {
          const data = await res.json();
          setJobs(data.jobs || []);
        }
      } catch (err) {
        console.error('Failed to fetch job history:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchHistory();
  }, [user?.id]);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white px-4 pt-6 pb-4 border-b flex items-center gap-3">
        <Link href="/tech/more" className="p-2 -ml-2 rounded-full hover:bg-gray-100">
          <ChevronLeft className="h-5 w-5 text-gray-600" />
        </Link>
        <h1 className="text-xl font-bold text-[#1f3b4d]">My Jobs History</h1>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : jobs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <CheckCircle2 className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="font-medium text-gray-900">No completed jobs yet</h3>
              <p className="text-sm text-gray-500 mt-1">
                Your completed jobs will appear here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <Link key={job.id} href={`/tech/jobs/${job.id}`}>
                <Card className="hover:bg-gray-50 active:bg-gray-100">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full flex items-center justify-center bg-green-100 text-green-600 flex-shrink-0">
                        <CheckCircle2 className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{job.title}</p>
                        <p className="text-sm text-gray-600 truncate">{job.customer?.name || 'Unknown'}</p>
                        <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                          <MapPin className="h-3 w-3" />
                          <span className="truncate">{job.customer?.address || 'No address'}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {job.scheduled_date ? format(new Date(job.scheduled_date), 'MMM d, yyyy') : 'No date'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-2 safe-area-pb">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <Link href="/tech" className="flex flex-col items-center py-2 text-gray-400">
            <Home className="h-5 w-5" />
            <span className="text-xs mt-1">Home</span>
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
          <Link href="/tech/more" className="flex flex-col items-center py-2 text-[#1f3b4d]">
            <MoreHorizontal className="h-5 w-5" />
            <span className="text-xs mt-1 font-medium">More</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
