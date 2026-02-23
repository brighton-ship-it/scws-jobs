'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/feedback/Toaster';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableEmpty } from '@/components/ui/table';
import { QuoteStatusBadge } from '@/components/ui/badge';
import { Search, Plus, MoreHorizontal, Eye, Edit, Copy, Send, FileText, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

interface Quote {
  id: string;
  quote_number: number;
  customer_id: string;
  property_id: string | null;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
  valid_until: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  notes: string | null;
  internal_notes: string | null;
  created_at: string;
  customer?: { id: string; name: string; email: string; phone: string };
  property?: { id: string; address: string; city: string };
  items?: any[];
}

const statusFilters = [
  { value: 'all', label: 'All Quotes' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'expired', label: 'Expired' },
];

export default function QuotesPage() {
  const toast = useToast();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch quotes from API
  const fetchQuotes = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/quotes?limit=100');
      if (res.ok) {
        const data = await res.json();
        setQuotes(data.quotes || []);
      }
    } catch (error) {
      console.error('Failed to fetch quotes:', error);
    } finally {
      setLoading(false);
    }
  };

  // Send quote via email
  const handleSendQuote = async (quoteId: string) => {
    setActionLoading(quoteId);
    try {
      const res = await fetch(`/api/quotes/${quoteId}/send`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success('Quote sent', data.message || 'Quote has been emailed to the customer');
        fetchQuotes(); // Refresh list
      } else {
        toast.error('Failed to send', data.error || 'Please try again');
      }
    } catch (error) {
      toast.error('Failed to send', 'Please check your connection and try again');
    } finally {
      setActionLoading(null);
      setOpenMenu(null);
    }
  };

  // Convert accepted quote to job
  const handleConvertToJob = (quoteId: string) => {
    window.location.href = `/jobs/new?from_quote=${quoteId}`;
  };

  // Duplicate a quote
  const handleDuplicate = async (quoteId: string) => {
    setActionLoading(quoteId);
    try {
      // Fetch the quote to duplicate
      const res = await fetch(`/api/quotes/${quoteId}`);
      if (!res.ok) throw new Error('Failed to fetch quote');
      const { quote } = await res.json();
      
      // Create new quote with same data
      const newQuoteRes = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: quote.customer_id,
          property_id: quote.property_id,
          valid_until: null, // Reset validity
          notes: quote.notes,
          tax_rate: quote.tax_rate,
          items: (quote.items || []).map((item: any) => ({
            description: item.description,
            item_description: item.item_description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            taxable: item.taxable,
            type: item.type,
          })),
        }),
      });
      
      if (newQuoteRes.ok) {
        const { quote: newQuote } = await newQuoteRes.json();
        window.location.href = `/quotes/${newQuote.id}`;
      } else {
        const data = await newQuoteRes.json();
        toast.error('Failed to duplicate', data.error || 'Please try again');
      }
    } catch (error) {
      toast.error('Failed to duplicate', 'Please check your connection and try again');
    } finally {
      setActionLoading(null);
      setOpenMenu(null);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchQuotes();
  }, []);

  const filteredQuotes = quotes.filter((quote) => {
    const customerName = quote.customer?.name || '';
    const matchesSearch = customerName.toLowerCase().includes(search.toLowerCase()) ||
      quote.quote_number.toString().includes(search);
    const matchesStatus = statusFilter === 'all' || quote.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Sort by date descending
  const sortedQuotes = [...filteredQuotes].sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Quotes</h2>
          <p className="text-gray-600">{loading ? 'Loading...' : `${quotes.length} total quotes`}</p>
        </div>
        <Button href="/quotes/new">
          <Plus className="h-4 w-4" />
          New Quote
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Draft', value: quotes.filter(q => q.status === 'draft').length, color: 'text-gray-600' },
          { label: 'Sent', value: quotes.filter(q => q.status === 'sent').length, color: 'text-blue-600' },
          { label: 'Accepted', value: quotes.filter(q => q.status === 'accepted').length, color: 'text-green-600' },
          { label: 'Declined', value: quotes.filter(q => q.status === 'declined').length, color: 'text-red-600' },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="py-4">
              <p className="text-sm text-gray-500">{stat.label}</p>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by customer or quote number..."
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

      {/* Quotes Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableCell header>Quote #</TableCell>
              <TableCell header>Customer</TableCell>
              <TableCell header>Property</TableCell>
              <TableCell header>Total</TableCell>
              <TableCell header>Status</TableCell>
              <TableCell header>Valid Until</TableCell>
              <TableCell header>Created</TableCell>
              <TableCell header></TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                  Loading quotes...
                </TableCell>
              </TableRow>
            ) : sortedQuotes.length === 0 ? (
              <TableEmpty message="No quotes found" />
            ) : (
              sortedQuotes.map((quote) => {
                return (
                  <TableRow key={quote.id}>
                    <TableCell>
                      <Link
                        href={`/quotes/${quote.id}`}
                        className="font-medium text-blue-600 hover:text-blue-800"
                      >
                        #{quote.quote_number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-gray-900">{quote.customer?.name || 'Unknown'}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-500 text-sm">
                        {quote.property ? `${quote.property.address}, ${quote.property.city}` : '-'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{formatCurrency(quote.total)}</span>
                    </TableCell>
                    <TableCell>
                      <QuoteStatusBadge status={quote.status} />
                    </TableCell>
                    <TableCell>
                      {quote.valid_until ? (
                        <span className={`text-sm ${new Date(quote.valid_until) < new Date() ? 'text-red-600' : 'text-gray-500'}`}>
                          {format(new Date(quote.valid_until), 'MMM d, yyyy')}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-500 text-sm">
                        {format(new Date(quote.created_at), 'MMM d, yyyy')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="relative">
                        <button 
                          onClick={() => setOpenMenu(openMenu === quote.id ? null : quote.id)}
                          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {openMenu === quote.id && (
                          <>
                            <div 
                              className="fixed inset-0 z-10" 
                              onClick={() => setOpenMenu(null)}
                            />
                            <div className="absolute right-0 top-8 z-20 w-48 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
                              <Link
                                href={`/quotes/${quote.id}`}
                                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                onClick={() => setOpenMenu(null)}
                              >
                                <Eye className="h-4 w-4" />
                                View Quote
                              </Link>
                              <Link
                                href={`/quotes/${quote.id}/edit`}
                                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                onClick={() => setOpenMenu(null)}
                              >
                                <Edit className="h-4 w-4" />
                                Edit Quote
                              </Link>
                              {quote.status === 'draft' && (
                                <button
                                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                  disabled={actionLoading === quote.id}
                                  onClick={() => handleSendQuote(quote.id)}
                                >
                                  <Send className="h-4 w-4" />
                                  {actionLoading === quote.id ? 'Sending...' : 'Send Quote'}
                                </button>
                              )}
                              {quote.status === 'accepted' && (
                                <button
                                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                  onClick={() => handleConvertToJob(quote.id)}
                                >
                                  <FileText className="h-4 w-4" />
                                  Convert to Job
                                </button>
                              )}
                              <button
                                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                disabled={actionLoading === quote.id}
                                onClick={() => handleDuplicate(quote.id)}
                              >
                                <Copy className="h-4 w-4" />
                                {actionLoading === quote.id ? 'Duplicating...' : 'Duplicate'}
                              </button>
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
