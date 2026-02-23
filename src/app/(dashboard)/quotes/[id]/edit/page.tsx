'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/forms/Input';
import { Select } from '@/components/forms/Select';
import { TextArea } from '@/components/forms/TextArea';
import { DraggableLineItems, type LineItem } from '@/components/line-items/DraggableLineItems';
import { toast } from 'sonner';
import type { Product, Customer, Property } from '@/types/database';
import { ArrowLeft, DollarSign, Loader2 } from 'lucide-react';

interface QuoteData {
  id: string;
  quote_number: number;
  customer_id: string;
  property_id: string | null;
  status: string;
  valid_until: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  notes: string | null;
  internal_notes: string | null;
  required_deposit?: number | null;
  items: Array<{
    id: string;
    description: string;
    item_description?: string;
    quantity: number;
    unit_price: number;
    total: number;
    item_type: string | null;
    taxable?: boolean;
    sort_order?: number;
  }>;
}

interface CustomerWithProperties extends Customer {
  properties?: Property[];
}

export default function EditQuotePage() {
  const router = useRouter();
  const params = useParams();
  const quoteId = params.id as string;
  
  // Loading states
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Data
  const [quoteData, setQuoteData] = useState<QuoteData | null>(null);
  const [customers, setCustomers] = useState<CustomerWithProperties[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  
  // Form state
  const [customerId, setCustomerId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [taxRate, setTaxRate] = useState(8.75);
  const [requiredDeposit, setRequiredDeposit] = useState<string>('');
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  // Fetch all data on mount
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        // Fetch quote, customers, and products in parallel
        const [quoteRes, customersRes, productsRes] = await Promise.all([
          fetch(`/api/quotes/${quoteId}`),
          fetch('/api/customers?limit=1000'),
          fetch('/api/products?limit=2000'),
        ]);

        if (!quoteRes.ok) {
          throw new Error('Quote not found');
        }

        const [quoteJson, customersJson, productsJson] = await Promise.all([
          quoteRes.json(),
          customersRes.json(),
          productsRes.json(),
        ]);

        const quote = quoteJson.quote;
        setQuoteData(quote);
        
        // Ensure the quote's customer is in the list (they may not be in first 1000)
        let customersList = customersJson.customers || [];
        if (quote.customer_id && quote.customer) {
          const existingCustomer = customersList.find((c: Customer) => c.id === quote.customer_id);
          if (!existingCustomer) {
            // Add the quote's customer to the beginning of the list
            customersList = [
              { 
                id: quote.customer_id, 
                name: quote.customer.name,
                email: quote.customer.email,
                phone: quote.customer.phone,
                properties: quote.property ? [quote.property] : []
              },
              ...customersList
            ];
          } else if (quote.property && existingCustomer.properties) {
            // Ensure the property is in the customer's properties
            const hasProperty = existingCustomer.properties.some((p: Property) => p.id === quote.property_id);
            if (!hasProperty) {
              existingCustomer.properties = [quote.property, ...existingCustomer.properties];
            }
          }
        }
        
        setCustomers(customersList);
        setProducts(productsJson.products || []);

        // Populate form
        if (quote) {
          setCustomerId(quote.customer_id || '');
          setPropertyId(quote.property_id || '');
          setValidUntil(quote.valid_until || '');
          setNotes(quote.notes || '');
          setInternalNotes(quote.internal_notes || '');
          setTaxRate(quote.tax_rate || 8.75);
          setRequiredDeposit(quote.required_deposit ? quote.required_deposit.toFixed(2) : '');
          setLineItems((quote.items || []).map((item: any) => ({
            id: item.id,
            description: item.description,
            item_description: item.item_description || null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total: item.total,
            item_type: item.item_type,
            taxable: item.taxable !== false,
            sort_order: item.sort_order,
          })));
        }
      } catch (err) {
        console.error('Failed to fetch data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load quote');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [quoteId]);

  // Get properties for selected customer
  const selectedCustomer = customers.find(c => c.id === customerId);
  const properties = selectedCustomer?.properties || [];

  const customerOptions = customers.map(c => ({ value: c.id, label: c.name }));
  const propertyOptions = properties.map(p => ({ 
    value: p.id, 
    label: `${p.address}${p.city ? `, ${p.city}` : ''}` 
  }));

  const activeProducts = products.filter(p => p.active);

  // Calculate totals
  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const taxableSubtotal = lineItems.filter(item => item.taxable).reduce((sum, item) => sum + item.total, 0);
  const taxAmount = taxableSubtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const handleSubmit = async (asDraft: boolean = true) => {
    if (!customerId) {
      toast.warning('Please select a customer');
      return;
    }

    setSaving(true);
    
    try {
      // First update the quote itself
      const quoteRes = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          property_id: propertyId || null,
          valid_until: validUntil || null,
          notes: notes || null,
          internal_notes: internalNotes || null,
          tax_rate: taxRate,
          subtotal: subtotal,
          tax_amount: taxAmount,
          total: total,
          required_deposit: requiredDeposit ? parseFloat(requiredDeposit) : null,
          status: asDraft ? quoteData?.status : 'sent',
          sent_at: !asDraft ? new Date().toISOString() : undefined,
        }),
      });

      if (!quoteRes.ok) {
        const errorData = await quoteRes.json().catch(() => ({}));
        console.error('Quote update failed:', errorData);
        throw new Error(errorData.error || 'Failed to update quote');
      }

      // Update line items - delete existing and insert new
      const itemsRes = await fetch(`/api/quotes/${quoteId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: lineItems }),
      });

      if (!itemsRes.ok) {
        const errorData = await itemsRes.json().catch(() => ({}));
        console.error('Items update failed:', errorData);
        throw new Error(errorData.error || 'Failed to update line items');
      }

      router.push(`/quotes/${quoteId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save quote');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Loading quote...</span>
      </div>
    );
  }

  if (error || !quoteData) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Quote not found</h2>
        <p className="text-gray-500 mt-2">{error || "The quote you're looking for doesn't exist."}</p>
        <Button href="/quotes" variant="outline" className="mt-4">
          Back to Quotes
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/quotes/${quoteId}`} className="p-2 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Edit Quote #{quoteData.quote_number}</h2>
            <p className="text-gray-600">Modify the quote details</p>
          </div>
        </div>
      </div>

      {/* Customer & Property */}
      <Card>
        <CardHeader>
          <CardTitle>Customer Information</CardTitle>
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
                setPropertyId('');
              }}
              required
            />
            <Select
              label="Property"
              options={propertyOptions}
              placeholder={customerId ? "Select a property" : "Select customer first"}
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              disabled={!customerId}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Valid Until"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
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

      {/* Deposit Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-600" />
            Deposit Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Input
                label="Required Deposit ($)"
                type="number"
                step="0.01"
                min="0"
                value={requiredDeposit}
                onChange={(e) => setRequiredDeposit(e.target.value)}
                placeholder="0.00"
              />
              <p className="text-xs text-gray-500 mt-1">
                Amount customer must pay before work begins
              </p>
            </div>
            <div className="flex items-end">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 w-full">
                <p className="text-sm text-green-700">
                  <strong>Tip:</strong> A 50% deposit is common for larger jobs. 
                  {total > 0 && (
                    <span className="block mt-1">
                      50% of this quote: <strong>{formatCurrency(total * 0.5)}</strong>
                    </span>
                  )}
                </p>
                {total > 0 && (
                  <button
                    type="button"
                    onClick={() => setRequiredDeposit((total * 0.5).toFixed(2))}
                    className="text-xs text-green-600 hover:text-green-800 underline mt-1"
                  >
                    Use 50% deposit
                  </button>
                )}
              </div>
            </div>
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
            placeholder="Notes visible to the customer on the quote..."
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
        <Button variant="outline" href={`/quotes/${quoteId}`}>
          Cancel
        </Button>
        <Button 
          variant="secondary" 
          onClick={() => handleSubmit(true)}
          disabled={saving}
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Saving...
            </>
          ) : (
            'Save Changes'
          )}
        </Button>
        {quoteData.status === 'draft' && (
          <Button 
            onClick={() => handleSubmit(false)}
            disabled={saving}
          >
            Save & Send
          </Button>
        )}
      </div>
    </div>
  );
}
