'use client';


import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/forms/Button';
import { 
  Clock, 
  DollarSign, 
  AlertTriangle,
  FileText,
  Mail,
} from 'lucide-react';
import { mockInvoices, getCustomerById, getAgingReport } from '@/lib/mock-data';
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
  const agingReport = getAgingReport();
  
  // Calculate totals
  const totalOutstanding = agingReport.reduce((sum, bucket) => sum + bucket.amount, 0);
  const overdueAmount = agingReport
    .filter(b => b.bucket !== 'Current')
    .reduce((sum, bucket) => sum + bucket.amount, 0);
  
  const overdueInvoices = mockInvoices.filter(inv => {
    if (inv.status !== 'sent' || !inv.due_date) return false;
    return new Date(inv.due_date) < new Date();
  });

  const pendingInvoices = mockInvoices.filter(inv => inv.status === 'sent');

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
                  const customer = getCustomerById(invoice.customer_id);
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
                        ${invoice.amount.toLocaleString()}
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
