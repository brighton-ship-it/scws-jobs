'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/forms/Input';
import { Save, CreditCard } from 'lucide-react';

interface PaymentSettings {
  ccFeePercent: number;
  achEnabled: boolean;
  achFee: number;
  checksEnabled: boolean;
}

export default function PaymentSettingsPage() {
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<PaymentSettings>({
    ccFeePercent: 3,
    achEnabled: true,
    achFee: 0,
    checksEnabled: true,
  });

  const handleSave = async () => {
    setSaving(true);
    // TODO: Implement actual save logic with Supabase
    await new Promise(resolve => setTimeout(resolve, 1000));
    setSaving(false);
    // Show success toast
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Payment Settings</h2>
        <p className="text-gray-600">Configure payment methods and fees for customer invoices</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-gray-400" />
            Payment Methods
          </CardTitle>
          <CardDescription>
            Control which payment methods are available to customers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* ACH Settings */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-gray-900">ACH / Bank Transfer</h4>
                <p className="text-sm text-gray-500">Recommended payment method</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.achEnabled}
                  onChange={(e) => setSettings({ ...settings, achEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>
            {settings.achEnabled && (
              <div className="pl-4">
                <Input
                  label="ACH Fee"
                  type="number"
                  step="0.01"
                  min="0"
                  value={settings.achFee}
                  onChange={(e) => setSettings({ ...settings, achFee: parseFloat(e.target.value) || 0 })}
                  leftIcon={<span className="text-gray-400">$</span>}
                  helpText="Fixed fee per ACH transaction (typically $0)"
                />
              </div>
            )}
          </div>

          {/* Credit Card Settings */}
          <div className="space-y-3 border-t border-gray-200 pt-6">
            <div>
              <h4 className="font-medium text-gray-900">Credit/Debit Card</h4>
              <p className="text-sm text-gray-500">Convenience payment option with fee</p>
            </div>
            <Input
              label="Credit Card Fee"
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={settings.ccFeePercent}
              onChange={(e) => setSettings({ ...settings, ccFeePercent: parseFloat(e.target.value) || 0 })}
              rightIcon={<span className="text-gray-400">%</span>}
              helpText="Percentage added to invoice total to cover processing fees"
            />
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-700">
                <strong>Example:</strong> A $1,000 invoice with {settings.ccFeePercent}% fee would charge the customer ${(1000 * (1 + settings.ccFeePercent / 100)).toFixed(2)} total when paying by card.
              </p>
            </div>
          </div>

          {/* Check Settings */}
          <div className="space-y-3 border-t border-gray-200 pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-gray-900">Check Payments</h4>
                <p className="text-sm text-gray-500">Traditional payment method (contact required)</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.checksEnabled}
                  onChange={(e) => setSettings({ ...settings, checksEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>
            <p className="text-xs text-gray-500 pl-4">
              When enabled, customers will see a note to contact you for check payment instructions.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Integration Info */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Processing</CardTitle>
          <CardDescription>
            Integrate with Stax for secure payment processing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-amber-800">
                <strong>Coming Soon:</strong> Direct integration with Stax payment gateway.
                Settings saved here will be used once the integration is activated.
              </p>
            </div>
            <Button variant="outline" disabled>
              Configure Stax Integration
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" href="/settings">
          Cancel
        </Button>
        <Button onClick={handleSave} loading={saving}>
          <Save className="h-4 w-4" />
          Save Settings
        </Button>
      </div>
    </div>
  );
}
