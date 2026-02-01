'use client';

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
} from 'lucide-react';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import Link from 'next/link';

export default function DashboardPage() {
  const { user } = useAuth();

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
    // Requests (mock - we don't have requests in this app)
    requests: {
      new: 3,
      assessmentsComplete: 1,
      overdue: 0,
    },
    // Quotes
    quotes: {
      approved: mockQuotes.filter(q => q.status === 'accepted').length,
      approvedAmount: mockQuotes.filter(q => q.status === 'accepted').reduce((sum, q) => sum + q.total, 0),
      draft: mockQuotes.filter(q => q.status === 'draft').length,
      draftAmount: mockQuotes.filter(q => q.status === 'draft').reduce((sum, q) => sum + q.total, 0),
      changesRequested: mockQuotes.filter(q => q.status === 'declined').length,
    },
    // Jobs
    jobs: {
      requiresInvoicing: mockJobs.filter(j => j.status === 'completed').length,
      requiresInvoicingAmount: mockJobs.filter(j => j.status === 'completed').length * 450, // Mock
      active: mockJobs.filter(j => j.status === 'scheduled' || j.status === 'in_progress').length,
      activeAmount: mockJobs.filter(j => j.status === 'scheduled' || j.status === 'in_progress').length * 350,
      actionRequired: mockJobs.filter(j => j.priority === 'urgent' || j.priority === 'high').length,
    },
    // Invoices
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
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <p className="text-sm text-gray-500">{format(new Date(), 'EEEE, MMMM d')}</p>
        <h2 className="text-2xl font-bold text-gray-900">
          Good {getTimeOfDay()}, {user?.name?.split(' ')[0]}
        </h2>
      </div>

      {/* Alerts */}
      {(overdueInvoices.length > 0 || unassignedJobs.length > 0) && (
        <div className="space-y-2">
          {overdueInvoices.length > 0 && (
            <Link href="/reports/receivables">
              <div className="flex items-center gap-3 rounded-lg bg-red-50 border border-red-200 p-4 hover:bg-red-100 transition-colors">
                <AlertCircle className="h-5 w-5 text-red-600" />
                <p className="flex-1 text-sm font-medium text-red-800">
                  {overdueInvoices.length} invoice{overdueInvoices.length !== 1 ? 's' : ''} past due
                </p>
                <ArrowRight className="h-4 w-4 text-red-600" />
              </div>
            </Link>
          )}
          {unassignedJobs.length > 0 && (
            <Link href="/dispatch">
              <div className="flex items-center gap-3 rounded-lg bg-yellow-50 border border-yellow-200 p-4 hover:bg-yellow-100 transition-colors">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
                <p className="flex-1 text-sm font-medium text-yellow-800">
                  {unassignedJobs.length} job{unassignedJobs.length !== 1 ? 's' : ''} need assignment
                </p>
                <ArrowRight className="h-4 w-4 text-yellow-600" />
              </div>
            </Link>
          )}
        </div>
      )}

      {/* Jobber-style Workflow Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Requests Card */}
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="py-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-blue-100">
                <ClipboardList className="h-5 w-5 text-blue-600" />
              </div>
              <h3 className="font-semibold text-gray-900">Requests</h3>
            </div>
            <Link href="/quotes" className="block">
              <p className="text-2xl font-bold text-gray-900">
                {workflowStats.requests.new} <span className="text-base font-medium text-gray-600">New</span>
              </p>
            </Link>
            <div className="mt-3 space-y-1 text-sm">
              <Link href="/quotes" className="flex justify-between text-gray-600 hover:text-green-600">
                <span>Assessments complete</span>
                <span>{workflowStats.requests.assessmentsComplete}</span>
              </Link>
              <Link href="/quotes" className="flex justify-between text-gray-600 hover:text-green-600">
                <span>Overdue</span>
                <span className={workflowStats.requests.overdue > 0 ? 'text-red-600 font-medium' : ''}>
                  {workflowStats.requests.overdue}
                </span>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Quotes Card */}
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="py-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-green-100">
                <FileText className="h-5 w-5 text-green-600" />
              </div>
              <h3 className="font-semibold text-gray-900">Quotes</h3>
            </div>
            <Link href="/quotes?status=accepted" className="block">
              <p className="text-2xl font-bold text-gray-900">
                {workflowStats.quotes.approved}{' '}
                <span className="text-base font-medium text-gray-600">
                  Approved · ${workflowStats.quotes.approvedAmount.toLocaleString()}
                </span>
              </p>
            </Link>
            <div className="mt-3 space-y-1 text-sm">
              <Link href="/quotes?status=draft" className="flex justify-between text-gray-600 hover:text-green-600">
                <span>Draft</span>
                <span>{workflowStats.quotes.draft} · ${workflowStats.quotes.draftAmount.toLocaleString()}</span>
              </Link>
              <Link href="/quotes?status=declined" className="flex justify-between text-gray-600 hover:text-green-600">
                <span>Changes requested</span>
                <span>{workflowStats.quotes.changesRequested}</span>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Jobs Card */}
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="py-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-purple-100">
                <Briefcase className="h-5 w-5 text-purple-600" />
              </div>
              <h3 className="font-semibold text-gray-900">Jobs</h3>
            </div>
            <Link href="/jobs?status=requires_invoicing" className="block">
              <p className="text-2xl font-bold text-gray-900">
                {workflowStats.jobs.requiresInvoicing}{' '}
                <span className="text-base font-medium text-gray-600">
                  Requires invoicing · ${workflowStats.jobs.requiresInvoicingAmount.toLocaleString()}
                </span>
              </p>
            </Link>
            <div className="mt-3 space-y-1 text-sm">
              <Link href="/jobs?status=scheduled" className="flex justify-between text-gray-600 hover:text-green-600">
                <span>Active</span>
                <span>{workflowStats.jobs.active} · ${workflowStats.jobs.activeAmount.toLocaleString()}</span>
              </Link>
              <Link href="/jobs?status=action_required" className="flex justify-between text-gray-600 hover:text-green-600">
                <span>Action required</span>
                <span className={workflowStats.jobs.actionRequired > 0 ? 'text-orange-600 font-medium' : ''}>
                  {workflowStats.jobs.actionRequired}
                </span>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Invoices Card */}
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="py-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-yellow-100">
                <Receipt className="h-5 w-5 text-yellow-600" />
              </div>
              <h3 className="font-semibold text-gray-900">Invoices</h3>
            </div>
            <Link href="/invoices?status=sent" className="block">
              <p className="text-2xl font-bold text-gray-900">
                {workflowStats.invoices.awaitingPayment}{' '}
                <span className="text-base font-medium text-gray-600">
                  Awaiting payment · ${workflowStats.invoices.awaitingPaymentAmount.toLocaleString()}
                </span>
              </p>
            </Link>
            <div className="mt-3 space-y-1 text-sm">
              <Link href="/invoices?status=draft" className="flex justify-between text-gray-600 hover:text-green-600">
                <span>Draft</span>
                <span>{workflowStats.invoices.draft} · ${workflowStats.invoices.draftAmount.toLocaleString()}</span>
              </Link>
              <Link href="/invoices?status=overdue" className="flex justify-between text-gray-600 hover:text-green-600">
                <span>Past due</span>
                <span className={workflowStats.invoices.pastDue > 0 ? 'text-red-600 font-medium' : ''}>
                  {workflowStats.invoices.pastDue} · ${workflowStats.invoices.pastDueAmount.toLocaleString()}
                </span>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Today's Schedule - Takes 2 columns */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Today&apos;s Appointments</CardTitle>
                <div className="flex gap-4 mt-2 text-sm">
                  <span className="text-gray-500">
                    Total: <span className="font-medium text-gray-900">${(todaysJobs.length * 350).toLocaleString()}</span>
                  </span>
                  <span className="text-gray-500">
                    Active: <span className="font-medium text-gray-900">{todaysJobs.filter(j => j.status === 'in_progress').length}</span>
                  </span>
                  <span className="text-gray-500">
                    Completed: <span className="font-medium text-green-600">{todaysJobs.filter(j => j.status === 'completed').length}</span>
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="sm" href="/schedule">
                View all <ArrowRight className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {todaysJobs.length === 0 ? (
                <div className="py-8 text-center">
                  <Calendar className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">No jobs scheduled for today</p>
                  <Button variant="outline" size="sm" href="/jobs/new" className="mt-4">
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
                      className="flex items-start gap-4 rounded-lg border border-gray-100 p-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-100 text-green-600">
                        <Clock className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{job.job_type}</p>
                          <JobStatusBadge status={job.status} />
                        </div>
                        <p className="text-sm text-gray-600">{customer?.name}</p>
                        <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                          <MapPin className="h-3 w-3" />
                          {property?.city || 'Unknown location'}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-gray-900">{job.scheduled_time}</p>
                        {assignedUser && (
                          <p className="text-sm text-gray-500">{assignedUser.name}</p>
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
        <div className="space-y-6">
          {/* Receivables */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Receivables</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {mockCustomers.slice(0, 3).map((customer) => {
                const customerInvoices = mockInvoices.filter(i => 
                  i.customer_id === customer.id && 
                  i.status !== 'paid' && 
                  i.status !== 'void'
                );
                const balance = customerInvoices.reduce((sum, inv) => sum + (inv.total - inv.amount_paid), 0);
                if (balance === 0) return null;
                
                return (
                  <div key={customer.id} className="flex items-center justify-between">
                    <Link href={`/customers/${customer.id}`} className="text-sm font-medium text-gray-900 hover:text-green-600">
                      {customer.name}
                    </Link>
                    <span className="text-sm font-medium text-gray-900">${balance.toLocaleString()}</span>
                  </div>
                );
              })}
              <Link href="/reports/receivables" className="text-sm text-green-600 hover:underline block mt-2">
                View all receivables →
              </Link>
            </CardContent>
          </Card>

          {/* Upcoming Jobs */}
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-gray-500">Upcoming jobs this week</p>
              <p className="text-2xl font-bold text-gray-900">
                ${mockJobs.filter(j => j.status === 'scheduled').length * 400}
              </p>
              <p className="text-xs text-green-600">+12% vs last week</p>
            </CardContent>
          </Card>

          {/* Revenue MTD */}
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-gray-500">Revenue this month</p>
              <p className="text-2xl font-bold text-gray-900">
                ${mockInvoices.filter(i => i.status === 'paid').reduce((sum, inv) => sum + inv.total, 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>

          {/* Activity Feed */}
          <ActivityFeed limit={4} />
        </div>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <Button href="/jobs/new" className="justify-start">
            <Briefcase className="h-4 w-4" />
            Create Job
          </Button>
          <Button href="/customers/new" variant="outline" className="justify-start">
            <Users className="h-4 w-4" />
            Add Customer
          </Button>
          <Button href="/quotes/new" variant="outline" className="justify-start">
            <FileText className="h-4 w-4" />
            New Quote
          </Button>
          <Button href="/invoices/new" variant="outline" className="justify-start">
            <Receipt className="h-4 w-4" />
            Create Invoice
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
