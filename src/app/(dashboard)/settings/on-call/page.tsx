'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/forms/Input';
import { ArrowLeft, Save, DollarSign, Clock, Bell } from 'lucide-react';
import Link from 'next/link';

interface OnCallSettings {
  id?: string;
  availability_pay_daily: number;
  callout_multiplier: number;
  minimum_callout_hours: number;
  base_hourly_rate: number;
  require_one_per_day: boolean;
  auto_rotate: boolean;
  notify_days_ahead: number;
}

export default function OnCallSettingsPage() {
  const [settings, setSettings] = useState<OnCallSettings>({
    availability_pay_daily: 75,
    callout_multiplier: 1.5,
    minimum_callout_hours: 2,
    base_hourly_rate: 30,
    require_one_per_day: true,
    auto_rotate: false,
    notify_days_ahead: 7,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/on-call/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setSettings(data.settings);
        }
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    
    try {
      const res = await fetch('/api/on-call/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  // Calculate example pay
  const exampleCalloutHours = 3;
  const exampleCalloutPay = exampleCalloutHours * settings.base_hourly_rate * settings.callout_multiplier;
  const exampleDayTotal = settings.availability_pay_daily + exampleCalloutPay;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1f3b4d]" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/on-call" className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5 text-gray-600" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">On-Call Settings</h1>
          <p className="text-gray-600">Configure pay rates and rules</p>
        </div>
      </div>

      {/* Pay Rates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-600" />
            Pay Rates
          </CardTitle>
          <CardDescription>
            Set compensation for on-call availability and callouts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Availability Pay (per day)"
              type="number"
              step="0.01"
              value={settings.availability_pay_daily}
              onChange={(e) => setSettings({ ...settings, availability_pay_daily: parseFloat(e.target.value) || 0 })}
              hint="Flat rate paid for being on-call, even if no calls"
            />
            <Input
              label="Base Hourly Rate"
              type="number"
              step="0.01"
              value={settings.base_hourly_rate}
              onChange={(e) => setSettings({ ...settings, base_hourly_rate: parseFloat(e.target.value) || 0 })}
              hint="Used when tech doesn't have their own rate set"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Callout Multiplier"
              type="number"
              step="0.01"
              value={settings.callout_multiplier}
              onChange={(e) => setSettings({ ...settings, callout_multiplier: parseFloat(e.target.value) || 1 })}
              hint="1.5 = time and a half, 2.0 = double time"
            />
            <Input
              label="Minimum Callout Hours"
              type="number"
              step="0.5"
              value={settings.minimum_callout_hours}
              onChange={(e) => setSettings({ ...settings, minimum_callout_hours: parseFloat(e.target.value) || 0 })}
              hint="Minimum hours paid per callout (even for quick jobs)"
            />
          </div>
        </CardContent>
      </Card>

      {/* Example Calculation */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-blue-900">Example Pay Calculation</CardTitle>
          <CardDescription className="text-blue-700">
            If a tech is on-call Saturday and responds to one {exampleCalloutHours}-hour call:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-blue-800">Availability pay:</span>
              <span className="font-medium text-blue-900">${settings.availability_pay_daily.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-blue-800">
                Callout pay ({exampleCalloutHours}h × ${settings.base_hourly_rate} × {settings.callout_multiplier}):
              </span>
              <span className="font-medium text-blue-900">${exampleCalloutPay.toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-blue-200">
              <span className="font-semibold text-blue-900">Total for the day:</span>
              <span className="font-bold text-blue-900">${exampleDayTotal.toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-purple-600" />
            Rules
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.require_one_per_day}
              onChange={(e) => setSettings({ ...settings, require_one_per_day: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-[#4e9271] focus:ring-[#4e9271]"
            />
            <div>
              <p className="font-medium text-gray-900">Require coverage</p>
              <p className="text-sm text-gray-500">Alert if no one is assigned for an upcoming weekend</p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.auto_rotate}
              onChange={(e) => setSettings({ ...settings, auto_rotate: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-[#4e9271] focus:ring-[#4e9271]"
            />
            <div>
              <p className="font-medium text-gray-900">Auto-rotate</p>
              <p className="text-sm text-gray-500">Automatically assign techs in rotation (coming soon)</p>
            </div>
          </label>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-amber-600" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            label="Coverage Alert Days"
            type="number"
            value={settings.notify_days_ahead}
            onChange={(e) => setSettings({ ...settings, notify_days_ahead: parseInt(e.target.value) || 7 })}
            hint="Send alert if weekend is uncovered within this many days"
          />
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="text-green-600 text-sm">✓ Settings saved</span>
        )}
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}
