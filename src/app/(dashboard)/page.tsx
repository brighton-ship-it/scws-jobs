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
  const thisWeekJobs = mockJobs.filter(j => {
    if (!j.scheduled_date) return false;
    const jobDate = new Date(j.scheduled_date);
    return jobDate >= weekStart && jobDate <= weekEnd;
  });

  // Revenue calculations
  const thisWeekRevenue = mockInvoices
    .filter(inv => inv.status === 'paid' && inv.paid_at)
    .filter(inv => {
      const paidDate = new Date(inv.paid_at!);
      return paidDate >= weekStart && paidDate <= weekEnd;
    })
    .reduce((sum, inv) => sum + inv.amount, 0);

  const pendingInvoices = mockInvoices.filter(i => i.status === 'sent');
  const pendingAmount = pendingInvoices.reduce((sum, inv) => sum + inv.amount, 0);

  // Overdue invoices
  const overdueInvoices = pendingInvoices.filter(inv => {
    if (!inv.due_date) return false;
    return new Date(inv.due_date) < new Date();
  });

  // Unassigned jobs
  const unassignedJobs = getUnassignedJobs();

  const stats = [
    {
      name: "Today's Jobs",
      value: todaysJobs.length,
      icon: Calendar,
      color: 'bg-blue-500',
      href: '/schedule',
    },
    {
      name: 'Week Revenue',
      value: `$${(thisWeekRevenue || 0).toLocaleString()}`,
      icon: TrendingUp,
      color: 'bg-green-500',
      href: '/reports/revenue',
    },
    {
      name: 'Outstanding',
      value: `$${(pendingAmount || 0).toLocaleString()}`,
      icon: DollarSign,
      color: 'bg-purple-500',
      href: '/invoices',
    },
    {
      name: 'Need Scheduling',
      value: unassignedJobs.length,
      icon: AlertTriangle,
      color: unassignedJobs.length > 0 ? 'bg-orange-500' : 'bg-gray-400',
      href: '/dispatch',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">
          Good {getTimeOfDay()}, {user?.name?.split(' ')[0]}
        </h2>
        <p className="text-gray-600">Here&apos;s what&apos;s happening today</p>
      </div>

      {/* Alerts */}
      {(overdueInvoices.length > 0 || unassignedJobs.length > 0) && (
        <div className="space-y-2">
          {overdueInvoices.length > 0 && (
            <Link href="/reports/receivables">
              <div className="flex items-center gap-3 rounded-lg bg-red-50 border border-red-200 p-4 hover:bg-red-100 transition-colors">
                <AlertCircle className="h-5 w-5 text-red-600" />
                <p className="flex-1 text-sm font-medium text-red-800">
                  {overdueInvoices.length} invoice{overdueInvoices.length !== 1 ? 's' : ''} overdue
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

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.name} href={stat.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="flex items-center gap-4 py-6">
                <div className={`rounded-lg p-3 ${stat.color}`}>
                  <stat.icon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">{stat.name}</p>
                  <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Today's Schedule - Takes 2 columns */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Today&apos;s Schedule</CardTitle>
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
                      href={`/jobs/${job.id}/edit`}
                      className="flex items-start gap-4 rounded-lg border border-gray-100 p-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
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

        {/* Activity Feed */}
        <ActivityFeed limit={6} />
      </div>

      {/* Bottom Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending Invoices */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Pending Invoices</CardTitle>
            <Button variant="ghost" size="sm" href="/invoices">
              View all <ArrowRight className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {pendingInvoices.length === 0 ? (
              <div className="py-6 text-center">
                <DollarSign className="mx-auto h-10 w-10 text-gray-300" />
                <p className="mt-2 text-sm text-gray-500">No pending invoices</p>
              </div>
            ) : (
              pendingInvoices.slice(0, 5).map((invoice) => {
                const customer = getCustomerById(invoice.customer_id);
                const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
                const isOverdue = dueDate && dueDate < new Date();

                return (
                  <div
                    key={invoice.id}
                    className="flex items-center gap-4 rounded-lg border border-gray-100 p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className={`rounded-lg p-2 ${isOverdue ? 'bg-red-100' : 'bg-gray-100'}`}>
                      {isOverdue ? (
                        <AlertCircle className="h-5 w-5 text-red-600" />
                      ) : (
                        <DollarSign className="h-5 w-5 text-gray-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{invoice.invoice_number}</p>
                      <p className="text-sm text-gray-600 truncate">{customer?.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-gray-900">
                        ${(invoice.amount || 0).toLocaleString()}
                      </p>
                      {dueDate && (
                        <p className={`text-sm ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
                          Due {format(dueDate, 'MMM d')}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Button href="/jobs/new" className="justify-start">
              <Briefcase className="h-4 w-4" />
              Create New Job
            </Button>
            <Button href="/customers/new" variant="outline" className="justify-start">
              <Users className="h-4 w-4" />
              Add Customer
            </Button>
            <Button href="/dispatch" variant="outline" className="justify-start">
              <MapPin className="h-4 w-4" />
              Dispatch Board
            </Button>
            <Button href="/reports" variant="outline" className="justify-start">
              <TrendingUp className="h-4 w-4" />
              View Reports
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
