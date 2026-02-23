'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Input } from '@/components/forms/Input';
import { Button } from '@/components/forms/Button';
import { useToast } from '@/components/feedback/Toaster';
import { Upload, Building2, Loader2 } from 'lucide-react';

// Default company settings
const defaultCompanySettings = {
  company_name: 'Southern California Well Service',
  address: '1077 Main St',
  city: 'Ramona',
  state: 'CA',
  zip: '92065',
  phone: '(760) 440-8520',
  email: 'info@scwellservice.com',
  website: 'www.scwellservice.com',
  logo_url: '',
};

export default function CompanySettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState(defaultCompanySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch('/api/settings?key=company');
        if (res.ok) {
          const data = await res.json();
          if (data.settings) {
            setSettings({ ...defaultCompanySettings, ...data.settings });
          }
        }
      } catch (error) {
        console.error('Failed to fetch settings:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleChange = (field: string, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'company', value: settings }),
      });
      
      if (res.ok) {
        toast.success('Settings saved', 'Company information has been updated.');
      } else {
        const data = await res.json();
        toast.error('Failed to save', data.error || 'Please try again.');
      }
    } catch (error) {
      toast.error('Failed to save', 'Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

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
              value={settings.company_name}
              onChange={(e) => handleChange('company_name', e.target.value)}
            />
            <Input
              label="Email"
              type="email"
              value={settings.email}
              onChange={(e) => handleChange('email', e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Phone"
              value={settings.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
            />
            <Input
              label="Website"
              value={settings.website}
              onChange={(e) => handleChange('website', e.target.value)}
            />
          </div>

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
