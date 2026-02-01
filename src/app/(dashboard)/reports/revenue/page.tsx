'use client';


import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Button } from '@/components/forms/Button';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown,
  Calendar,
} from 'lucide-react';
import { mockInvoices, getCustomerById } from '@/lib/mock-data';
import { format, subDays, subMonths, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts';

type Period = '7d' | '30d' | '90d' | '12m';

export default function RevenueReportPage() {
  const [period, setPeriod] = useState<Period>('30d');

  // Generate date range based on period
  const getDateRange = () => {
    const end = new Date();
    let start: Date;
    
    switch (period) {
      case '7d':
        start = subDays(end, 7);
        break;
      case '30d':
        start = subDays(end, 30);
        break;
      case '90d':
        start = subDays(end, 90);
        break;
      case '12m':
        start = subMonths(end, 12);
        break;
    }
    
    return { start, end };
  };

  const { start, end } = getDateRange();

  // Calculate revenue data
  const paidInvoices = mockInvoices.filter(inv => inv.status === 'paid' && inv.paid_at);
  const totalRevenue = paidInvoices.reduce((sum, inv) => sum + inv.amount, 0);
  const avgInvoice = paidInvoices.length > 0 ? Math.round(totalRevenue / paidInvoices.length) : 0;
  
  // Generate chart data
  const days = eachDayOfInterval({ start, end });
  const chartData = days.map(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayRevenue = paidInvoices
      .filter(inv => inv.paid_at?.startsWith(dateStr))
      .reduce((sum, inv) => sum + inv.amount, 0);
    
    return {
      date: format(day, period === '12m' ? 'MMM' : 'MMM d'),
      revenue: dayRevenue,
    };
  });

  // Aggregate for longer periods
  const aggregatedData = period === '12m' 
    ? Array.from({ length: 12 }, (_, i) => {
        const month = subMonths(end, 11 - i);
        const monthStart = startOfMonth(month);
        const monthEnd = endOfMonth(month);
        const monthRevenue = paidInvoices
          .filter(inv => {
            if (!inv.paid_at) return false;
            const paidDate = new Date(inv.paid_at);
            return paidDate >= monthStart && paidDate <= monthEnd;
          })
          .reduce((sum, inv) => sum + inv.amount, 0);
        
        return {
          date: format(month, 'MMM yyyy'),
          revenue: monthRevenue,
        };
      })
    : chartData;

  // Recent paid invoices
  const recentPaid = [...paidInvoices]
    .sort((a, b) => new Date(b.paid_at!).getTime() - new Date(a.paid_at!).getTime())
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Reports', href: '/reports' },
          { label: 'Revenue' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Revenue Report</h2>
          <p className="text-gray-600">Track revenue trends and patterns</p>
        </div>
        <div className="flex gap-2">
          {(['7d', '30d', '90d', '12m'] as Period[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setPeriod(p)}
            >
              {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : p === '90d' ? '90 Days' : '12 Months'}
            </Button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
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
              <div className="rounded-lg bg-blue-100 p-2">
                <TrendingUp className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Avg Invoice</p>
                <p className="text-xl font-bold text-gray-900">${avgInvoice.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-100 p-2">
                <Calendar className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Invoices Paid</p>
                <p className="text-xl font-bold text-gray-900">{paidInvoices.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-orange-100 p-2">
                <TrendingUp className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Largest Invoice</p>
                <p className="text-xl font-bold text-gray-900">
                  ${Math.max(...paidInvoices.map(i => i.amount), 0).toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aggregatedData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis tickFormatter={(value) => `$${value}`} className="text-xs" />
                <Tooltip 
                  formatter={(value: number) => [`$${value.toLocaleString()}`, 'Revenue']}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
                <Bar dataKey="revenue" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Recent Payments */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Payments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Invoice</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Customer</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Amount</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Paid Date</th>
                </tr>
              </thead>
              <tbody>
                {recentPaid.map((invoice) => {
                  const customer = getCustomerById(invoice.customer_id);
                  return (
                    <tr key={invoice.id} className="border-b border-gray-100">
                      <td className="px-4 py-3 font-medium text-gray-900">{invoice.invoice_number}</td>
                      <td className="px-4 py-3 text-gray-600">{customer?.name || 'Unknown'}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">${invoice.amount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {invoice.paid_at ? format(new Date(invoice.paid_at), 'MMM d, yyyy') : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
