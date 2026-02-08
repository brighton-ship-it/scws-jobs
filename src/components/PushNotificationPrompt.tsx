'use client';

import { useState, useEffect } from 'react';
import { Bell, BellOff, X } from 'lucide-react';
import { usePushNotifications } from '@/hooks/usePushNotifications';

interface PushNotificationPromptProps {
  userId?: string;
  onDismiss?: () => void;
}

export function PushNotificationPrompt({ userId, onDismiss }: PushNotificationPromptProps) {
  const { isSupported, permission, isSubscribed, isLoading, subscribe } = usePushNotifications();
  const [dismissed, setDismissed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  // Check if already dismissed
  useEffect(() => {
    const wasDismissed = localStorage.getItem('push-prompt-dismissed');
    if (wasDismissed) setDismissed(true);
  }, []);

  const handleEnable = async () => {
    setSubscribing(true);
    const success = await subscribe(userId);
    setSubscribing(false);
    
    if (success) {
      handleDismiss();
    }
  };

  const handleDismiss = () => {
    localStorage.setItem('push-prompt-dismissed', 'true');
    setDismissed(true);
    onDismiss?.();
  };

  // Don't show if not supported, already subscribed, denied, or dismissed
  if (isLoading || !isSupported || isSubscribed || permission === 'denied' || dismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-[#1f3b4d] text-white rounded-lg shadow-lg p-4 z-50 animate-in slide-in-from-bottom duration-300">
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 p-1 hover:bg-white/10 rounded"
      >
        <X className="h-4 w-4" />
      </button>
      
      <div className="flex items-start gap-3">
        <div className="p-2 bg-white/10 rounded-full">
          <Bell className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">Enable Notifications</h3>
          <p className="text-sm text-white/80 mt-1">
            Get notified about new jobs, schedule changes, and urgent alerts even when the app is closed.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleEnable}
              disabled={subscribing}
              className="px-4 py-2 bg-[#4e9271] hover:bg-[#3d7359] rounded font-medium text-sm disabled:opacity-50"
            >
              {subscribing ? 'Enabling...' : 'Enable'}
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-2 hover:bg-white/10 rounded font-medium text-sm"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NotificationToggle({ userId }: { userId?: string }) {
  const { isSupported, isSubscribed, isLoading, subscribe, unsubscribe } = usePushNotifications();
  const [toggling, setToggling] = useState(false);

  if (isLoading || !isSupported) return null;

  const handleToggle = async () => {
    setToggling(true);
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe(userId);
    }
    setToggling(false);
  };

  return (
    <button
      onClick={handleToggle}
      disabled={toggling}
      className={`flex items-center gap-2 px-4 py-3 rounded-lg w-full ${
        isSubscribed ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-700'
      } disabled:opacity-50`}
    >
      {isSubscribed ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
      <span className="flex-1 text-left">
        {toggling ? 'Updating...' : isSubscribed ? 'Notifications enabled' : 'Enable notifications'}
      </span>
      <span className={`text-xs px-2 py-1 rounded ${isSubscribed ? 'bg-green-100' : 'bg-gray-200'}`}>
        {isSubscribed ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}
