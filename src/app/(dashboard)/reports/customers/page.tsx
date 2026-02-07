'use client';


import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { 
  Users, 
  TrendingUp, 
  DollarSign,
  Star,
  Loader2,
} from 'lucide-react';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts';

export default function CustomersReportPage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch data from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [customersRes, invoicesRes, jobsRes] = await Promise.all([
          fetch('/api/customers?limit=500'),
          fetch('/api/invoices?limit=1000'),
          fetch('/api/jobs?limit=1000'),
        ]);
        if (customersRes.ok) {
          const data = await customersRes.json();
          setCustomers(data.customers || []);
        }
        if (invoicesRes.ok) {
          const data = await invoicesRes.json();
          setInvoices(data.invoices || []);
        }
        if (jobsRes.ok) {
          const data = await jobsRes.json();
          setJobs(data.jobs || []);
        }
      } catch (err) {
        console.error('Failed to fetch report data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Calculate stats
  const totalCustomers = customers.length;
  
  // Total revenue per customer
  const customerRevenue = customers.map(customer => {
    const revenue = invoices
      .filter(inv => inv.customer_id === customer.id && inv.status === 'paid')
      .reduce((sum, inv) => sum + (inv.amount || inv.total || 0), 0);
    const customerJobs = jobs.filter(j => j.property?.customer?.id === customer.id);
    return {
      ...customer,
      revenue,
      jobCount: customerJobs.length,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  const topCustomers = customerRevenue.slice(0, 5);

  // Customers by month (acquisition)
  const customersByMonth = Array.from({ length: 6 }, (_, i) => {
    const month = subMonths(new Date(), 5 - i);
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    const newCustomers = customers.filter(c => {
      const createdDate = new Date(c.created_at);
      return createdDate >= monthStart && createdDate <= monthEnd;
    }).length;
    
    return {
      month: format(month, 'MMM'),
      customers: newCustomers,
    };
  });

  // Average revenue per customer
  const totalRevenue = invoices
    .filter(inv => inv.status === 'paid')
    .reduce((sum, inv) => sum + (inv.amount || inv.total || 0), 0);
  const avgRevenue = totalCustomers > 0 ? Math.round(totalRevenue / totalCustomers) : 0;

  // Customers with most jobs
  const customersByJobs = [...customerRevenue].sort((a, b) => b.jobCount - a.jobCount).slice(0, 5);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Reports', href: '/reports' },
          { label: 'Customers' },
        ]}
      />

      <div>
        <h2 className="text-2xl font-bold text-gray-900">Customer Report</h2>
        <p className="text-gray-600">Customer acquisition and value analysis</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-100 p-2">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Customers</p>
                <p className="text-xl font-bold text-gray-900">{totalCustomers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-100 p-2">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Revenue</p>
                <p className="text-xl font-bold text-gray-900">${totalRevenue.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-100 p-2">
                <TrendingUp className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Avg Revenue/Customer</p>
                <p className="text-xl font-bold text-gray-900">${avgRevenue.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-orange-100 p-2">
                <Star className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Top Customer</p>
                <p className="text-xl font-bold text-gray-900 truncate">
                  {topCustomers[0]?.name || 'N/A'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Customers by Revenue */}
        <Card>
          <CardHeader>
            <CardTitle>Top Customers by Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCustomers} layout="vertical">
                  <XAxis type="number" tickFormatter={(value) => `$${value}`} />
                  <YAxis type="category" dataKey="name" width={120} className="text-xs" />
                  <Tooltip formatter={(value: number) => [`$${value.toLocaleString()}`, 'Revenue']} />
                  <Bar dataKey="revenue" fill="#10B981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Customer Acquisition */}
        <Card>
          <CardHeader>
            <CardTitle>Customer Acquisition (6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={customersByMonth}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200" />
                  <XAxis dataKey="month" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Line 
                    type="monotone" 
                    dataKey="customers" 
                    stroke="#3B82F6" 
                    strokeWidth={2}
                    dot={{ fill: '#3B82F6' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Customer Tables */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* All Customers by Revenue */}
        <Card>
          <CardHeader>
            <CardTitle>Customers by Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Customer</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Revenue</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Jobs</th>
                  </tr>
                </thead>
                <tbody>
                  {customerRevenue.slice(0, 10).map((customer) => (
                    <tr key={customer.id} className="border-b border-gray-100">
                      <td className="px-4 py-3 font-medium text-gray-900">{customer.name}</td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        ${customer.revenue.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{customer.jobCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Most Active Customers */}
        <Card>
          <CardHeader>
            <CardTitle>Most Active Customers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Customer</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Jobs</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {customersByJobs.map((customer) => (
                    <tr key={customer.id} className="border-b border-gray-100">
                      <td className="px-4 py-3 font-medium text-gray-900">{customer.name}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{customer.jobCount}</td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        ${customer.revenue.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
