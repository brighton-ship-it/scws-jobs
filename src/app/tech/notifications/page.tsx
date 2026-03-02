'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { createClient } from '@/lib/supabase/client';
import {
  Bell,
  BellRing,
  Home,
  Calendar,
  Clock,
  Search,
  MoreHorizontal,
  ChevronLeft,
  Phone,
  CalendarCheck,
  DollarSign,
  AlertCircle,
  Trash2,
  Check,
  RefreshCw,
  Settings,
  Loader2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  id: string;
  type: 'call' | 'booking' | 'task' | 'payment' | 'system';
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  read: boolean;
  created_at: string;
}

const typeIcons: Record<string, { icon: typeof Bell; color: string }> = {
  call: { icon: Phone, color: 'bg-blue-100 text-blue-600' },
  booking: { icon: CalendarCheck, color: 'bg-green-100 text-green-600' },
  task: { icon: AlertCircle, color: 'bg-yellow-100 text-yellow-600' },
  payment: { icon: DollarSign, color: 'bg-emerald-100 text-emerald-600' },
  system: { icon: Bell, color: 'bg-gray-100 text-gray-600' },
};

export default function TechNotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushLoading, setPushLoading] = useState(false);
  const supabase = createClient();
  
  const {
    isSupported: pushSupported,
    permission: pushPermission,
    isSubscribed: pushSubscribed,
    subscribe: subscribeToPush,
  } = usePushNotifications();

  const fetchNotifications = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (data) {
      setNotifications(data);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchNotifications();

    // Subscribe to new notifications
    const channel = supabase
      .channel('tech-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        fetchNotifications();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchNotifications, supabase]);

  const markAsRead = async (id: string) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAllAsRead = async () => {
    await supabase.from('notifications').update({ read: true }).eq('read', false);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const deleteNotification = async (id: string) => {
    await supabase.from('notifications').delete().eq('id', id);
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const navigateToEntity = (notification: Notification) => {
    if (notification.entity_type && notification.entity_id) {
      const routeMap: Record<string, string> = {
        customer: '/customers',
        booking_request: '/requests',
        job: '/tech/jobs',
        invoice: '/invoices',
        quote: '/quotes',
      };
      const route = routeMap[notification.entity_type] || `/${notification.entity_type}s`;
      window.location.href = `${route}/${notification.entity_id}`;
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white px-4 pt-6 pb-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/tech/more" className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ChevronLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[#1f3b4d]">Notifications</h1>
            {unreadCount > 0 && (
              <p className="text-sm text-gray-500">{unreadCount} unread</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
              title="Mark all read"
            >
              <Check className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={fetchNotifications}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
            title="Refresh"
          >
            <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Link
            href="/tech/settings"
            className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </div>

      {/* Push Notification Banner */}
      {pushSupported && !pushSubscribed && (
        <div className="mx-4 mt-4">
          <Card className="bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0">
            <CardContent className="py-4 px-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                  <BellRing className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">Enable Push Notifications</h3>
                  <p className="text-sm text-blue-100">
                    Get notified about new jobs, schedule changes & more
                  </p>
                </div>
                <button
                  onClick={async () => {
                    setPushLoading(true);
                    await subscribeToPush(user?.id);
                    setPushLoading(false);
                  }}
                  disabled={pushLoading}
                  className="px-4 py-2 bg-white text-blue-600 rounded-lg font-medium text-sm hover:bg-blue-50 disabled:opacity-50 flex items-center gap-2"
                >
                  {pushLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Enabling...
                    </>
                  ) : (
                    'Enable'
                  )}
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* Show success message if subscribed */}
      {pushSupported && pushSubscribed && (
        <div className="mx-4 mt-4">
          <Card className="bg-green-50 border-green-200">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <Check className="h-5 w-5 text-green-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-green-800">Push notifications enabled</p>
                  <p className="text-sm text-green-600">You'll receive alerts on this device</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : notifications.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Bell className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="font-medium text-gray-900">No notifications yet</h3>
              <p className="text-sm text-gray-500 mt-1">
                You'll see calls, booking requests, and alerts here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {notifications.map((notification) => {
              const config = typeIcons[notification.type] || typeIcons.system;
              const Icon = config.icon;

              return (
                <Card
                  key={notification.id}
                  className={`cursor-pointer transition-colors ${
                    !notification.read ? 'bg-blue-50 border-blue-200' : ''
                  } ${notification.priority === 'urgent' ? 'border-l-4 border-l-red-500' : ''}`}
                  onClick={() => {
                    markAsRead(notification.id);
                    if (notification.entity_type && notification.entity_id) {
                      navigateToEntity(notification);
                    }
                  }}
                >
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start gap-3">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-medium truncate ${!notification.read ? 'text-gray-900' : 'text-gray-700'}`}>
                            {notification.title}
                          </p>
                          {notification.priority === 'urgent' && (
                            <span className="px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded">
                              URGENT
                            </span>
                          )}
                        </div>
                        {notification.message && (
                          <p className="text-sm text-gray-600 truncate">{notification.message}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNotification(notification.id);
                        }}
                        className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
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
