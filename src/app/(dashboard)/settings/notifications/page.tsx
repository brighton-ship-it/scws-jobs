'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Button } from '@/components/forms/Button';
import { Bell, BellOff, CheckCircle, AlertCircle, Smartphone } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unknown'>('unknown');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    checkPushSupport();
  }, []);

  const checkPushSupport = async () => {
    // Check if push is supported
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setPushSupported(true);
      
      // Check current permission
      const permission = Notification.permission;
      setPushPermission(permission);
      
      // Check if already subscribed
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setIsSubscribed(!!subscription);
      } catch (err) {
        console.error('Error checking subscription:', err);
      }
    }
  };

  const enablePushNotifications = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // Request notification permission
      const permission = await Notification.requestPermission();
      setPushPermission(permission);

      if (permission !== 'granted') {
        setError('Notification permission denied. Please enable notifications in your browser settings.');
        setLoading(false);
        return;
      }

      // Register service worker if not already
      const registration = await navigator.serviceWorker.ready;

      // Get VAPID public key
      const vapidResponse = await fetch('/api/push/vapid-key');
      const { publicKey } = await vapidResponse.json();

      if (!publicKey) {
        throw new Error('VAPID key not configured');
      }

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      // Save subscription to server
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          userId: user?.id
        })
      });

      if (!response.ok) {
        throw new Error('Failed to save subscription');
      }

      setIsSubscribed(true);
      setSuccess('Push notifications enabled! You\'ll now receive alerts on this device.');

      // Send a test notification
      await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.id })
      });

    } catch (err: any) {
      console.error('Push subscription error:', err);
      setError(err.message || 'Failed to enable push notifications');
    } finally {
      setLoading(false);
    }
  };

  const disablePushNotifications = async () => {
    setLoading(true);
    setError('');

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        await subscription.unsubscribe();
        
        // Remove from server
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user?.id })
        });
      }

      setIsSubscribed(false);
      setSuccess('Push notifications disabled.');
    } catch (err: any) {
      setError(err.message || 'Failed to disable push notifications');
    } finally {
      setLoading(false);
    }
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

      {/* Push Notifications - Main Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Push Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!pushSupported ? (
            <div className="flex items-center gap-3 p-4 bg-yellow-50 rounded-lg">
              <AlertCircle className="h-5 w-5 text-yellow-600" />
              <div>
                <p className="font-medium text-yellow-800">Not Supported</p>
                <p className="text-sm text-yellow-700">
                  Push notifications are not supported in this browser. Try Chrome, Firefox, or Edge.
                </p>
              </div>
            </div>
          ) : pushPermission === 'denied' ? (
            <div className="flex items-center gap-3 p-4 bg-red-50 rounded-lg">
              <BellOff className="h-5 w-5 text-red-600" />
              <div>
                <p className="font-medium text-red-800">Notifications Blocked</p>
                <p className="text-sm text-red-700">
                  You've blocked notifications. To enable them, click the lock icon in your browser's address bar
                  and change the notifications setting to "Allow".
                </p>
              </div>
            </div>
          ) : isSubscribed ? (
            <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-medium text-green-800">Notifications Enabled</p>
                  <p className="text-sm text-green-700">
                    You'll receive push notifications on this device.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={disablePushNotifications}
                loading={loading}
              >
                Disable
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="font-medium text-blue-800">Enable Push Notifications</p>
                  <p className="text-sm text-blue-700">
                    Get instant alerts for new jobs, requests, and important updates.
                  </p>
                </div>
              </div>
              <Button
                onClick={enablePushNotifications}
                loading={loading}
              >
                Enable
              </Button>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-600">
              {success}
            </div>
          )}

          <div className="pt-4 border-t">
            <h4 className="font-medium text-gray-900 mb-2">You'll be notified about:</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• New booking requests from customers</li>
              <li>• Jobs assigned to you</li>
              <li>• Quote approvals and responses</li>
              <li>• Sarah AI receptionist call summaries</li>
              <li>• Important system alerts</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Install App Card */}
      <Card>
        <CardHeader>
          <CardTitle>Install SCWS App</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600 mb-4">
            For the best notification experience, install the SCWS app on your device:
          </p>
          <ul className="text-sm text-gray-600 space-y-2 mb-4">
            <li><strong>iPhone/iPad:</strong> Tap Share → "Add to Home Screen"</li>
            <li><strong>Android:</strong> Tap the menu (⋮) → "Install app" or "Add to Home Screen"</li>
            <li><strong>Desktop:</strong> Click the install icon in the address bar (if available)</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
