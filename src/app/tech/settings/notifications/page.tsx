'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import {
  Home,
  Calendar,
  Clock,
  Search,
  MoreHorizontal,
  ChevronLeft,
  Bell,
  BellOff,
  BellRing,
  Smartphone,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  
  const {
    isSupported,
    permission,
    isSubscribed,
    isLoading: hookLoading,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  // Detect iOS and standalone mode
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = typeof window !== 'undefined' && (
    (window.navigator as any).standalone === true || 
    window.matchMedia('(display-mode: standalone)').matches
  );

  const handleTogglePush = async () => {
    setLoading(true);
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe(user?.id);
    }
    setLoading(false);
  };

  const isLoading = loading || hookLoading;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white px-4 pt-6 pb-4 border-b flex items-center gap-3">
        <Link href="/tech/settings" className="p-2 -ml-2 rounded-full hover:bg-gray-100">
          <ChevronLeft className="h-5 w-5 text-gray-600" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-[#1f3b4d]">Notification Settings</h1>
          <p className="text-sm text-gray-500">Manage how you receive alerts</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Push Notifications Toggle */}
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
                  isSubscribed ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'
                }`}>
                  {isSubscribed ? <BellRing className="h-6 w-6" /> : <BellOff className="h-6 w-6" />}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Push Notifications</h3>
                  <p className="text-sm text-gray-500">
                    {isSubscribed ? 'Enabled on this device' : 'Get alerts on your phone'}
                  </p>
                </div>
              </div>
              
              {isSupported ? (
                <button
                  onClick={handleTogglePush}
                  disabled={isLoading}
                  className={`relative w-14 h-8 rounded-full transition-colors ${
                    isSubscribed ? 'bg-green-500' : 'bg-gray-300'
                  } ${isLoading ? 'opacity-50' : ''}`}
                >
                  <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                    isSubscribed ? 'translate-x-7' : 'translate-x-1'
                  }`}>
                    {isLoading && (
                      <Loader2 className="h-4 w-4 animate-spin absolute top-1 left-1 text-gray-400" />
                    )}
                  </span>
                </button>
              ) : (
                <span className="text-sm text-red-500">Not supported</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Status Info */}
        <Card>
          <CardContent className="py-4 px-4 space-y-3">
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              Device Status
            </h3>
            
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Push supported</span>
                {isSupported ? (
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle className="h-4 w-4" /> Yes
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-500">
                    <XCircle className="h-4 w-4" /> No
                  </span>
                )}
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Permission</span>
                <span className={`flex items-center gap-1 ${
                  permission === 'granted' ? 'text-green-600' : 
                  permission === 'denied' ? 'text-red-500' : 'text-yellow-600'
                }`}>
                  {permission === 'granted' && <CheckCircle className="h-4 w-4" />}
                  {permission === 'denied' && <XCircle className="h-4 w-4" />}
                  {permission === 'default' && <AlertTriangle className="h-4 w-4" />}
                  {permission === 'granted' ? 'Allowed' : 
                   permission === 'denied' ? 'Blocked' : 'Not set'}
                </span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Subscribed</span>
                {isSubscribed ? (
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle className="h-4 w-4" /> Yes
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-gray-500">
                    <XCircle className="h-4 w-4" /> No
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* iOS Help */}
        {!isSupported && isIOS && (
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="py-4 px-4">
              <h3 className="font-medium text-orange-800 mb-2">📱 iOS Setup Required</h3>
              <p className="text-sm text-orange-700 mb-2">
                Push notifications on iPhone require a few steps:
              </p>
              <ol className="text-sm text-orange-700 ml-4 list-decimal space-y-1">
                <li><strong>iOS 16.4 or later</strong> — Check Settings → General → About</li>
                {!isStandalone && (
                  <li><strong>Install the app</strong> — Tap Share → "Add to Home Screen"</li>
                )}
                {!isStandalone && (
                  <li><strong>Open from Home Screen</strong> — Not from Safari</li>
                )}
                <li><strong>Enable in iOS Settings</strong> — Settings → Safari → Advanced → Feature Flags → "Notifications" ON</li>
              </ol>
              {isStandalone && (
                <p className="text-sm text-green-700 mt-2">
                  ✓ You're running from the Home Screen — good!
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Not Supported (non-iOS) Help */}
        {!isSupported && !isIOS && (
          <Card className="border-yellow-200 bg-yellow-50">
            <CardContent className="py-4 px-4">
              <h3 className="font-medium text-yellow-800 mb-2">Browser Not Supported</h3>
              <p className="text-sm text-yellow-700">
                Your browser doesn't support push notifications. Try using Chrome, Edge, or Firefox on desktop/Android.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Permission Denied Help */}
        {permission === 'denied' && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-4 px-4">
              <h3 className="font-medium text-red-800 mb-2">Notifications Blocked</h3>
              <p className="text-sm text-red-700">
                You've blocked notifications for this site. To enable them:
              </p>
              <ol className="text-sm text-red-700 mt-2 ml-4 list-decimal space-y-1">
                <li>Tap the lock/info icon in your browser's address bar</li>
                <li>Find "Notifications" in site settings</li>
                <li>Change from "Block" to "Allow"</li>
                <li>Refresh this page</li>
              </ol>
            </CardContent>
          </Card>
        )}

        {/* What You'll Get */}
        <Card>
          <CardContent className="py-4 px-4">
            <h3 className="font-medium text-gray-900 mb-3">What you'll receive:</h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-blue-500" />
                New job assignments
              </li>
              <li className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-blue-500" />
                Schedule changes
              </li>
              <li className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-blue-500" />
                Urgent alerts
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-2 safe-area-pb">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <Link href="/tech" className="flex flex-col items-center py-2 text-gray-400">
            <Home className="h-5 w-5" />
            <span className="text-xs mt-1">Home</span>
          </Link>
          <Link href="/tech/schedule" className="flex flex-col items-center py-2 text-gray-400">
            <Calendar className="h-5 w-5" />
            <span className="text-xs mt-1">Schedule</span>
          </Link>
          <Link href="/tech/timesheet" className="flex flex-col items-center py-2 text-gray-400">
            <Clock className="h-5 w-5" />
            <span className="text-xs mt-1">Timesheet</span>
          </Link>
          <Link href="/tech/search" className="flex flex-col items-center py-2 text-gray-400">
            <Search className="h-5 w-5" />
            <span className="text-xs mt-1">Search</span>
          </Link>
          <Link href="/tech/more" className="flex flex-col items-center py-2 text-[#1f3b4d]">
            <MoreHorizontal className="h-5 w-5" />
            <span className="text-xs mt-1 font-medium">More</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
