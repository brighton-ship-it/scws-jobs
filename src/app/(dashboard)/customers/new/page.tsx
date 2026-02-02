'use client';


import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { ArrowLeft, Save, Plus, Trash2 } from 'lucide-react';

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
    notes: '',
  });

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
    
    // TODO: Replace with actual Supabase insert
    // For now, simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    // Redirect to customers list
    router.push('/customers');
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

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="email@example.com"
              />
              <Input
                label="Billing Address"
                name="billing_address"
                value={formData.billing_address}
                onChange={handleChange}
                placeholder="Full billing address"
              />
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

                <Input
                  label="Street Address"
                  value={property.address}
                  onChange={(e) => handlePropertyChange(index, 'address', e.target.value)}
                  required
                  placeholder="123 Main St"
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
