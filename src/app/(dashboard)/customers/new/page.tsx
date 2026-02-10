'use client';


import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { AddressAutocomplete } from '@/components/address-autocomplete';
import { ArrowLeft, Save, Plus, Trash2, Target } from 'lucide-react';
import type { LeadSource } from '@/types/database';

const LEAD_SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: 'phone', label: 'Phone Call' },
  { value: 'referral', label: 'Referral' },
  { value: 'repeat_customer', label: 'Repeat Customer' },
  { value: 'walk_in', label: 'Walk-In' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'organic_seo', label: 'Organic Search' },
  { value: 'website_form', label: 'Website Form' },
  { value: 'other', label: 'Other' },
];

interface PropertyForm {
  address: string;
  city: string;
  county: string;
  zip: string;
  access_notes: string;
}

export default function NewCustomerPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    billing_address: '',
    billing_city: '',
    billing_state: 'CA',
    billing_zip: '',
    notes: '',
    lead_source: '' as LeadSource | '',
    lead_source_detail: '',
  });
  
  const [sameAsProperty, setSameAsProperty] = useState(false);

  const [properties, setProperties] = useState<PropertyForm[]>([
    { address: '', city: '', county: '', zip: '', access_notes: '' },
  ]);

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear error when user types
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handlePropertyChange = (index: number, field: keyof PropertyForm, value: string) => {
    setProperties((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleAddressSelect = useCallback((index: number, components: { address: string; city: string; county: string; zip: string }) => {
    setProperties((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        address: components.address,
        city: components.city,
        county: components.county,
        zip: components.zip,
      };
      return updated;
    });
    
    // If "same as property" is checked and this is the first property, update billing
    if (sameAsProperty && index === 0) {
      setFormData(prev => ({
        ...prev,
        billing_address: components.address,
        billing_city: components.city,
        billing_state: 'CA',
        billing_zip: components.zip,
      }));
    }
  }, [sameAsProperty]);
  
  const handleSameAsPropertyChange = (checked: boolean) => {
    setSameAsProperty(checked);
    if (checked && properties[0]) {
      setFormData(prev => ({
        ...prev,
        billing_address: properties[0].address,
        billing_city: properties[0].city,
        billing_state: 'CA',
        billing_zip: properties[0].zip,
      }));
    }
  };

  const addProperty = () => {
    setProperties((prev) => [
      ...prev,
      { address: '', city: '', county: '', zip: '', access_notes: '' },
    ]);
  };

  const removeProperty = (index: number) => {
    if (properties.length > 1) {
      setProperties((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.name.trim()) {
      newErrors.name = 'Customer name is required';
    }

    // Validate at least one property has an address
    const hasValidProperty = properties.some((p) => p.address.trim());
    if (!hasValidProperty) {
      newErrors.property = 'At least one property address is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) return;

    setLoading(true);
    setErrors({});
    
    try {
      const response = await fetch('/api/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customer: formData,
          properties: properties.filter(p => p.address.trim()),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrors({ submit: data.error || 'Failed to save customer' });
        setLoading(false);
        return;
      }

      // Success - redirect to customers list
      router.push('/customers');
    } catch (error) {
      console.error('Error saving customer:', error);
      setErrors({ submit: 'Network error. Please try again.' });
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Add New Customer</h2>
          <p className="text-gray-600">Create a new customer record</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Customer Info */}
        <Card>
          <CardHeader>
            <CardTitle>Customer Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Customer Name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                error={errors.name}
                required
                placeholder="e.g., Johnson Ranch or John Smith"
              />
              <Input
                label="Phone"
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={handleChange}
                placeholder="(760) 555-1234"
              />
            </div>

            <Input
              label="Email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="email@example.com"
            />

            {/* Billing Address Section */}
            <div className="border-t pt-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-700">Billing Address</label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sameAsProperty}
                    onChange={(e) => handleSameAsPropertyChange(e.target.checked)}
                    className="rounded border-gray-300 text-[#4e9271] focus:ring-[#4e9271]"
                  />
                  <span className="text-gray-600">Same as property address</span>
                </label>
              </div>
              
              <div className="space-y-4">
                <Input
                  label="Street Address"
                  name="billing_address"
                  value={formData.billing_address}
                  onChange={handleChange}
                  disabled={sameAsProperty}
                  placeholder="123 Main St"
                />
                <div className="grid gap-4 sm:grid-cols-3">
                  <Input
                    label="City"
                    name="billing_city"
                    value={formData.billing_city}
                    onChange={handleChange}
                    disabled={sameAsProperty}
                    placeholder="Ramona"
                  />
                  <Input
                    label="State"
                    name="billing_state"
                    value={formData.billing_state}
                    onChange={handleChange}
                    disabled={sameAsProperty}
                    placeholder="CA"
                    maxLength={2}
                  />
                  <Input
                    label="ZIP"
                    name="billing_zip"
                    value={formData.billing_zip}
                    onChange={handleChange}
                    disabled={sameAsProperty}
                    placeholder="92065"
                  />
                </div>
              </div>
            </div>

            {/* Lead Source Tracking */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Target className="h-4 w-4 inline mr-1" />
                  Lead Source
                </label>
                <Select
                  value={formData.lead_source}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, lead_source: value as LeadSource }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="How did they find us?" />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_SOURCE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(formData.lead_source === 'referral' || formData.lead_source === 'other') && (
                <Input
                  label="Details"
                  name="lead_source_detail"
                  value={formData.lead_source_detail}
                  onChange={handleChange}
                  placeholder={formData.lead_source === 'referral' ? "Who referred them?" : "How did they find us?"}
                />
              )}
            </div>

            <Textarea
              label="Notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              placeholder="Any relevant notes about this customer..."
              rows={3}
            />
          </CardContent>
        </Card>

        {/* Properties */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Service Properties</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addProperty}>
              <Plus className="h-4 w-4" />
              Add Property
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {errors.property && (
              <p className="text-sm text-red-600">{errors.property}</p>
            )}

            {properties.map((property, index) => (
              <div
                key={index}
                className="relative rounded-lg border border-gray-200 p-4 space-y-4"
              >
                {properties.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeProperty(index)}
                    className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 hover:bg-red-100 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}

                <div className="pr-10">
                  <p className="text-sm font-medium text-gray-700 mb-3">
                    Property {index + 1}
                  </p>
                </div>

                <AddressAutocomplete
                  label="Street Address"
                  value={property.address}
                  onChange={(value) => handlePropertyChange(index, 'address', value)}
                  onAddressSelect={(components) => handleAddressSelect(index, components)}
                  required
                  placeholder="Start typing to search..."
                />

                <div className="grid gap-4 sm:grid-cols-3">
                  <Input
                    label="City"
                    value={property.city}
                    onChange={(e) => handlePropertyChange(index, 'city', e.target.value)}
                    placeholder="Palm Springs"
                  />
                  <Input
                    label="County"
                    value={property.county}
                    onChange={(e) => handlePropertyChange(index, 'county', e.target.value)}
                    placeholder="Riverside"
                  />
                  <Input
                    label="ZIP"
                    value={property.zip}
                    onChange={(e) => handlePropertyChange(index, 'zip', e.target.value)}
                    placeholder="92262"
                  />
                </div>

                <Textarea
                  label="Access Notes"
                  value={property.access_notes}
                  onChange={(e) => handlePropertyChange(index, 'access_notes', e.target.value)}
                  placeholder="Gate codes, directions, parking info..."
                  rows={2}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Error Message */}
        {errors.submit && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-600">{errors.submit}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            <Save className="h-4 w-4" />
            {loading ? 'Saving...' : 'Save Customer'}
          </Button>
        </div>
      </form>
    </div>
  );
}
