'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/feedback/Toaster';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableEmpty } from '@/components/ui/table';
import { InvoiceStatusBadge } from '@/components/ui/badge';
import { Search, Plus, MoreHorizontal, Eye, Edit, Send, DollarSign, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';

interface Invoice {
  id: string;
  invoice_number: number;
  customer_id: string;
  customer?: {
    id: string;
    name: string;
    email: string;
    phone: string;
  };
  job_id?: string;
  status: 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'void';
  issue_date: string;
  due_date?: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  created_at: string;
  items?: any[];
}

const statusFilters = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Unpaid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
];

export default function InvoicesPage() {
  const toast = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [totalCount, setTotalCount] = useState(0);

  const fetchInvoices = useCallback(async (withCounts = false) => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.set('status', statusFilter === 'sent' ? 'sent' : statusFilter);
      }
      params.set('limit', '500');
      if (withCounts) {
        params.set('counts', 'true');
      }

      const response = await fetch(`/api/invoices?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch invoices');
      }

      const data = await response.json();
      setInvoices(data.invoices || []);
      setTotalCount(data.total || 0);
      if (data.counts) {
        setStatusCounts(data.counts);
      }
    } catch (err) {
      console.error('Error fetching invoices:', err);
      setError(err instanceof Error ? err.message : 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  // Initial fetch with counts
  useEffect(() => {
    fetchInvoices(true);
  }, []);

  // Refetch when filter changes (without counts)
  useEffect(() => {
    if (Object.keys(statusCounts).length > 0) {
      fetchInvoices(false);
    }
  }, [statusFilter]);

  const handleSendInvoice = async (invoiceId: string) => {
    try {
      setSendingId(invoiceId);
      const response = await fetch(`/api/invoices/${invoiceId}/send`, { method: 'POST' });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send invoice');
      }
      // Refresh the list
      fetchInvoices();
      setOpenMenu(null);
      toast.success('Invoice sent', 'Invoice has been sent to the customer');
    } catch (err) {
      toast.error('Failed to send', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setSendingId(null);
    }
  };

  // Calculate aging summary
  const agingSummary = {
    current: 0,
    days30: 0,
    days60: 0,
    days90Plus: 0,
  };

  invoices.forEach((invoice) => {
    if (invoice.status === 'paid' || invoice.status === 'void') return;
    const amountDue = invoice.total - invoice.amount_paid;
    if (amountDue <= 0) return;

    if (!invoice.due_date) {
      agingSummary.current += amountDue;
      return;
    }

    const daysOverdue = differenceInDays(new Date(), new Date(invoice.due_date));
    if (daysOverdue <= 0) {
      agingSummary.current += amountDue;
    } else if (daysOverdue <= 30) {
      agingSummary.days30 += amountDue;
    } else if (daysOverdue <= 60) {
      agingSummary.days60 += amountDue;
    } else {
      agingSummary.days90Plus += amountDue;
    }
  });

  const filteredInvoices = invoices.filter((invoice) => {
    const customerName = invoice.customer?.name || '';
    const matchesSearch = 
      customerName.toLowerCase().includes(search.toLowerCase()) ||
      invoice.invoice_number.toString().includes(search);
    
    let matchesStatus = true;
    if (statusFilter === 'sent') {
      matchesStatus = invoice.status === 'sent' || invoice.status === 'viewed';
    } else if (statusFilter !== 'all') {
      matchesStatus = invoice.status === statusFilter;
    }
    
    return matchesSearch && matchesStatus;
  });

  const sortedInvoices = [...filteredInvoices].sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const getAmountDue = (invoice: Invoice) => {
    return invoice.total - invoice.amount_paid;
  };

  const getDaysOverdue = (invoice: Invoice) => {
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
          <p className="text-gray-600">{Object.values(statusCounts).reduce((a, b) => a + b, 0) || invoices.length} total invoices</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchInvoices} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button href="/invoices/new">
            <Plus className="h-4 w-4" />
            New Invoice
          </Button>
        </div>
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

      {/* Error State */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4">
            <p className="text-red-600">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchInvoices} className="mt-2">
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400 mx-auto" />
            <p className="text-gray-500 mt-2">Loading invoices...</p>
          </CardContent>
        </Card>
      )}

      {/* Invoices Table */}
      {!loading && (
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
                <TableEmpty message={invoices.length === 0 ? "No invoices yet. Create your first invoice!" : "No invoices match your search"} />
              ) : (
                sortedInvoices.map((invoice) => {
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
                        <span className="font-medium text-gray-900">{invoice.customer?.name || 'Unknown'}</span>
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
                                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    onClick={() => handleSendInvoice(invoice.id)}
                                    disabled={sendingId === invoice.id}
                                  >
                                    {sendingId === invoice.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Send className="h-4 w-4" />
                                    )}
                                    Send Invoice
                                  </button>
                                )}
                                {invoice.status !== 'paid' && invoice.status !== 'void' && (
                                  <Link
                                    href={`/invoices/${invoice.id}?action=payment`}
                                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                    onClick={() => setOpenMenu(null)}
                                  >
                                    <DollarSign className="h-4 w-4" />
                                    Record Payment
                                  </Link>
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
      )}
    </div>
  );
}
