'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { JobStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { useAuth } from '@/contexts/AuthContext';
import {
  mockJobs,
  mockCustomers,
  mockInvoices,
  mockQuotes,
  getPropertyById,
  getCustomerById,
  getUserById,
  getUnassignedJobs,
} from '@/lib/mock-data';
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
} from 'lucide-react';
import { format, startOfWeek, endOfWeek } from 'date-fns';
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

  // Calculate stats
  const today = new Date().toISOString().split('T')[0];
  const todaysJobs = mockJobs.filter(j => j.scheduled_date === today);
  
  // This week's stats
  const weekStart = startOfWeek(new Date());
  const weekEnd = endOfWeek(new Date());

  // Revenue calculations
  const thisWeekRevenue = mockInvoices
    .filter(inv => inv.status === 'paid' && inv.paid_at)
    .filter(inv => {
      const paidDate = new Date(inv.paid_at!);
      return paidDate >= weekStart && paidDate <= weekEnd;
    })
    .reduce((sum, inv) => sum + inv.amount, 0);

  const pendingInvoices = mockInvoices.filter(i => i.status === 'sent');
  const pendingAmount = pendingInvoices.reduce((sum, inv) => sum + inv.total, 0);

  // Overdue invoices
  const overdueInvoices = pendingInvoices.filter(inv => {
    if (!inv.due_date) return false;
    return new Date(inv.due_date) < new Date();
  });

  // Unassigned jobs
  const unassignedJobs = getUnassignedJobs();

  // Workflow stats for Jobber-style cards
  const workflowStats = {
    requests: {
      new: 3,
      assessmentsComplete: 1,
      overdue: 0,
    },
    quotes: {
      approved: mockQuotes.filter(q => q.status === 'accepted').length,
      approvedAmount: mockQuotes.filter(q => q.status === 'accepted').reduce((sum, q) => sum + q.total, 0),
      draft: mockQuotes.filter(q => q.status === 'draft').length,
      draftAmount: mockQuotes.filter(q => q.status === 'draft').reduce((sum, q) => sum + q.total, 0),
      changesRequested: mockQuotes.filter(q => q.status === 'declined').length,
    },
    jobs: {
      requiresInvoicing: mockJobs.filter(j => j.status === 'completed').length,
      requiresInvoicingAmount: mockJobs.filter(j => j.status === 'completed').length * 450,
      active: mockJobs.filter(j => j.status === 'scheduled' || j.status === 'in_progress').length,
      activeAmount: mockJobs.filter(j => j.status === 'scheduled' || j.status === 'in_progress').length * 350,
      actionRequired: mockJobs.filter(j => j.priority === 'urgent' || j.priority === 'high').length,
    },
    invoices: {
      awaitingPayment: mockInvoices.filter(i => i.status === 'sent').length,
      awaitingPaymentAmount: mockInvoices.filter(i => i.status === 'sent').reduce((sum, inv) => sum + (inv.total - inv.amount_paid), 0),
      draft: mockInvoices.filter(i => i.status === 'draft').length,
      draftAmount: mockInvoices.filter(i => i.status === 'draft').reduce((sum, inv) => sum + inv.total, 0),
      pastDue: overdueInvoices.length,
      pastDueAmount: overdueInvoices.reduce((sum, inv) => sum + (inv.total - inv.amount_paid), 0),
    },
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Welcome Header - Jobber Style */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{format(new Date(), 'EEEE, MMMM d')}</p>
          <h2 className="text-2xl font-bold text-gray-900 mt-0.5">
            Good {getTimeOfDay()}, {user?.name?.split(' ')[0]}
          </h2>
        </div>
        <Button href="/jobs/new" className="hidden sm:flex">
          <Plus className="h-4 w-4" />
          New Job
        </Button>
      </div>

      {/* Alerts - Jobber Style */}
      {(overdueInvoices.length > 0 || unassignedJobs.length > 0) && (
        <div className="space-y-2">
          {overdueInvoices.length > 0 && (
            <Link href="/reports/receivables">
              <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-100 p-4 hover:bg-red-100/70 transition-all group">
                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertCircle className="h-5 w-5 text-red-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-800">
                    {overdueInvoices.length} invoice{overdueInvoices.length !== 1 ? 's' : ''} past due
                  </p>
                  <p className="text-xs text-red-600">Click to view receivables report</p>
                </div>
                <ChevronRight className="h-5 w-5 text-red-400 group-hover:text-red-600 transition-colors" />
              </div>
            </Link>
          )}
          {unassignedJobs.length > 0 && (
            <Link href="/dispatch">
              <div className="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-100 p-4 hover:bg-amber-100/70 transition-all group">
                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-800">
                    {unassignedJobs.length} job{unassignedJobs.length !== 1 ? 's' : ''} need assignment
                  </p>
                  <p className="text-xs text-amber-600">Open dispatch to assign team members</p>
                </div>
                <ChevronRight className="h-5 w-5 text-amber-400 group-hover:text-amber-600 transition-colors" />
              </div>
            </Link>
          )}
        </div>
      )}

      {/* Jobber-style Workflow Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Requests Card */}
        <Card>
          <CardContent className="py-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-blue-50">
                <ClipboardList className="h-5 w-5 text-blue-600" />
              </div>
              <h3 className="font-semibold text-gray-900">Requests</h3>
            </div>
            <Link href="/requests" className="block group">
              <p className="text-3xl font-bold text-gray-900 group-hover:text-emerald-600 transition-colors">
                {workflowStats.requests.new}
              </p>
              <p className="text-sm text-gray-500 mt-0.5">New requests</p>
            </Link>
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
              <Link href="/requests?status=complete" className="flex justify-between text-sm text-gray-600 hover:text-emerald-600 transition-colors">
                <span>Assessments complete</span>
                <span className="font-medium">{workflowStats.requests.assessmentsComplete}</span>
              </Link>
              <Link href="/requests?status=overdue" className="flex justify-between text-sm text-gray-600 hover:text-emerald-600 transition-colors">
                <span>Overdue</span>
                <span className={`font-medium ${workflowStats.requests.overdue > 0 ? 'text-red-600' : ''}`}>
                  {workflowStats.requests.overdue}
                </span>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Quotes Card */}
        <Card>
          <CardContent className="py-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-emerald-50">
                <FileText className="h-5 w-5 text-emerald-600" />
              </div>
              <h3 className="font-semibold text-gray-900">Quotes</h3>
            </div>
            <Link href="/quotes?status=accepted" className="block group">
              <p className="text-3xl font-bold text-gray-900 group-hover:text-emerald-600 transition-colors">
                {workflowStats.quotes.approved}
              </p>
              <p className="text-sm text-gray-500 mt-0.5">
                Approved · ${workflowStats.quotes.approvedAmount.toLocaleString()}
              </p>
            </Link>
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
              <Link href="/quotes?status=draft" className="flex justify-between text-sm text-gray-600 hover:text-emerald-600 transition-colors">
                <span>Draft</span>
                <span className="font-medium">{workflowStats.quotes.draft} · ${workflowStats.quotes.draftAmount.toLocaleString()}</span>
              </Link>
              <Link href="/quotes?status=declined" className="flex justify-between text-sm text-gray-600 hover:text-emerald-600 transition-colors">
                <span>Changes requested</span>
                <span className="font-medium">{workflowStats.quotes.changesRequested}</span>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Jobs Card */}
        <Card>
          <CardContent className="py-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-purple-50">
                <Briefcase className="h-5 w-5 text-purple-600" />
              </div>
              <h3 className="font-semibold text-gray-900">Jobs</h3>
            </div>
            <Link href="/jobs?status=completed" className="block group">
              <p className="text-3xl font-bold text-gray-900 group-hover:text-emerald-600 transition-colors">
                {workflowStats.jobs.requiresInvoicing}
              </p>
              <p className="text-sm text-gray-500 mt-0.5">
                Requires invoicing · ${workflowStats.jobs.requiresInvoicingAmount.toLocaleString()}
              </p>
            </Link>
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
              <Link href="/jobs?status=scheduled" className="flex justify-between text-sm text-gray-600 hover:text-emerald-600 transition-colors">
                <span>Active</span>
                <span className="font-medium">{workflowStats.jobs.active} · ${workflowStats.jobs.activeAmount.toLocaleString()}</span>
              </Link>
              <Link href="/jobs?priority=urgent" className="flex justify-between text-sm text-gray-600 hover:text-emerald-600 transition-colors">
                <span>Action required</span>
                <span className={`font-medium ${workflowStats.jobs.actionRequired > 0 ? 'text-orange-600' : ''}`}>
                  {workflowStats.jobs.actionRequired}
                </span>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Invoices Card */}
        <Card>
          <CardContent className="py-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-amber-50">
                <Receipt className="h-5 w-5 text-amber-600" />
              </div>
              <h3 className="font-semibold text-gray-900">Invoices</h3>
            </div>
            <Link href="/invoices?status=sent" className="block group">
              <p className="text-3xl font-bold text-gray-900 group-hover:text-emerald-600 transition-colors">
                {workflowStats.invoices.awaitingPayment}
              </p>
              <p className="text-sm text-gray-500 mt-0.5">
                Awaiting payment · ${workflowStats.invoices.awaitingPaymentAmount.toLocaleString()}
              </p>
            </Link>
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
              <Link href="/invoices?status=draft" className="flex justify-between text-sm text-gray-600 hover:text-emerald-600 transition-colors">
                <span>Draft</span>
                <span className="font-medium">{workflowStats.invoices.draft} · ${workflowStats.invoices.draftAmount.toLocaleString()}</span>
              </Link>
              <Link href="/invoices?status=overdue" className="flex justify-between text-sm text-gray-600 hover:text-emerald-600 transition-colors">
                <span>Past due</span>
                <span className={`font-medium ${workflowStats.invoices.pastDue > 0 ? 'text-red-600' : ''}`}>
                  {workflowStats.invoices.pastDue} · ${workflowStats.invoices.pastDueAmount.toLocaleString()}
                </span>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* To-do Section - Jobber Style */}
      {visibleTodos.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>To do</CardTitle>
              <span className="text-sm text-gray-500">{visibleTodos.length - completedTodos.filter(id => visibleTodos.some(t => t.id === id)).length} remaining</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {visibleTodos.map((item) => {
              const isCompleted = completedTodos.includes(item.id);
              const Icon = item.icon;
              
              return (
                <div 
                  key={item.id}
                  className={`flex items-center gap-4 p-4 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50/50 transition-all group ${isCompleted ? 'opacity-60' : ''}`}
                >
                  <button
                    onClick={() => toggleTodo(item.id)}
                    className="flex-shrink-0"
                  >
                    {isCompleted ? (
                      <CheckCircle className="h-6 w-6 text-emerald-500" />
                    ) : (
                      <Circle className="h-6 w-6 text-gray-300 group-hover:text-emerald-400 transition-colors" />
                    )}
                  </button>
                  
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="p-2 rounded-lg bg-gray-100 group-hover:bg-gray-200 transition-colors">
                      <Icon className="h-4 w-4 text-gray-600" />
                    </div>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <Link 
                      href={item.href}
                      className={`text-sm font-medium text-gray-900 hover:text-emerald-600 transition-colors ${isCompleted ? 'line-through' : ''}`}
                    >
                      {item.title}
                    </Link>
                    <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                  </div>
                  
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      {item.time}
                    </span>
                    <button
                      onClick={() => dismissTodo(item.id)}
                      className="text-gray-400 hover:text-gray-600 transition-colors opacity-0 group-hover:opacity-100"
                      title="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Today's Schedule - Takes 2 columns */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle>Today&apos;s Appointments</CardTitle>
                <div className="flex gap-4 mt-2 text-sm">
                  <span className="text-gray-500">
                    Total: <span className="font-semibold text-gray-900">${(todaysJobs.length * 350).toLocaleString()}</span>
                  </span>
                  <span className="text-gray-500">
                    Active: <span className="font-semibold text-gray-900">{todaysJobs.filter(j => j.status === 'in_progress').length}</span>
                  </span>
                  <span className="text-gray-500">
                    Completed: <span className="font-semibold text-emerald-600">{todaysJobs.filter(j => j.status === 'completed').length}</span>
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="sm" href="/schedule">
                View all <ArrowRight className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 pt-2">
              {todaysJobs.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                    <Calendar className="h-6 w-6 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-900">No jobs scheduled for today</p>
                  <p className="text-sm text-gray-500 mt-1">Schedule a job to get started</p>
                  <Button variant="outline" size="sm" href="/jobs/new" className="mt-4">
                    <Plus className="h-4 w-4" />
                    Schedule a job
                  </Button>
                </div>
              ) : (
                todaysJobs.map((job) => {
                  const property = getPropertyById(job.property_id);
                  const customer = property ? getCustomerById(property.customer_id) : null;
                  const assignedUser = job.assigned_to ? getUserById(job.assigned_to) : null;

                  return (
                    <Link
                      key={job.id}
                      href={`/jobs/${job.id}`}
                      className="flex items-start gap-4 rounded-xl border border-gray-100 p-4 hover:border-gray-200 hover:bg-gray-50/50 transition-all group"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100 transition-colors">
                        <Clock className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-gray-900 group-hover:text-emerald-600 transition-colors">{job.job_type}</p>
                          <JobStatusBadge status={job.status} />
                        </div>
                        <p className="text-sm text-gray-600">{customer?.name}</p>
                        <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {property?.city || 'Unknown location'}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-900">{job.scheduled_time}</p>
                        {assignedUser && (
                          <p className="text-sm text-gray-500 mt-0.5">{assignedUser.name}</p>
                        )}
                      </div>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        {/* Business Performance Sidebar */}
        <div className="space-y-5">
          {/* Receivables */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Receivables</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {mockCustomers.slice(0, 3).map((customer) => {
                const customerInvoices = mockInvoices.filter(i => 
                  i.customer_id === customer.id && 
                  i.status !== 'paid' && 
                  i.status !== 'void'
                );
                const balance = customerInvoices.reduce((sum, inv) => sum + (inv.total - inv.amount_paid), 0);
                if (balance === 0) return null;
                
                return (
                  <div key={customer.id} className="flex items-center justify-between py-1">
                    <Link href={`/customers/${customer.id}`} className="text-sm font-medium text-gray-700 hover:text-emerald-600 transition-colors">
                      {customer.name}
                    </Link>
                    <span className="text-sm font-semibold text-gray-900">${balance.toLocaleString()}</span>
                  </div>
                );
              })}
              <Link href="/reports/receivables" className="flex items-center gap-1 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors pt-2">
                View all receivables <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>

          {/* Upcoming Jobs */}
          <Card>
            <CardContent className="py-5">
              <p className="text-sm font-medium text-gray-500">Upcoming jobs this week</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                ${(mockJobs.filter(j => j.status === 'scheduled').length * 400).toLocaleString()}
              </p>
              <p className="text-xs font-medium text-emerald-600 mt-1">+12% vs last week</p>
            </CardContent>
          </Card>

          {/* Revenue MTD */}
          <Card>
            <CardContent className="py-5">
              <p className="text-sm font-medium text-gray-500">Revenue this month</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                ${mockInvoices.filter(i => i.status === 'paid').reduce((sum, inv) => sum + inv.total, 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>

          {/* Activity Feed */}
          <ActivityFeed limit={4} />
        </div>
      </div>

      {/* Quick Actions - Jobber Style */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 pt-0">
          <Button href="/jobs/new" className="justify-start h-auto py-3">
            <Briefcase className="h-4 w-4" />
            <div className="text-left">
              <div className="font-semibold">Create Job</div>
              <div className="text-xs opacity-80 font-normal">Schedule new work</div>
            </div>
          </Button>
          <Button href="/customers/new" variant="outline" className="justify-start h-auto py-3">
            <Users className="h-4 w-4" />
            <div className="text-left">
              <div className="font-semibold">Add Customer</div>
              <div className="text-xs text-gray-500 font-normal">New client</div>
            </div>
          </Button>
          <Button href="/quotes/new" variant="outline" className="justify-start h-auto py-3">
            <FileText className="h-4 w-4" />
            <div className="text-left">
              <div className="font-semibold">New Quote</div>
              <div className="text-xs text-gray-500 font-normal">Send estimate</div>
            </div>
          </Button>
          <Button href="/invoices/new" variant="outline" className="justify-start h-auto py-3">
            <Receipt className="h-4 w-4" />
            <div className="text-left">
              <div className="font-semibold">Create Invoice</div>
              <div className="text-xs text-gray-500 font-normal">Bill customer</div>
            </div>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
