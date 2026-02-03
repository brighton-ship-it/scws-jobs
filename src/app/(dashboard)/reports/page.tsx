'use client';


import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  DollarSign, 
  Briefcase, 
  Users, 
  Clock,
  TrendingUp,
  TrendingDown,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import {
  mockInvoices,
  mockJobs,
  mockCustomers,
  getJobsByType,
  getAgingReport,
} from '@/lib/mock-data';
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
  Legend,
} from 'recharts';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

export default function ReportsPage() {
  // Calculate summary stats
  const totalRevenue = mockInvoices
    .filter(inv => inv.status === 'paid')
    .reduce((sum, inv) => sum + inv.amount, 0);
  
  const pendingRevenue = mockInvoices
    .filter(inv => inv.status === 'sent')
    .reduce((sum, inv) => sum + inv.amount, 0);
  
  const completedJobs = mockJobs.filter(
    j => j.status === 'completed' || j.status === 'invoiced'
  ).length;
  
  const avgJobValue = completedJobs > 0 
    ? Math.round(totalRevenue / completedJobs) 
    : 0;

  const jobsByType = getJobsByType();
  const agingReport = getAgingReport();

  const reportCards = [
    {
      title: 'Revenue Report',
      description: 'Track revenue by period with comparisons',
      href: '/reports/revenue',
      icon: DollarSign,
      color: 'bg-green-500',
      stat: `$${totalRevenue.toLocaleString()}`,
      label: 'Total Revenue',
    },
    {
      title: 'Jobs Report',
      description: 'Jobs completed, by type, and crew performance',
      href: '/reports/jobs',
      icon: Briefcase,
      color: 'bg-blue-500',
      stat: completedJobs.toString(),
      label: 'Jobs Completed',
    },
    {
      title: 'Customer Report',
      description: 'Customer acquisition and top customers',
      href: '/reports/customers',
      icon: Users,
      color: 'bg-purple-500',
      stat: mockCustomers.length.toString(),
      label: 'Total Customers',
    },
    {
      title: 'Accounts Receivable',
      description: 'Aging report and outstanding balances',
      href: '/reports/receivables',
      icon: Clock,
      color: 'bg-orange-500',
      stat: `$${pendingRevenue.toLocaleString()}`,
      label: 'Outstanding',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Reports</h2>
        <p className="text-gray-600">Analytics and insights for your business</p>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-lg bg-green-100 p-3">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Revenue</p>
              <p className="text-xl font-bold text-gray-900">${totalRevenue.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-lg bg-blue-100 p-3">
              <Briefcase className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Avg Job Value</p>
              <p className="text-xl font-bold text-gray-900">${avgJobValue.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-lg bg-purple-100 p-3">
              <Users className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Active Customers</p>
              <p className="text-xl font-bold text-gray-900">{mockCustomers.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="rounded-lg bg-orange-100 p-3">
              <Clock className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Outstanding</p>
              <p className="text-xl font-bold text-gray-900">${pendingRevenue.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Report Cards */}
      <div className="grid gap-6 sm:grid-cols-2">
        {reportCards.map((report) => (
          <Link key={report.title} href={report.href}>
            <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="flex items-center gap-4 p-6">
                <div className={`rounded-lg p-4 ${report.color}`}>
                  <report.icon className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{report.title}</h3>
                  <p className="text-sm text-gray-600">{report.description}</p>
                  <div className="mt-2">
                    <span className="text-lg font-bold text-gray-900">{report.stat}</span>
                    <span className="ml-2 text-sm text-gray-500">{report.label}</span>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-gray-400" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Charts Overview */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Jobs by Type */}
        <Card>
          <CardHeader>
            <CardTitle>Jobs by Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={jobsByType}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {jobsByType.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Accounts Receivable Aging */}
        <Card>
          <CardHeader>
            <CardTitle>Accounts Receivable Aging</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingReport}>
                  <XAxis dataKey="bucket" />
                  <YAxis tickFormatter={(value) => `$${value}`} />
                  <Tooltip formatter={(value: number) => [`$${value.toLocaleString()}`, 'Amount']} />
                  <Bar dataKey="amount" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
