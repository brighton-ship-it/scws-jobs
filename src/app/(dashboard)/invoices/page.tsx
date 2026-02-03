'use client';


import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableEmpty } from '@/components/ui/table';
import { InvoiceStatusBadge } from '@/components/ui/badge';
import { mockInvoices, getCustomerById, getInvoiceAgingSummary } from '@/lib/mock-data';
import { Search, Plus, MoreHorizontal, Eye, Edit, Send, DollarSign, AlertTriangle } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';

const statusFilters = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Unpaid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
];

export default function InvoicesPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const agingSummary = getInvoiceAgingSummary();

  const filteredInvoices = mockInvoices.filter((invoice) => {
    const customer = getCustomerById(invoice.customer_id);
    const matchesSearch = customer?.name.toLowerCase().includes(search.toLowerCase()) ||
      invoice.invoice_number.toString().includes(search);
    
    let matchesStatus = true;
    if (statusFilter === 'sent') {
      matchesStatus = invoice.status === 'sent' || invoice.status === 'viewed';
    } else if (statusFilter !== 'all') {
      matchesStatus = invoice.status === statusFilter;
    }
    
    return matchesSearch && matchesStatus;
  });

  // Sort by date descending
  const sortedInvoices = [...filteredInvoices].sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const getAmountDue = (invoice: typeof mockInvoices[0]) => {
    return invoice.total - invoice.amount_paid;
  };

  const getDaysOverdue = (invoice: typeof mockInvoices[0]) => {
    if (!invoice.due_date || invoice.status === 'paid') return 0;
    const today = new Date();
    const dueDate = new Date(invoice.due_date);
    return differenceInDays(today, dueDate);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Invoices</h2>
          <p className="text-gray-600">{mockInvoices.length} total invoices</p>
        </div>
        <Button href="/invoices/new">
          <Plus className="h-4 w-4" />
          New Invoice
        </Button>
      </div>

      {/* Aging Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">Current</p>
            <p className="text-2xl font-bold text-green-600">{formatCurrency(agingSummary.current)}</p>
            <p className="text-xs text-gray-400">Not yet due</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">1-30 Days</p>
            <p className="text-2xl font-bold text-yellow-600">{formatCurrency(agingSummary.days30)}</p>
            <p className="text-xs text-gray-400">Overdue</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">31-60 Days</p>
            <p className="text-2xl font-bold text-orange-600">{formatCurrency(agingSummary.days60)}</p>
            <p className="text-xs text-gray-400">Overdue</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">90+ Days</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(agingSummary.days90Plus)}</p>
            <p className="text-xs text-gray-400">Overdue</p>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by customer or invoice number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-10 pr-4 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {statusFilters.map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setStatusFilter(filter.value)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    statusFilter === filter.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Invoices Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableCell header>Invoice #</TableCell>
              <TableCell header>Customer</TableCell>
              <TableCell header>Amount</TableCell>
              <TableCell header>Paid</TableCell>
              <TableCell header>Balance</TableCell>
              <TableCell header>Status</TableCell>
              <TableCell header>Due Date</TableCell>
              <TableCell header></TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedInvoices.length === 0 ? (
              <TableEmpty message="No invoices found" />
            ) : (
              sortedInvoices.map((invoice) => {
                const customer = getCustomerById(invoice.customer_id);
                const amountDue = getAmountDue(invoice);
                const daysOverdue = getDaysOverdue(invoice);

                return (
                  <TableRow key={invoice.id}>
                    <TableCell>
                      <Link
                        href={`/invoices/${invoice.id}`}
                        className="font-medium text-blue-600 hover:text-blue-800"
                      >
                        #{invoice.invoice_number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-gray-900">{customer?.name || 'Unknown'}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{formatCurrency(invoice.total)}</span>
                    </TableCell>
                    <TableCell>
                      <span className={invoice.amount_paid > 0 ? 'text-green-600' : 'text-gray-400'}>
                        {formatCurrency(invoice.amount_paid)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`font-medium ${amountDue > 0 ? 'text-gray-900' : 'text-green-600'}`}>
                        {formatCurrency(amountDue)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <InvoiceStatusBadge status={invoice.status} />
                        {daysOverdue > 0 && invoice.status !== 'paid' && (
                          <span className="text-xs text-red-600 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {daysOverdue}d
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {invoice.due_date ? (
                        <span className={`text-sm ${
                          daysOverdue > 0 && invoice.status !== 'paid' ? 'text-red-600 font-medium' : 'text-gray-500'
                        }`}>
                          {format(new Date(invoice.due_date), 'MMM d, yyyy')}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="relative">
                        <button 
                          onClick={() => setOpenMenu(openMenu === invoice.id ? null : invoice.id)}
                          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {openMenu === invoice.id && (
                          <>
                            <div 
                              className="fixed inset-0 z-10" 
                              onClick={() => setOpenMenu(null)}
                            />
                            <div className="absolute right-0 top-8 z-20 w-48 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
                              <Link
                                href={`/invoices/${invoice.id}`}
                                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                onClick={() => setOpenMenu(null)}
                              >
                                <Eye className="h-4 w-4" />
                                View Invoice
                              </Link>
                              {invoice.status === 'draft' && (
                                <Link
                                  href={`/invoices/${invoice.id}/edit`}
                                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                  onClick={() => setOpenMenu(null)}
                                >
                                  <Edit className="h-4 w-4" />
                                  Edit Invoice
                                </Link>
                              )}
                              {invoice.status === 'draft' && (
                                <button
                                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                  onClick={() => setOpenMenu(null)}
                                >
                                  <Send className="h-4 w-4" />
                                  Send Invoice
                                </button>
                              )}
                              {invoice.status !== 'paid' && invoice.status !== 'void' && (
                                <button
                                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                  onClick={() => setOpenMenu(null)}
                                >
                                  <DollarSign className="h-4 w-4" />
                                  Record Payment
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
