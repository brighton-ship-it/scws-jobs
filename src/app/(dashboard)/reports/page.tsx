'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateRangePicker, DateRangeOption } from '@/components/reports/DateRangePicker';
import { 
  DollarSign, 
  Briefcase, 
  Users, 
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  UserCheck,
  Repeat,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from 'recharts';
import { format, parseISO } from 'date-fns';

const COLORS = ['#3B82F6', '#F59E0B', '#10B981', '#8B5CF6', '#EF4444', '#EC4899', '#06B6D4'];

interface RevenueData {
  summary: {
    totalInvoiced: number;
    totalPaid: number;
    outstandingBalance: number;
    invoiceCount: number;
    paidCount: number;
    overdueCount: number;
    pendingCount: number;
    revenueChange: number;
  };
  trend: Array<{ date: string; amount: number; label: string }>;
}

interface JobsData {
  summary: {
    total: number;
    scheduled: number;
    inProgress: number;
    completed: number;
    completionRate: number;
    jobsChange: number;
  };
  byStatus: Array<{ name: string; value: number; color: string }>;
  byType: Array<{ name: string; count: number }>;
  trend: Array<{ date: string; label: string; scheduled: number; completed: number }>;
  recentJobs: Array<{
    id: string;
    jobNumber: string;
    status: string;
    type: string;
    scheduledDate: string;
    customerName: string;
    address: string;
    techName: string;
  }>;
}

interface TechsData {
  summary: {
    activeTechs: number;
    totalJobsAssigned: number;
    totalCompleted: number;
    avgJobsPerTech: number;
  };
  techPerformance: Array<{
    id: string;
    name: string;
    totalJobs: number;
    completedJobs: number;
    completionRate: number;
    avgCompletionTime: string;
  }>;
  leaderboard: Array<{ name: string; jobs: number; fullName: string }>;
}

interface CustomersData {
  summary: {
    totalCustomers: number;
    newCustomers: number;
    activeCustomers: number;
    repeatCustomers: number;
    repeatRate: number;
    newCustomerChange: number;
  };
  topCustomers: Array<{
    id: string;
    name: string;
    totalPaid: number;
    totalInvoiced: number;
    outstanding: number;
    invoiceCount: number;
  }>;
}

export default function ReportsPage() {
  const [dateRange, setDateRange] = useState<DateRangeOption>('month');
  const [customStart, setCustomStart] = useState<string>();
  const [customEnd, setCustomEnd] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [revenueData, setRevenueData] = useState<RevenueData | null>(null);
  const [jobsData, setJobsData] = useState<JobsData | null>(null);
  const [techsData, setTechsData] = useState<TechsData | null>(null);
  const [customersData, setCustomersData] = useState<CustomersData | null>(null);

  const handleDateRangeChange = (range: DateRangeOption, startDate?: string, endDate?: string) => {
    setDateRange(range);
    if (range === 'custom' && startDate && endDate) {
      setCustomStart(startDate);
      setCustomEnd(endDate);
    }
  };

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({ range: dateRange });
      if (dateRange === 'custom' && customStart && customEnd) {
        params.set('startDate', customStart);
        params.set('endDate', customEnd);
      }

      try {
        const [revenueRes, jobsRes, techsRes, customersRes] = await Promise.all([
          fetch(`/api/reports/revenue?${params}`),
          fetch(`/api/reports/jobs?${params}`),
          fetch(`/api/reports/techs?${params}`),
          fetch(`/api/reports/customers?${params}`),
        ]);

        if (!revenueRes.ok || !jobsRes.ok || !techsRes.ok || !customersRes.ok) {
          throw new Error('Failed to fetch report data');
        }

        const [revenue, jobs, techs, customers] = await Promise.all([
          revenueRes.json(),
          jobsRes.json(),
          techsRes.json(),
          customersRes.json(),
        ]);

        setRevenueData(revenue);
        setJobsData(jobs);
        setTechsData(techs);
        setCustomersData(customers);
      } catch (err) {
        console.error('Error fetching reports:', err);
        setError('Failed to load report data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [dateRange, customStart, customEnd]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      scheduled: 'bg-blue-100 text-blue-700',
      in_progress: 'bg-yellow-100 text-yellow-700',
      completed: 'bg-green-100 text-green-700',
      invoiced: 'bg-purple-100 text-purple-700',
    };
    return styles[status] || 'bg-gray-100 text-gray-700';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Reports Dashboard</h2>
          <p className="text-gray-600">Analytics and insights for your business</p>
        </div>
        <DateRangePicker
          value={dateRange}
          onChange={handleDateRangeChange}
          startDate={customStart}
          endDate={customEnd}
        />
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Revenue Card */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-green-100 p-3">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              {revenueData?.summary.revenueChange !== undefined && (
                <div className={`flex items-center gap-1 text-sm ${revenueData.summary.revenueChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {revenueData.summary.revenueChange >= 0 ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  {Math.abs(revenueData.summary.revenueChange)}%
                </div>
              )}
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(revenueData?.summary.totalPaid || 0)}
              </p>
              <p className="text-sm text-gray-600">Revenue Collected</p>
            </div>
          </CardContent>
        </Card>

        {/* Jobs Card */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-blue-100 p-3">
                <Briefcase className="h-5 w-5 text-blue-600" />
              </div>
              {jobsData?.summary.jobsChange !== undefined && (
                <div className={`flex items-center gap-1 text-sm ${jobsData.summary.jobsChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {jobsData.summary.jobsChange >= 0 ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  {Math.abs(jobsData.summary.jobsChange)}%
                </div>
              )}
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold text-gray-900">{jobsData?.summary.completed || 0}</p>
              <p className="text-sm text-gray-600">Jobs Completed</p>
            </div>
          </CardContent>
        </Card>

        {/* Customers Card */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-purple-100 p-3">
                <Users className="h-5 w-5 text-purple-600" />
              </div>
              {customersData?.summary.newCustomerChange !== undefined && (
                <div className={`flex items-center gap-1 text-sm ${customersData.summary.newCustomerChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {customersData.summary.newCustomerChange >= 0 ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  {Math.abs(customersData.summary.newCustomerChange)}%
                </div>
              )}
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold text-gray-900">{customersData?.summary.newCustomers || 0}</p>
              <p className="text-sm text-gray-600">New Customers</p>
            </div>
          </CardContent>
        </Card>

        {/* Outstanding Card */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-orange-100 p-3">
                <Clock className="h-5 w-5 text-orange-600" />
              </div>
              <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700">
                {revenueData?.summary.overdueCount || 0} overdue
              </span>
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(revenueData?.summary.outstandingBalance || 0)}
              </p>
              <p className="text-sm text-gray-600">Outstanding Balance</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Stats Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-lg bg-emerald-100 p-2">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-lg font-semibold text-gray-900">{jobsData?.summary.completionRate || 0}%</p>
              <p className="text-xs text-gray-600">Completion Rate</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-lg bg-blue-100 p-2">
              <UserCheck className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="text-lg font-semibold text-gray-900">{techsData?.summary.activeTechs || 0}</p>
              <p className="text-xs text-gray-600">Active Techs</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-lg bg-purple-100 p-2">
              <Repeat className="h-4 w-4 text-purple-600" />
            </div>
            <div>
              <p className="text-lg font-semibold text-gray-900">{customersData?.summary.repeatRate || 0}%</p>
              <p className="text-xs text-gray-600">Repeat Customer Rate</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-lg bg-green-100 p-2">
              <DollarSign className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <p className="text-lg font-semibold text-gray-900">
                {formatCurrency(revenueData?.summary.totalInvoiced || 0)}
              </p>
              <p className="text-xs text-gray-600">Total Invoiced</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue Over Time */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {revenueData?.trend && revenueData.trend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueData.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(value) => `$${value}`} tick={{ fontSize: 12 }} />
                    <Tooltip 
                      formatter={(value: number) => [formatCurrency(value), 'Revenue']}
                      contentStyle={{ borderRadius: '8px' }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="amount" 
                      stroke="#10B981" 
                      strokeWidth={2}
                      dot={{ fill: '#10B981' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  No revenue data for this period
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Jobs by Status */}
        <Card>
          <CardHeader>
            <CardTitle>Jobs by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {jobsData?.byStatus && jobsData.byStatus.some(s => s.value > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={jobsData.byStatus}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => percent > 0 ? `${name} (${(percent * 100).toFixed(0)}%)` : ''}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {jobsData.byStatus.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  No jobs for this period
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tech Leaderboard & Popular Services */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Tech Leaderboard */}
        <Card>
          <CardHeader>
            <CardTitle>Tech Leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {techsData?.leaderboard && techsData.leaderboard.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={techsData.leaderboard} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis type="number" tick={{ fontSize: 12 }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={80} />
                    <Tooltip 
                      formatter={(value: number, name: string, props: any) => [value, `${props.payload.fullName}`]}
                    />
                    <Bar dataKey="jobs" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  No tech data for this period
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Popular Services */}
        <Card>
          <CardHeader>
            <CardTitle>Popular Services</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {jobsData?.byType && jobsData.byType.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={jobsData.byType.slice(0, 6)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  No service data for this period
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tables Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Jobs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 font-medium text-gray-600">Job</th>
                    <th className="text-left py-2 font-medium text-gray-600">Customer</th>
                    <th className="text-left py-2 font-medium text-gray-600">Status</th>
                    <th className="text-left py-2 font-medium text-gray-600">Tech</th>
                  </tr>
                </thead>
                <tbody>
                  {jobsData?.recentJobs && jobsData.recentJobs.length > 0 ? (
                    jobsData.recentJobs.slice(0, 5).map((job) => (
                      <tr key={job.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-3">
                          <div className="font-medium text-gray-900">{job.jobNumber || job.id.slice(0, 8)}</div>
                          <div className="text-xs text-gray-500">{job.type}</div>
                        </td>
                        <td className="py-3">
                          <div className="text-gray-900">{job.customerName}</div>
                          <div className="text-xs text-gray-500 truncate max-w-[150px]">{job.address}</div>
                        </td>
                        <td className="py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(job.status)}`}>
                            {job.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="py-3 text-gray-600">{job.techName}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-gray-500">
                        No recent jobs
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Top Customers */}
        <Card>
          <CardHeader>
            <CardTitle>Top Customers by Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 font-medium text-gray-600">Customer</th>
                    <th className="text-right py-2 font-medium text-gray-600">Invoiced</th>
                    <th className="text-right py-2 font-medium text-gray-600">Paid</th>
                    <th className="text-right py-2 font-medium text-gray-600">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {customersData?.topCustomers && customersData.topCustomers.length > 0 ? (
                    customersData.topCustomers.slice(0, 5).map((customer) => (
                      <tr key={customer.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-3">
                          <div className="font-medium text-gray-900">{customer.name}</div>
                          <div className="text-xs text-gray-500">{customer.invoiceCount} invoices</div>
                        </td>
                        <td className="py-3 text-right text-gray-900">
                          {formatCurrency(customer.totalInvoiced)}
                        </td>
                        <td className="py-3 text-right text-green-600 font-medium">
                          {formatCurrency(customer.totalPaid)}
                        </td>
                        <td className="py-3 text-right">
                          {customer.outstanding > 0 ? (
                            <span className="text-orange-600">{formatCurrency(customer.outstanding)}</span>
                          ) : (
                            <span className="text-gray-400">$0</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-gray-500">
                        No customer data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tech Performance Table */}
      <Card>
        <CardHeader>
          <CardTitle>Tech Performance Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 font-medium text-gray-600">Technician</th>
                  <th className="text-center py-2 font-medium text-gray-600">Total Jobs</th>
                  <th className="text-center py-2 font-medium text-gray-600">Completed</th>
                  <th className="text-center py-2 font-medium text-gray-600">Scheduled</th>
                  <th className="text-center py-2 font-medium text-gray-600">In Progress</th>
                  <th className="text-center py-2 font-medium text-gray-600">Completion Rate</th>
                  <th className="text-center py-2 font-medium text-gray-600">Avg Time</th>
                </tr>
              </thead>
              <tbody>
                {techsData?.techPerformance && techsData.techPerformance.length > 0 ? (
                  techsData.techPerformance.map((tech) => (
                    <tr key={tech.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-3 font-medium text-gray-900">{tech.name}</td>
                      <td className="py-3 text-center text-gray-900">{tech.totalJobs}</td>
                      <td className="py-3 text-center text-green-600 font-medium">{tech.completedJobs}</td>
                      <td className="py-3 text-center text-blue-600">{(tech as any).scheduledJobs || 0}</td>
                      <td className="py-3 text-center text-yellow-600">{(tech as any).inProgressJobs || 0}</td>
                      <td className="py-3 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          tech.completionRate >= 80 
                            ? 'bg-green-100 text-green-700' 
                            : tech.completionRate >= 50 
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-red-100 text-red-700'
                        }`}>
                          {tech.completionRate}%
                        </span>
                      </td>
                      <td className="py-3 text-center text-gray-600">{tech.avgCompletionTime}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-500">
                      No tech data for this period
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
