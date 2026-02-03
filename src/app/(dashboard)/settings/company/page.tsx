'use client';


import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Input } from '@/components/forms/Input';
import { Button } from '@/components/forms/Button';
import { Upload, Building2 } from 'lucide-react';
import { mockCompanySettings } from '@/lib/mock-data';

export default function CompanySettingsPage() {
  const [settings, setSettings] = useState(mockCompanySettings);
  const [saving, setSaving] = useState(false);

  const handleChange = (field: string, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    setSaving(false);
    alert('Settings saved!');
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Settings', href: '/settings' },
          { label: 'Company' },
        ]}
      />

      <div>
        <h2 className="text-2xl font-bold text-gray-900">Company Settings</h2>
        <p className="text-gray-600">Manage your business information</p>
      </div>

      {/* Logo Upload */}
      <Card>
        <CardHeader>
          <CardTitle>Company Logo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="flex h-24 w-24 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50">
              {settings.logo_url ? (
                <img src={settings.logo_url} alt="Logo" className="h-full w-full object-contain rounded-lg" />
              ) : (
                <Building2 className="h-10 w-10 text-gray-400" />
              )}
            </div>
            <div>
              <Button variant="outline">
                <Upload className="h-4 w-4 mr-2" />
                Upload Logo
              </Button>
              <p className="mt-2 text-sm text-gray-500">
                PNG, JPG up to 2MB. Recommended size: 200x200px
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Business Information */}
      <Card>
        <CardHeader>
          <CardTitle>Business Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Company Name"
              value={settings.name}
              onChange={(e) => handleChange('name', e.target.value)}
            />
            <Input
              label="Email"
              type="email"
              value={settings.email}
              onChange={(e) => handleChange('email', e.target.value)}
            />
          </div>

          <Input
            label="Phone"
            value={settings.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
          />

          <Input
            label="Street Address"
            value={settings.address}
            onChange={(e) => handleChange('address', e.target.value)}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="City"
              value={settings.city}
              onChange={(e) => handleChange('city', e.target.value)}
            />
            <Input
              label="State"
              value={settings.state}
              onChange={(e) => handleChange('state', e.target.value)}
            />
            <Input
              label="ZIP Code"
              value={settings.zip}
              onChange={(e) => handleChange('zip', e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} loading={saving}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
