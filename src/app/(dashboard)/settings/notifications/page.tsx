'use client';


import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Button } from '@/components/forms/Button';
import { Input } from '@/components/forms/Input';
import { mockNotificationSettings } from '@/lib/mock-data';

interface ToggleSwitchProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label: string;
  description?: string;
}

function ToggleSwitch({ enabled, onChange, label, description }: ToggleSwitchProps) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="font-medium text-gray-900">{label}</p>
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          enabled ? 'bg-blue-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export default function NotificationSettingsPage() {
  const [settings, setSettings] = useState(mockNotificationSettings);
  const [saving, setSaving] = useState(false);

  const handleToggle = (field: keyof typeof settings, value: boolean) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setSaving(false);
    alert('Notification settings saved!');
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Settings', href: '/settings' },
          { label: 'Notifications' },
        ]}
      />

      <div>
        <h2 className="text-2xl font-bold text-gray-900">Notification Settings</h2>
        <p className="text-gray-600">Manage how you receive notifications</p>
      </div>

      {/* Email Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Email Notifications</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-gray-100">
          <ToggleSwitch
            enabled={settings.email_job_assigned}
            onChange={(v) => handleToggle('email_job_assigned', v)}
            label="Job Assigned"
            description="Get notified when a job is assigned to you"
          />
          <ToggleSwitch
            enabled={settings.email_job_reminder}
            onChange={(v) => handleToggle('email_job_reminder', v)}
            label="Job Reminders"
            description="Receive reminders before scheduled jobs"
          />
        </CardContent>
      </Card>

      {/* Push Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Push Notifications</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-gray-100">
          <ToggleSwitch
            enabled={settings.push_job_assigned}
            onChange={(v) => handleToggle('push_job_assigned', v)}
            label="Job Assigned"
            description="Get push notifications for new job assignments"
          />
          <ToggleSwitch
            enabled={settings.push_job_reminder}
            onChange={(v) => handleToggle('push_job_reminder', v)}
            label="Job Reminders"
            description="Receive push reminders before scheduled jobs"
          />
        </CardContent>
      </Card>

      {/* SMS Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>SMS Notifications</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-gray-100">
          <ToggleSwitch
            enabled={settings.sms_enabled}
            onChange={(v) => handleToggle('sms_enabled', v)}
            label="Enable SMS"
            description="Receive important notifications via text message"
          />
        </CardContent>
      </Card>

      {/* Reminder Timing */}
      <Card>
        <CardHeader>
          <CardTitle>Reminder Timing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Input
              label="Hours before job"
              type="number"
              value={settings.reminder_hours_before}
              onChange={(e) => setSettings(prev => ({ 
                ...prev, 
                reminder_hours_before: parseInt(e.target.value) || 24 
              }))}
              min={1}
              max={72}
            />
            <p className="mt-2 text-sm text-gray-500">
              Send reminders this many hours before a scheduled job
            </p>
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
