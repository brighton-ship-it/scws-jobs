'use client';

import { useState, useEffect, useCallback } from 'react';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

interface UsePushNotificationsReturn {
  isSupported: boolean;
  permission: NotificationPermission | 'unknown';
  isSubscribed: boolean;
  isLoading: boolean;
  subscribe: (userId?: string) => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  requestPermission: () => Promise<boolean>;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unknown'>('unknown');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check support and current state
  useEffect(() => {
    const checkSupport = async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      setIsSupported(supported);

      if (!supported) {
        setIsLoading(false);
        return;
      }

      setPermission(Notification.permission);

      // Check if already subscribed (with timeout to prevent hanging)
      try {
        const registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<ServiceWorkerRegistration>((_, reject) => 
            setTimeout(() => reject(new Error('timeout')), 5000)
          )
        ]);
        const subscription = await registration.pushManager.getSubscription();
        setIsSubscribed(!!subscription);
      } catch (error) {
        console.log('[Push] Could not check subscription status:', error);
        // Still allow user to try subscribing
      }

      setIsLoading(false);
    };

    checkSupport();
  }, []);

  // Request permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result === 'granted';
    } catch (error) {
      console.error('[Push] Error requesting permission:', error);
      return false;
    }
  }, [isSupported]);

  // Subscribe to push notifications
  const subscribe = useCallback(async (userId?: string): Promise<boolean> => {
    if (!isSupported || !VAPID_PUBLIC_KEY) {
      console.error('[Push] Not supported or no VAPID key');
      alert('Push notifications not supported on this device');
      return false;
    }

    try {
      console.log('[Push] Starting subscribe flow...');
      
      // Ensure permission
      if (Notification.permission !== 'granted') {
        console.log('[Push] Requesting permission...');
        const granted = await requestPermission();
        if (!granted) {
          console.log('[Push] Permission denied');
          alert('Please allow notifications when prompted');
          return false;
        }
      }
      console.log('[Push] Permission granted');

      // Get service worker registration with timeout
      console.log('[Push] Waiting for service worker...');
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Service worker timeout')), 10000)
        )
      ]);
      console.log('[Push] Service worker ready');

      // Subscribe to push
      console.log('[Push] Subscribing to push manager...');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      console.log('[Push] Push subscription created');

      // Send subscription to server
      console.log('[Push] Saving to server...');
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          userId,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Failed to save subscription: ${err}`);
      }

      setIsSubscribed(true);
      console.log('[Push] Subscribed successfully');
      return true;
    } catch (error) {
      console.error('[Push] Subscribe error:', error);
      alert(`Push setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }, [isSupported, requestPermission]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Unsubscribe from browser
        await subscription.unsubscribe();

        // Remove from server
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
      }

      setIsSubscribed(false);
      console.log('[Push] Unsubscribed successfully');
      return true;
    } catch (error) {
      console.error('[Push] Unsubscribe error:', error);
      return false;
    }
  }, [isSupported]);

  return {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    subscribe,
    unsubscribe,
    requestPermission,
  };
}
