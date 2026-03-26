'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Input } from '@/components/forms/Input';
import { Select } from '@/components/forms/Select';
import { Button } from '@/components/forms/Button';
import { useToast } from '@/components/feedback/Toaster';
import { Loader2 } from 'lucide-react';

const defaultBillingSettings = {
  tax_rate: 7.75,
  payment_terms_days: 30,
  invoice_prefix: 'INV',
  invoice_notes: 'Thank you for your business!',
  late_fee_percentage: 1.5,
  accept_credit_cards: true,
  accept_checks: true,
  accept_cash: true,
};

export default function BillingSettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState(defaultBillingSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch('/api/settings?key=billing');
        if (res.ok) {
          const data = await res.json();
          if (data.settings) {
            setSettings({ ...defaultBillingSettings, ...data.settings });
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

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'billing', value: settings }),
      });
      
      if (res.ok) {
        toast.success('Settings saved', 'Billing settings have been updated.');
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
          { label: 'Billing' },
        ]}
      />

      <div>
        <h2 className="text-2xl font-bold text-gray-900">Billing Settings</h2>
        <p className="text-gray-600">Configure invoicing and payment options</p>
      </div>

      {/* Tax Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Tax Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs">
            <Input
              label="Tax Rate (%)"
              type="number"
              step="0.01"
              value={settings.tax_rate}
              onChange={(e) => setSettings(prev => ({ 
                ...prev, 
                tax_rate: parseFloat(e.target.value) || 0 
              }))}
            />
            <p className="mt-1 text-sm text-gray-500">
              Applied to all invoices unless specified otherwise
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Invoice Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Invoice Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Invoice Number Prefix"
              value={settings.invoice_prefix}
              onChange={(e) => setSettings(prev => ({ 
                ...prev, 
                invoice_prefix: e.target.value 
              }))}
              placeholder="INV"
            />
            <Select
              label="Default Payment Terms"
              value={settings.payment_terms_days.toString()}
              onChange={(e) => setSettings(prev => ({ 
                ...prev, 
                payment_terms_days: parseInt(e.target.value) 
              }))}
              options={[
                { value: '0', label: 'Due on Receipt' },
                { value: '15', label: 'Net 15' },
                { value: '30', label: 'Net 30' },
                { value: '45', label: 'Net 45' },
                { value: '60', label: 'Net 60' },
              ]}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Default Invoice Notes
            </label>
            <textarea
              value={settings.invoice_notes}
              onChange={(e) => setSettings(prev => ({ 
                ...prev, 
                invoice_notes: e.target.value 
              }))}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Thank you for your business!"
            />
          </div>
        </CardContent>
      </Card>

      {/* Late Fees */}
      <Card>
        <CardHeader>
          <CardTitle>Late Payment Fees</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Input
              label="Late Fee (%)"
              type="number"
              step="0.1"
              value={settings.late_fee_percentage}
              onChange={(e) => setSettings(prev => ({ 
                ...prev, 
                late_fee_percentage: parseFloat(e.target.value) || 0 
              }))}
            />
            <p className="mt-1 text-sm text-gray-500">
              Percentage charged monthly on overdue invoices
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Payment Methods */}
      <Card>
        <CardHeader>
          <CardTitle>Accepted Payment Methods</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { key: 'accept_credit_cards', label: 'Credit/Debit Cards' },
              { key: 'accept_checks', label: 'Checks' },
              { key: 'accept_cash', label: 'Cash' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings[key as keyof typeof settings] as boolean}
                  onChange={(e) => setSettings(prev => ({ 
                    ...prev, 
                    [key]: e.target.checked 
                  }))}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-gray-700">{label}</span>
              </label>
            ))}
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
