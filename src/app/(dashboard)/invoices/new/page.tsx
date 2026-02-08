'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/forms/Input';
import { Select } from '@/components/forms/Select';
import { TextArea } from '@/components/forms/TextArea';
import { DraggableLineItems, type LineItem } from '@/components/line-items/DraggableLineItems';
// Removed mock-data imports - using real API
import type { Product } from '@/types/database';
import { ArrowLeft, Briefcase } from 'lucide-react';
import { format, addDays } from 'date-fns';

const paymentTermsOptions = [
  { value: '0', label: 'Due on Receipt' },
  { value: '15', label: 'Net 15' },
  { value: '30', label: 'Net 30' },
  { value: '45', label: 'Net 45' },
  { value: '60', label: 'Net 60' },
];

export default function NewInvoicePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromQuoteId = searchParams.get('from_quote');
  const fromJobId = searchParams.get('job_id');

  const [customerId, setCustomerId] = useState('');
  const [jobId, setJobId] = useState('');
  const [quoteId, setQuoteId] = useState('');
  const [issueDate, setIssueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [paymentTerms, setPaymentTerms] = useState('30');
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [taxRate, setTaxRate] = useState(8.75);
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: '1', description: '', item_description: null, quantity: 1, unit_price: 0, total: 0, item_type: null, taxable: true, sort_order: 0 }
  ]);
  const [showJobSelector, setShowJobSelector] = useState(false);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [allJobs, setAllJobs] = useState<any[]>([]);

  // Fetch products, customers, and jobs from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [productsRes, customersRes, jobsRes] = await Promise.all([
          fetch('/api/products?limit=2000'),
          fetch('/api/customers?limit=5000'),
          fetch('/api/jobs?status=completed&limit=1000'),
        ]);
        
        if (productsRes.ok) {
          const data = await productsRes.json();
          setProducts(data.products || []);
        }
        if (customersRes.ok) {
          const data = await customersRes.json();
          setCustomers(data.customers || []);
        }
        if (jobsRes.ok) {
          const data = await jobsRes.json();
          setAllJobs(data.jobs || []);
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
      }
    };
    fetchData();
  }, []);

  // Filter jobs for selected customer (or show all if no customer selected)
  const customerJobs = customerId 
    ? allJobs.filter(j => j.property?.customer?.id === customerId)
    : allJobs;

  // Load from quote if specified
  useEffect(() => {
    if (fromQuoteId) {
      const loadFromQuote = async () => {
        try {
          const res = await fetch(`/api/quotes/${fromQuoteId}`);
          if (res.ok) {
            const data = await res.json();
            const quote = data.quote;
            if (quote) {
              setCustomerId(quote.customer_id);
              setQuoteId(fromQuoteId);
              setTaxRate(quote.tax_rate || 8.75);
              setNotes(quote.notes || '');
              const items = quote.items || [];
              setLineItems(items.map((item: any, idx: number) => ({
                id: item.id,
                description: item.description,
                item_description: item.item_description || null,
                quantity: item.quantity,
                unit_price: item.unit_price,
                total: item.total,
                item_type: item.item_type,
                taxable: item.taxable !== false,
                sort_order: idx,
              })));
            }
          }
        } catch (err) {
          console.error('Failed to load quote:', err);
        }
      };
      loadFromQuote();
    }
  }, [fromQuoteId]);

  // Load from job if specified
  useEffect(() => {
    if (fromJobId) {
      const loadFromJob = async () => {
        try {
          const res = await fetch(`/api/jobs/${fromJobId}`);
          if (res.ok) {
            const data = await res.json();
            const job = data.job;
            if (job) {
              // Set customer from job's property and add to dropdown if needed
              if (job.property?.customer) {
                const jobCustomer = job.property.customer;
                setCustomers(prev => {
                  if (prev.find(c => c.id === jobCustomer.id)) return prev;
                  return [...prev, jobCustomer];
                });
                setCustomerId(jobCustomer.id);
              }
              setJobId(fromJobId);
              
              // Create line items from job info
              const hours = job.estimated_duration 
                ? parseInt(job.estimated_duration.split(':')[0]) || 2 
                : 2;
              setLineItems([{
                id: '1',
                description: `${job.job_type} - Labor`,
                item_description: job.description || null,
                quantity: hours,
                unit_price: 125,
                total: hours * 125,
                item_type: 'labor',
                taxable: true,
                sort_order: 0,
              }]);
              
              if (job.internal_notes) {
                setInternalNotes(job.internal_notes);
              }
            }
          }
        } catch (error) {
          console.error('Failed to load job:', error);
        }
      };
      loadFromJob();
    }
  }, [fromJobId]);

  // Update due date when payment terms or issue date change
  useEffect(() => {
    const days = parseInt(paymentTerms);
    const issue = new Date(issueDate);
    setDueDate(format(addDays(issue, days), 'yyyy-MM-dd'));
  }, [paymentTerms, issueDate]);

  const customerOptions = customers.map(c => ({ value: c.id, label: c.name }));
  
  const jobOptions = customerJobs.map(j => ({ 
    value: j.id, 
    label: customerId 
      ? `${j.job_type} - ${format(new Date(j.scheduled_date || j.created_at), 'MMM d, yyyy')}`
      : `${j.job_type} - ${j.property?.customer?.name || 'Unknown'} - ${format(new Date(j.scheduled_date || j.created_at), 'MMM d, yyyy')}`
  }));

  const activeProducts = products.filter(p => p.active);

  // Calculate totals
  const subtotal = useMemo(() => 
    lineItems.reduce((sum, item) => sum + item.total, 0), 
    [lineItems]
  );
  // Only apply tax to taxable items
  const taxableSubtotal = useMemo(() =>
    lineItems.filter(item => item.taxable).reduce((sum, item) => sum + item.total, 0),
    [lineItems]
  );
  const taxAmount = useMemo(() => taxableSubtotal * (taxRate / 100), [taxableSubtotal, taxRate]);
  const total = useMemo(() => subtotal + taxAmount, [subtotal, taxAmount]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const importFromJob = (selectedJobId: string) => {
    setJobId(selectedJobId);
    const job = allJobs.find(j => j.id === selectedJobId);
    if (job) {
      // Auto-fill customer from job
      if (job.property?.customer) {
        const jobCustomer = job.property.customer;
        // Add customer to list if not already there
        if (!customers.find(c => c.id === jobCustomer.id)) {
          setCustomers(prev => [...prev, jobCustomer]);
        }
        setCustomerId(jobCustomer.id);
      }
      
      const hours = job.estimated_duration 
        ? parseInt(job.estimated_duration.split(':')[0]) || 2 
        : 2;
      const newItems: LineItem[] = [
        {
          id: Date.now().toString(),
          description: `${job.job_type} - Labor`,
          item_description: job.description || null,
          quantity: hours,
          unit_price: 125,
          total: hours * 125,
          item_type: 'labor',
          taxable: true,
          sort_order: 0,
        },
        {
          id: (Date.now() + 1).toString(),
          description: 'Service Call',
          item_description: null,
          quantity: 1,
          unit_price: 95,
          total: 95,
          item_type: 'service',
          taxable: true,
          sort_order: 1,
        },
      ];
      setLineItems(newItems);
    }
    setShowJobSelector(false);
  };

  const handleSubmit = async (asDraft: boolean = true) => {
    if (!customerId) {
      alert('Please select a customer');
      return;
    }

    if (lineItems.length === 0 || lineItems.every(item => !item.description)) {
      alert('Please add at least one line item');
      return;
    }

    setSaving(true);
    
    try {
      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          job_id: jobId || null,
          quote_id: quoteId || null,
          issue_date: issueDate,
          due_date: dueDate,
          tax_rate: taxRate,
          notes,
          internal_notes: internalNotes,
          status: asDraft ? 'draft' : 'sent',
          items: lineItems.filter(item => item.description).map(item => ({
            description: item.description,
            item_description: item.item_description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            item_type: item.item_type,
            taxable: item.taxable,
          })),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create invoice');
      }

      const { invoice } = await response.json();
      
      // If not draft, send the invoice email
      if (!asDraft && invoice?.id) {
        await fetch(`/api/invoices/${invoice.id}/send`, { method: 'POST' });
      }

      router.push('/invoices');
    } catch (error) {
      console.error('Error creating invoice:', error);
      alert(error instanceof Error ? error.message : 'Failed to create invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/invoices" className="p-2 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">New Invoice</h2>
            <p className="text-gray-600">
              {fromQuoteId ? 'Creating from Quote' : 'Create a new invoice'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={() => setShowJobSelector(true)}
            disabled={!customerId}
          >
            <Briefcase className="h-4 w-4" />
            Import from Job
          </Button>
        </div>
      </div>

      {/* Customer & Dates */}
      <Card>
        <CardHeader>
          <CardTitle>Invoice Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Customer"
              options={customerOptions}
              placeholder="Select a customer"
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setJobId('');
              }}
              required
            />
            <Select
              label="Related Job"
              options={[{ value: '', label: 'None' }, ...jobOptions]}
              placeholder="Select a job (optional)"
              value={jobId}
              onChange={(e) => {
                const selectedJobId = e.target.value;
                setJobId(selectedJobId);
                // Auto-fill customer from job (always override)
                if (selectedJobId) {
                  const job = allJobs.find(j => j.id === selectedJobId);
                  if (job?.property?.customer) {
                    const jobCustomer = job.property.customer;
                    // Add customer to list if not already there
                    if (!customers.find(c => c.id === jobCustomer.id)) {
                      setCustomers(prev => [...prev, jobCustomer]);
                    }
                    setCustomerId(jobCustomer.id);
                  }
                }
              }}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="Issue Date"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
            <Select
              label="Payment Terms"
              options={paymentTermsOptions}
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
            />
            <Input
              label="Due Date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Tax Rate (%)"
              type="number"
              step="0.01"
              value={taxRate}
              onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Line Items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <DraggableLineItems
            items={lineItems}
            onChange={setLineItems}
            products={activeProducts}
          />

          {/* Totals */}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <div className="flex flex-col items-end space-y-2">
              <div className="flex justify-between w-64">
                <span className="text-gray-500">Subtotal:</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              {taxableSubtotal !== subtotal && (
                <div className="flex justify-between w-64 text-sm">
                  <span className="text-gray-400">Taxable amount:</span>
                  <span className="text-gray-500">{formatCurrency(taxableSubtotal)}</span>
                </div>
              )}
              <div className="flex justify-between w-64">
                <span className="text-gray-500">Tax ({taxRate}%):</span>
                <span className="font-medium">{formatCurrency(taxAmount)}</span>
              </div>
              <div className="flex justify-between w-64 text-lg border-t border-gray-200 pt-2">
                <span className="font-semibold">Total:</span>
                <span className="font-bold text-gray-900">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TextArea
            label="Customer Notes"
            placeholder="Notes visible to the customer on the invoice..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
          <TextArea
            label="Internal Notes"
            placeholder="Internal notes (not visible to customer)..."
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" href="/invoices">
          Cancel
        </Button>
        <Button 
          variant="secondary" 
          onClick={() => handleSubmit(true)}
          disabled={saving}
        >
          Save as Draft
        </Button>
        <Button 
          onClick={() => handleSubmit(false)}
          disabled={saving}
        >
          Save & Send
        </Button>
      </div>

      {/* Job Selector Modal */}
      {showJobSelector && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div 
            className="fixed inset-0 bg-black/50" 
            onClick={() => setShowJobSelector(false)}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold">Import from Job</h3>
                <p className="text-sm text-gray-500">Select a completed job to import line items</p>
              </div>
              <div className="p-6 max-h-96 overflow-auto">
                {customerJobs.length === 0 ? (
                  <p className="text-center text-gray-500 py-4">
                    No completed jobs found for this customer
                  </p>
                ) : (
                  <div className="space-y-2">
                    {customerJobs.map(job => {
                      // Property comes from API join
                      const property = job.property;
                      return (
                        <button
                          key={job.id}
                          onClick={() => importFromJob(job.id)}
                          className="w-full text-left p-4 rounded-lg border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-colors"
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium text-gray-900">{job.job_type}</p>
                              <p className="text-sm text-gray-500">
                                {property?.address || 'No address'}
                              </p>
                              {job.description && (
                                <p className="text-sm text-gray-400 mt-1">{job.description}</p>
                              )}
                            </div>
                            <span className="text-sm text-gray-500">
                              {format(new Date(job.completed_at || job.created_at), 'MMM d, yyyy')}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
                <Button variant="outline" onClick={() => setShowJobSelector(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
