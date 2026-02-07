'use client';


import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/forms/Button';
import { 
  Clock, 
  DollarSign, 
  AlertTriangle,
  FileText,
  Mail,
  Loader2,
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const COLORS = ['#10B981', '#F59E0B', '#F97316', '#EF4444'];

export default function ReceivablesReportPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch invoices from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/invoices?limit=1000');
        if (res.ok) {
          const data = await res.json();
          setInvoices(data.invoices || []);
        }
      } catch (err) {
        console.error('Failed to fetch invoices:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const pendingInvoices = invoices.filter(inv => inv.status === 'sent');
  
  const overdueInvoices = invoices.filter(inv => {
    if (inv.status !== 'sent' || !inv.due_date) return false;
    return new Date(inv.due_date) < new Date();
  });

  // Calculate aging buckets
  const agingReport = [
    { bucket: 'Current', amount: 0, count: 0 },
    { bucket: '1-30 Days', amount: 0, count: 0 },
    { bucket: '31-60 Days', amount: 0, count: 0 },
    { bucket: '60+ Days', amount: 0, count: 0 },
  ];
  
  pendingInvoices.forEach(inv => {
    const daysOverdue = inv.due_date ? differenceInDays(new Date(), new Date(inv.due_date)) : 0;
    const amount = (inv.total || 0) - (inv.amount_paid || 0);
    
    if (daysOverdue <= 0) {
      agingReport[0].amount += amount;
      agingReport[0].count++;
    } else if (daysOverdue <= 30) {
      agingReport[1].amount += amount;
      agingReport[1].count++;
    } else if (daysOverdue <= 60) {
      agingReport[2].amount += amount;
      agingReport[2].count++;
    } else {
      agingReport[3].amount += amount;
      agingReport[3].count++;
    }
  });
  
  // Calculate totals
  const totalOutstanding = agingReport.reduce((sum, bucket) => sum + bucket.amount, 0);
  const overdueAmount = agingReport
    .filter(b => b.bucket !== 'Current')
    .reduce((sum, bucket) => sum + bucket.amount, 0);

  // Pie chart data
  const pieData = agingReport.map((bucket, index) => ({
    name: bucket.bucket,
    value: bucket.amount,
    color: COLORS[index],
  })).filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Reports', href: '/reports' },
          { label: 'Accounts Receivable' },
        ]}
      />

      <div>
        <h2 className="text-2xl font-bold text-gray-900">Accounts Receivable</h2>
        <p className="text-gray-600">Outstanding invoices and aging analysis</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-100 p-2">
                <DollarSign className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Outstanding</p>
                <p className="text-xl font-bold text-gray-900">${totalOutstanding.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-red-100 p-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Overdue Amount</p>
                <p className="text-xl font-bold text-red-600">${overdueAmount.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-yellow-100 p-2">
                <FileText className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Pending Invoices</p>
                <p className="text-xl font-bold text-gray-900">{pendingInvoices.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-orange-100 p-2">
                <Clock className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Overdue Invoices</p>
                <p className="text-xl font-bold text-gray-900">{overdueInvoices.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Aging Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Aging Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingReport}>
                  <XAxis dataKey="bucket" />
                  <YAxis tickFormatter={(value) => `$${value}`} />
                  <Tooltip 
                    formatter={(value: number) => [`$${value.toLocaleString()}`, 'Amount']}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                  />
                  <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                    {agingReport.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Aging Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Aging Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    outerRadius={80}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [`$${value.toLocaleString()}`, 'Amount']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Aging Buckets Detail */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {agingReport.map((bucket, index) => (
          <Card key={bucket.bucket}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">{bucket.bucket}</span>
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: COLORS[index] }}
                />
              </div>
              <p className="text-2xl font-bold text-gray-900">
                ${bucket.amount.toLocaleString()}
              </p>
              <p className="text-sm text-gray-500">
                {bucket.invoices.length} invoice{bucket.invoices.length !== 1 ? 's' : ''}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Outstanding Invoices Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Outstanding Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Invoice</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Customer</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Amount</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Due Date</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingInvoices.map((invoice) => {
                  // Customer comes from API join
                  const customer = invoice.customer;
                  const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
                  const isOverdue = dueDate && dueDate < new Date();
                  const daysOverdue = dueDate ? differenceInDays(new Date(), dueDate) : 0;

                  return (
                    <tr key={invoice.id} className="border-b border-gray-100">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {invoice.invoice_number}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {customer?.name || 'Unknown'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        ${(invoice.total || invoice.amount || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {dueDate ? format(dueDate, 'MMM d, yyyy') : '-'}
                      </td>
                      <td className="px-4 py-3">
                        {isOverdue ? (
                          <Badge variant="danger">
                            {daysOverdue} days overdue
                          </Badge>
                        ) : (
                          <Badge variant="warning">Pending</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm">
                          <Mail className="h-4 w-4 mr-1" />
                          Remind
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {pendingInvoices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No outstanding invoices
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
