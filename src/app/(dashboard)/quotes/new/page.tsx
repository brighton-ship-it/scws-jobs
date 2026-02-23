'use client';

// Disable static generation for this page
export const dynamic = 'force-dynamic';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/forms/Input';
import { Select } from '@/components/forms/Select';
import { TextArea } from '@/components/forms/TextArea';
import { DraggableLineItems, type LineItem } from '@/components/line-items/DraggableLineItems';
import { CustomerSearch } from '@/components/customer-search';
import type { Property, Product } from '@/types/database';
import { ArrowLeft, DollarSign } from 'lucide-react';

export default function NewQuotePage() {
  const router = useRouter();
  const [customerId, setCustomerId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [properties, setProperties] = useState<Property[]>([]);
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [taxRate, setTaxRate] = useState(8.75);
  const [requiredDeposit, setRequiredDeposit] = useState<string>('');
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: '1', description: '', item_description: null, quantity: 1, unit_price: 0, total: 0, item_type: null, taxable: true, sort_order: 0 }
  ]);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Fetch products from API
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await fetch('/api/products?limit=2000');
        if (res.ok) {
          const data = await res.json();
          setProducts(data.products || []);
        }
      } catch (error) {
        console.error('Failed to fetch products:', error);
      } finally {
        setLoadingProducts(false);
      }
    };
    fetchProducts();
  }, []);

  const propertyOptions = properties.map(p => ({ 
    value: p.id, 
    label: `${p.address}${p.city ? `, ${p.city}` : ''}` 
  }));

  const handleCustomerChange = (newCustomerId: string) => {
    setCustomerId(newCustomerId);
    setPropertyId(''); // Reset property when customer changes
  };

  const handlePropertiesLoaded = (loadedProperties: Property[]) => {
    setProperties(loadedProperties);
    // Auto-select first property if only one
    if (loadedProperties.length === 1) {
      setPropertyId(loadedProperties[0].id);
    }
  };

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

  const handleSubmit = async (asDraft: boolean = true) => {
    if (!customerId) {
      alert('Please select a customer');
      return;
    }

    // Validate line items
    const validLineItems = lineItems.filter(item => item.description.trim());
    if (validLineItems.length === 0) {
      alert('Please add at least one line item');
      return;
    }

    setSaving(true);
    
    try {
      const response = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          property_id: propertyId || null,
          valid_until: validUntil || null,
          notes: notes || null,
          internal_notes: internalNotes || null,
          tax_rate: taxRate,
          required_deposit: requiredDeposit ? parseFloat(requiredDeposit) : null,
          status: asDraft ? 'draft' : 'sent',
          line_items: validLineItems.map((item, index) => ({
            description: item.description,
            item_description: item.item_description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total: item.total,
            item_type: item.item_type,
            taxable: item.taxable,
            sort_order: index,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create quote');
      }

      // If "Save & Send" was clicked, send the email
      if (!asDraft && data.quote?.id) {
        try {
          const sendRes = await fetch(`/api/quotes/${data.quote.id}/send`, {
            method: 'POST',
          });
          const sendData = await sendRes.json();
          if (!sendRes.ok) {
            alert(`Quote saved but email failed: ${sendData.error}`);
          }
        } catch (sendError) {
          console.error('Send error:', sendError);
          alert('Quote saved but failed to send email');
        }
      }

      // Redirect to quotes list
      router.push('/quotes');
    } catch (error) {
      console.error('Save error:', error);
      alert(error instanceof Error ? error.message : 'Failed to save quote');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/quotes" className="p-2 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">New Quote</h2>
            <p className="text-gray-600">Create a new quote for a customer</p>
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
            <CustomerSearch
              label="Customer"
              placeholder="Search customers..."
              value={customerId}
              onChange={handleCustomerChange}
              onPropertiesLoaded={handlePropertiesLoaded}
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
          <span className="text-sm text-gray-500">
            {loadingProducts ? 'Loading products...' : `${activeProducts.length} products available`}
          </span>
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
        <Button variant="outline" href="/quotes">
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
    </div>
  );
}
