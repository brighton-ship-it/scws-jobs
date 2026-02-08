'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import {
  Search,
  Home,
  Calendar,
  Clock,
  MoreHorizontal,
  MapPin,
  User,
  Briefcase,
  ChevronRight,
  X,
} from 'lucide-react';
import { format } from 'date-fns';

export default function TechSearchPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{
    jobs: any[];
    customers: any[];
  }>({ jobs: [], customers: [] });
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Search when query changes (debounced)
  useEffect(() => {
    if (!query.trim()) {
      setResults({ jobs: [], customers: [] });
      setHasSearched(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setHasSearched(true);
      try {
        // Search jobs and customers in parallel
        const [jobsRes, customersRes] = await Promise.all([
          fetch(`/api/jobs?search=${encodeURIComponent(query)}&limit=10`),
          fetch(`/api/customers?search=${encodeURIComponent(query)}&limit=10`),
        ]);

        const jobsData = jobsRes.ok ? await jobsRes.json() : { jobs: [] };
        const customersData = customersRes.ok ? await customersRes.json() : { customers: [] };

        setResults({
          jobs: jobsData.jobs || [],
          customers: customersData.customers || [],
        });
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const totalResults = results.jobs.length + results.customers.length;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Search Header */}
      <div className="bg-white px-4 pt-4 pb-4 sticky top-0 z-10 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search jobs, customers..."
            className="w-full pl-10 pr-10 py-3 bg-gray-100 rounded-xl text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#4e9271]"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="p-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1f3b4d]" />
          </div>
        ) : !hasSearched ? (
          <div className="text-center py-12">
            <Search className="h-12 w-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">Search for jobs or customers</p>
          </div>
        ) : totalResults === 0 ? (
          <div className="text-center py-12">
            <Search className="h-12 w-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-900 font-medium">No results found</p>
            <p className="text-gray-500 text-sm">Try a different search term</p>
          </div>
        ) : (
          <>
            {/* Jobs Results */}
            {results.jobs.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Jobs ({results.jobs.length})
                </h2>
                <div className="space-y-2">
                  {results.jobs.map((job) => (
                    <Link key={job.id} href={`/tech/jobs/${job.id}`}>
                      <Card className="hover:bg-gray-50 active:bg-gray-100">
                        <CardContent className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                              <Briefcase className="h-5 w-5 text-blue-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 truncate">{job.job_type}</p>
                              <p className="text-sm text-gray-500 truncate">
                                {job.property?.customer?.name || 'Unknown'} • {job.property?.address || 'No address'}
                              </p>
                              {job.scheduled_date && (
                                <p className="text-xs text-gray-400">
                                  {format(new Date(job.scheduled_date), 'MMM d, yyyy')}
                                </p>
                              )}
                            </div>
                            <ChevronRight className="h-5 w-5 text-gray-400" />
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Customers Results */}
            {results.customers.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Customers ({results.customers.length})
                </h2>
                <div className="space-y-2">
                  {results.customers.map((customer) => (
                    <Link key={customer.id} href={`/customers/${customer.id}`}>
                      <Card className="hover:bg-gray-50 active:bg-gray-100">
                        <CardContent className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 bg-green-100 rounded-full flex items-center justify-center">
                              <User className="h-5 w-5 text-green-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 truncate">{customer.name}</p>
                              {customer.phone && (
                                <p className="text-sm text-gray-500">{customer.phone}</p>
                              )}
                              {customer.email && (
                                <p className="text-xs text-gray-400 truncate">{customer.email}</p>
                              )}
                            </div>
                            <ChevronRight className="h-5 w-5 text-gray-400" />
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
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
          <Link href="/tech/search" className="flex flex-col items-center py-2 text-[#1f3b4d]">
            <Search className="h-5 w-5" />
            <span className="text-xs mt-1 font-medium">Search</span>
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
