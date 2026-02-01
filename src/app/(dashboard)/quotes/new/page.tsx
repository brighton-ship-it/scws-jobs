'use client';

// Disable static generation for this page
export const dynamic = 'force-dynamic';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/forms/Input';
import { Select } from '@/components/forms/Select';
import { TextArea } from '@/components/forms/TextArea';
import { DraggableLineItems, type LineItem } from '@/components/line-items/DraggableLineItems';
import { mockCustomers, getPropertiesByCustomerId, mockProducts } from '@/lib/mock-data';
import { ArrowLeft } from 'lucide-react';

export default function NewQuotePage() {
  const router = useRouter();
  const [customerId, setCustomerId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [taxRate, setTaxRate] = useState(8.75);
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: '1', description: '', quantity: 1, unit_price: 0, total: 0, item_type: null, sort_order: 0 }
  ]);
  const [saving, setSaving] = useState(false);

  const properties = customerId ? getPropertiesByCustomerId(customerId) : [];

  const customerOptions = mockCustomers.map(c => ({ value: c.id, label: c.name }));
  const propertyOptions = properties.map(p => ({ 
    value: p.id, 
    label: `${p.address}${p.city ? `, ${p.city}` : ''}` 
  }));

  const activeProducts = mockProducts.filter(p => p.active);

  // Calculate totals
  const subtotal = useMemo(() => 
    lineItems.reduce((sum, item) => sum + item.total, 0), 
    [lineItems]
  );
  const taxAmount = useMemo(() => subtotal * (taxRate / 100), [subtotal, taxRate]);
  const total = useMemo(() => subtotal + taxAmount, [subtotal, taxAmount]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const handleSubmit = async (asDraft: boolean = true) => {
    if (!customerId) {
      alert('Please select a customer');
      return;
    }

    setSaving(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // In a real app, this would save to the database
    console.log('Saving quote:', {
      customer_id: customerId,
      property_id: propertyId || null,
      valid_until: validUntil || null,
      notes,
      internal_notes: internalNotes,
      tax_rate: taxRate,
      subtotal,
      tax_amount: taxAmount,
      total,
      status: asDraft ? 'draft' : 'sent',
      line_items: lineItems,
    });

    router.push('/quotes');
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
            <Select
              label="Customer"
              options={customerOptions}
              placeholder="Select a customer"
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setPropertyId(''); // Reset property when customer changes
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
