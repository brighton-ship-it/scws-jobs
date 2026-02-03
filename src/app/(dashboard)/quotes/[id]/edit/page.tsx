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
import { mockCustomers, getPropertiesByCustomerId, mockProducts, getQuoteWithDetails } from '@/lib/mock-data';
import { ArrowLeft, DollarSign } from 'lucide-react';

export default function EditQuotePage() {
  const router = useRouter();
  const params = useParams();
  const quoteId = params.id as string;
  
  const quoteData = getQuoteWithDetails(quoteId);

  const [customerId, setCustomerId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [taxRate, setTaxRate] = useState(8.75);
  const [requiredDeposit, setRequiredDeposit] = useState<string>('');
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load quote data
  useEffect(() => {
    if (quoteData && !loaded) {
      setCustomerId(quoteData.customer_id);
      setPropertyId(quoteData.property_id || '');
      setValidUntil(quoteData.valid_until || '');
      setNotes(quoteData.notes || '');
      setInternalNotes(quoteData.internal_notes || '');
      setTaxRate(quoteData.tax_rate);
      setRequiredDeposit(quoteData.required_deposit ? quoteData.required_deposit.toFixed(2) : '');
      setLineItems(quoteData.items.map(item => ({
        id: item.id,
        description: item.description,
        item_description: (item as any).item_description || null,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.total,
        item_type: item.item_type,
        taxable: (item as any).taxable !== false, // Default to true if not set
        sort_order: item.sort_order,
      })));
      setLoaded(true);
    }
  }, [quoteData, loaded]);

  if (!quoteData) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Quote not found</h2>
        <p className="text-gray-500 mt-2">The quote you're looking for doesn't exist.</p>
        <Button href="/quotes" variant="outline" className="mt-4">
          Back to Quotes
        </Button>
      </div>
    );
  }

  const properties = customerId ? getPropertiesByCustomerId(customerId) : [];

  const customerOptions = mockCustomers.map(c => ({ value: c.id, label: c.name }));
  const propertyOptions = properties.map(p => ({ 
    value: p.id, 
    label: `${p.address}${p.city ? `, ${p.city}` : ''}` 
  }));

  const activeProducts = mockProducts.filter(p => p.active);

  // Calculate totals
  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  // Only apply tax to taxable items
  const taxableSubtotal = lineItems.filter(item => item.taxable).reduce((sum, item) => sum + item.total, 0);
  const taxAmount = taxableSubtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const handleSubmit = async (asDraft: boolean = true) => {
    if (!customerId) {
      alert('Please select a customer');
      return;
    }

    setSaving(true);
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // TODO: Implement actual update logic

    router.push(`/quotes/${quoteId}`);
  };

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
          Save Changes
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
