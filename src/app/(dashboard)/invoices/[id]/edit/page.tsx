'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/forms/Input';
import { Select } from '@/components/forms/Select';
import { TextArea } from '@/components/forms/TextArea';
import { DraggableLineItems, type LineItem } from '@/components/line-items/DraggableLineItems';
import { toast } from 'sonner';
import type { Product } from '@/types/database';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { format, addDays, parseISO } from 'date-fns';

const paymentTermsOptions = [
  { value: '0', label: 'Due on Receipt' },
  { value: '15', label: 'Net 15' },
  { value: '30', label: 'Net 30' },
  { value: '45', label: 'Net 45' },
  { value: '60', label: 'Net 60' },
];

export default function EditInvoicePage() {
  const router = useRouter();
  const params = useParams();
  const invoiceId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [customerId, setCustomerId] = useState('');
  const [jobId, setJobId] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('30');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [taxRate, setTaxRate] = useState(7.75);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState<number | null>(null);

  // Load invoice data
  useEffect(() => {
    const fetchInvoice = async () => {
      try {
        setLoading(true);
        const [invoiceRes, productsRes, customersRes] = await Promise.all([
          fetch(`/api/invoices/${invoiceId}`),
          fetch('/api/products?limit=2000'),
          fetch('/api/customers?limit=5000'),
        ]);

        if (invoiceRes.ok) {
          const data = await invoiceRes.json();
          const invoice = data.invoice;
          if (invoice) {
            setCustomerId(invoice.customer_id || '');
            setJobId(invoice.job_id || '');
            setIssueDate(invoice.issue_date || format(new Date(), 'yyyy-MM-dd'));
            setDueDate(invoice.due_date || '');
            setTaxRate(invoice.tax_rate || 8.75);
            setNotes(invoice.notes || '');
            setInternalNotes(invoice.internal_notes || '');
            setInvoiceNumber(invoice.invoice_number);
            
            // Load line items
            const items = invoice.items || [];
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

            // Calculate payment terms from dates
            if (invoice.issue_date && invoice.due_date) {
              const issue = parseISO(invoice.issue_date);
              const due = parseISO(invoice.due_date);
              const days = Math.round((due.getTime() - issue.getTime()) / (1000 * 60 * 60 * 24));
              const termOption = paymentTermsOptions.find(opt => parseInt(opt.value) === days);
              if (termOption) setPaymentTerms(termOption.value);
            }
          }
        }

        if (productsRes.ok) {
          const data = await productsRes.json();
          setProducts(data.products || []);
        }
        if (customersRes.ok) {
          const data = await customersRes.json();
          setCustomers(data.customers || []);
        }
      } catch (error) {
        console.error('Failed to load invoice:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchInvoice();
  }, [invoiceId]);

  // Update due date when payment terms or issue date changes
  useEffect(() => {
    if (issueDate && paymentTerms) {
      const days = parseInt(paymentTerms);
      setDueDate(format(addDays(parseISO(issueDate), days), 'yyyy-MM-dd'));
    }
  }, [paymentTerms, issueDate]);

  // Calculate totals
  const { subtotal, taxAmount, total } = useMemo(() => {
    const subtotal = lineItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const taxableAmount = lineItems
      .filter(item => item.taxable !== false)
      .reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const taxAmount = taxableAmount * (taxRate / 100);
    return { subtotal, taxAmount, total: subtotal + taxAmount };
  }, [lineItems, taxRate]);

  const customerOptions = customers.map(c => ({ value: c.id, label: c.name }));

  const handleSave = async (andSend = false) => {
    if (!customerId) {
      toast.warning('Please select a customer');
      return;
    }
    if (lineItems.length === 0 || !lineItems[0].description) {
      toast.warning('Please add at least one line item');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          job_id: jobId || null,
          issue_date: issueDate,
          due_date: dueDate,
          tax_rate: taxRate,
          notes,
          internal_notes: internalNotes,
          items: lineItems.map((item, idx) => ({
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            item_type: item.item_type,
            sort_order: idx,
          })),
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save invoice');
      }

      if (andSend) {
        // Send the invoice
        await fetch(`/api/invoices/${invoiceId}/send`, { method: 'POST' });
      }

      router.push(`/invoices/${invoiceId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save invoice');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Loading invoice...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/invoices/${invoiceId}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Edit Invoice #{invoiceNumber}</h1>
            <p className="text-muted-foreground">Make changes to this invoice</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push(`/invoices/${invoiceId}`)}>
            Cancel
          </Button>
          <Button onClick={() => handleSave(false)} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Changes
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer & Dates */}
          <Card>
            <CardHeader>
              <CardTitle>Invoice Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                label="Customer"
                value={customerId}
                onChange={setCustomerId}
                options={customerOptions}
                required
              />
              <div className="grid grid-cols-3 gap-4">
                <Input
                  label="Issue Date"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
                <Select
                  label="Payment Terms"
                  value={paymentTerms}
                  onChange={setPaymentTerms}
                  options={paymentTermsOptions}
                />
                <Input
                  label="Due Date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <Input
                label="Tax Rate (%)"
                type="number"
                step="0.01"
                value={taxRate}
                onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
              />
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <CardTitle>Line Items</CardTitle>
            </CardHeader>
            <CardContent>
              <DraggableLineItems
                items={lineItems}
                onChange={setLineItems}
                products={products}
              />
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
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes visible to the customer on the invoice..."
                rows={3}
              />
              <TextArea
                label="Internal Notes"
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Internal notes (not visible to customer)..."
                rows={3}
              />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Totals */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Invoice Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax ({taxRate}%)</span>
                <span>${taxAmount.toFixed(2)}</span>
              </div>
              <div className="border-t pt-3">
                <div className="flex justify-between font-semibold text-lg">
                  <span>Total</span>
                  <span className="text-[#1f3b4d]">${total.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-2">
              <Button 
                className="w-full" 
                onClick={() => handleSave(false)}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => router.push(`/invoices/${invoiceId}`)}
              >
                Cancel
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
