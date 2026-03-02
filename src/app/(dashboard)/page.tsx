'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { JobStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { FleetWidget } from '@/components/dashboard/FleetWidget';
import { useAuth } from '@/contexts/AuthContext';
import {
  Briefcase,
  Users,
  DollarSign,
  AlertCircle,
  ArrowRight,
  Clock,
  MapPin,
  Calendar,
  TrendingUp,
  AlertTriangle,
  FileText,
  ClipboardList,
  Receipt,
  Plus,
  ChevronRight,
  CheckCircle,
  Circle,
  Image,
  Globe,
  Mail,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import Link from 'next/link';

// To-do items with time estimates
const initialTodoItems = [
  {
    id: 'logo',
    title: 'Add your company logo',
    description: 'Make your invoices and quotes look more professional',
    icon: Image,
    time: '2 minutes',
    href: '/settings/branding',
  },
  {
    id: 'portal',
    title: 'Explore your online client portal',
    description: 'See how your clients view their quotes and invoices',
    icon: Globe,
    time: '5 minutes',
    href: '/settings/client-portal',
  },
  {
    id: 'email',
    title: 'Customize your email templates',
    description: 'Personalize the emails sent to your customers',
    icon: Mail,
    time: '3 minutes',
    href: '/settings/emails',
  },
  {
    id: 'automation',
    title: 'Set up invoice reminders',
    description: 'Automatically remind clients about unpaid invoices',
    icon: Sparkles,
    time: '5 minutes',
    href: '/settings/automations',
  },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const [completedTodos, setCompletedTodos] = useState<string[]>([]);
  const [dismissedTodos, setDismissedTodos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Data from API
  const [jobs, setJobs] = useState<any[]>([]);
  const [workflowStats, setWorkflowStats] = useState<any>(null);

  // Fetch dashboard data
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch stats (accurate counts) and today's jobs in parallel
        const [statsRes, jobsRes] = await Promise.all([
          fetch('/api/dashboard/stats'),
          fetch('/api/jobs?limit=100'), // Only need today's jobs for schedule
        ]);
        
        if (statsRes.ok) {
          const stats = await statsRes.json();
          setWorkflowStats(stats);
        }
        if (jobsRes.ok) {
          const data = await jobsRes.json();
          setJobs(data.jobs || []);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Toggle todo completion
  const toggleTodo = (id: string) => {
    setCompletedTodos(prev => 
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  // Dismiss a todo
  const dismissTodo = (id: string) => {
    setDismissedTodos(prev => [...prev, id]);
  };

  // Filter out dismissed todos
  const visibleTodos = initialTodoItems.filter(t => !dismissedTodos.includes(t.id));

  // Calculate today's jobs from the fetched jobs
  const today = new Date().toISOString().split('T')[0];
  const todaysJobs = jobs.filter(j => j.scheduled_date === today);

  // Default stats while loading
  const stats = workflowStats || {
    requests: { new: 0, assessmentsComplete: 0, overdue: 0 },
    quotes: { approved: 0, approvedAmount: 0, draft: 0, draftAmount: 0, changesRequested: 0 },
    jobs: { requiresInvoicing: 0, active: 0, actionRequired: 0 },
    invoices: { awaitingPayment: 0, awaitingPaymentAmount: 0, draft: 0, draftAmount: 0, pastDue: 0, pastDueAmount: 0 },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Loading dashboard...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {user?.name?.split(' ')[0] || 'there'}
          </h1>
          <p className="text-gray-600">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" href="/jobs/new">
            <Plus className="h-4 w-4" />
            New Job
          </Button>
          <Button variant="outline" href="/quotes/new">
            <Plus className="h-4 w-4" />
            New Quote
          </Button>
          <Button href="/invoices/new">
            <Plus className="h-4 w-4" />
            New Invoice
          </Button>
        </div>
      </div>

      {/* Jobber-style Workflow Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Requests Card */}
        <Link href="/requests">
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                Requests
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">New</span>
                  <span className="text-sm font-semibold text-blue-600">{stats.requests.new}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Assessment complete</span>
                  <span className="text-sm font-semibold">{stats.requests.assessmentsComplete}</span>
                </div>
                {stats.requests.overdue > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-red-500">Overdue</span>
                    <span className="text-sm font-semibold text-red-600">{stats.requests.overdue}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Quotes Card */}
        <Link href="/quotes">
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Quotes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Approved</span>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-green-600">{stats.quotes.approved}</span>
                    <span className="text-xs text-gray-400 ml-1">${stats.quotes.approvedAmount.toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Draft</span>
                  <div className="text-right">
                    <span className="text-sm font-semibold">{stats.quotes.draft}</span>
                    <span className="text-xs text-gray-400 ml-1">${stats.quotes.draftAmount.toLocaleString()}</span>
                  </div>
                </div>
                {stats.quotes.changesRequested > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-amber-500">Changes requested</span>
                    <span className="text-sm font-semibold text-amber-600">{stats.quotes.changesRequested}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Jobs Card */}
        <Link href="/jobs">
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Briefcase className="h-4 w-4" />
                Jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Requires invoicing</span>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-green-600">{stats.jobs.requiresInvoicing}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Active</span>
                  <div className="text-right">
                    <span className="text-sm font-semibold">{stats.jobs.active}</span>
                  </div>
                </div>
                {stats.jobs.actionRequired > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-red-500">Action required</span>
                    <span className="text-sm font-semibold text-red-600">{stats.jobs.actionRequired}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Invoices Card */}
        <Link href="/invoices">
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                Invoices
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Awaiting payment</span>
                  <div className="text-right">
                    <span className="text-sm font-semibold">{stats.invoices.awaitingPayment}</span>
                    <span className="text-xs text-gray-400 ml-1">${stats.invoices.awaitingPaymentAmount.toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Draft</span>
                  <div className="text-right">
                    <span className="text-sm font-semibold">{stats.invoices.draft}</span>
                    <span className="text-xs text-gray-400 ml-1">${stats.invoices.draftAmount.toLocaleString()}</span>
                  </div>
                </div>
                {stats.invoices.pastDue > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-red-500">Past due</span>
                    <div className="text-right">
                      <span className="text-sm font-semibold text-red-600">{stats.invoices.pastDue}</span>
                      <span className="text-xs text-red-400 ml-1">${stats.invoices.pastDueAmount.toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Today's Schedule */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Today's Schedule
          </CardTitle>
          <Button variant="ghost" size="sm" href="/schedule">
            View All
            <ChevronRight className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {todaysJobs.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="h-12 w-12 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">No jobs scheduled for today</p>
              <Button variant="outline" size="sm" className="mt-4" href="/jobs/new">
                <Plus className="h-4 w-4" />
                Schedule a Job
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {todaysJobs.slice(0, 5).map(job => (
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}`}
                  className="flex items-center gap-4 py-3 hover:bg-gray-50 -mx-4 px-4 transition-colors"
                >
                  <div className="flex-shrink-0">
                    <div className="w-12 text-center">
                      <p className="text-sm font-medium">{job.scheduled_time?.slice(0, 5) || '--:--'}</p>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">{job.job_type}</p>
                    <p className="text-sm text-gray-500 truncate">
                      {job.property?.customer?.name || 'Unknown'} • {job.property?.address || 'No address'}
                    </p>
                  </div>
                  <JobStatusBadge status={job.status} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom Row - Fleet & Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        <FleetWidget />
        <ActivityFeed />
      </div>

      {/* Getting Started Todos */}
      {visibleTodos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Getting Started</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {visibleTodos.map(todo => {
                const Icon = todo.icon;
                const isComplete = completedTodos.includes(todo.id);
                return (
                  <div
                    key={todo.id}
                    className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${
                      isComplete ? 'bg-green-50 border-green-200' : 'hover:bg-gray-50'
                    }`}
                  >
                    <button
                      onClick={() => toggleTodo(todo.id)}
                      className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                        isComplete 
                          ? 'bg-green-500 border-green-500 text-white' 
                          : 'border-gray-300 hover:border-green-500'
                      }`}
                    >
                      {isComplete && <CheckCircle className="h-4 w-4" />}
                    </button>
                    <Link href={todo.href} className="flex-1 min-w-0">
                      <p className={`font-medium ${isComplete ? 'text-green-700 line-through' : 'text-gray-900'}`}>
                        {todo.title}
                      </p>
                      <p className="text-sm text-gray-500">{todo.description}</p>
                    </Link>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{todo.time}</span>
                      <button
                        onClick={() => dismissTodo(todo.id)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
