'use client';


import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/forms/Button';
import { useNotifications } from '@/contexts/NotificationContext';
import { formatDistanceToNow, format } from 'date-fns';
import { 
  Bell, 
  Check, 
  CheckCheck, 
  Trash2,
  Briefcase,
  Clock,
  DollarSign,
  User,
  Settings,
} from 'lucide-react';
import Link from 'next/link';

const notificationIcons = {
  job_assigned: { icon: Briefcase, color: 'bg-blue-100 text-blue-600' },
  job_reminder: { icon: Clock, color: 'bg-yellow-100 text-yellow-600' },
  invoice_paid: { icon: DollarSign, color: 'bg-green-100 text-green-600' },
  quote_accepted: { icon: Check, color: 'bg-purple-100 text-purple-600' },
  customer_created: { icon: User, color: 'bg-pink-100 text-pink-600' },
};

export default function NotificationsPage() {
  const { notifications, markAsRead, markAllAsRead, deleteNotification, unreadCount } = useNotifications();

  const groupedNotifications = notifications.reduce((groups, notification) => {
    const date = format(new Date(notification.created_at), 'yyyy-MM-dd');
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(notification);
    return groups;
  }, {} as Record<string, typeof notifications>);

  const sortedDates = Object.keys(groupedNotifications).sort((a, b) => b.localeCompare(a));

  const formatDateHeader = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (dateStr === format(today, 'yyyy-MM-dd')) {
      return 'Today';
    } else if (dateStr === format(yesterday, 'yyyy-MM-dd')) {
      return 'Yesterday';
    } else {
      return format(date, 'MMMM d, yyyy');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Notifications</h2>
          <p className="text-gray-600">
            {unreadCount > 0 ? `${unreadCount} unread notifications` : 'All caught up!'}
          </p>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button variant="outline" onClick={markAllAsRead}>
              <CheckCheck className="h-4 w-4 mr-2" />
              Mark all as read
            </Button>
          )}
          <Button variant="outline" href="/settings/notifications">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Bell className="mx-auto h-12 w-12 text-gray-300" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">No notifications</h3>
            <p className="mt-2 text-gray-500">
              You&apos;re all caught up! We&apos;ll notify you when something important happens.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {sortedDates.map((date) => (
            <div key={date}>
              <h3 className="mb-3 text-sm font-medium text-gray-500">
                {formatDateHeader(date)}
              </h3>
              <Card>
                <CardContent className="divide-y divide-gray-100 p-0">
                  {groupedNotifications[date].map((notification) => {
                    const config = notificationIcons[notification.type] || { 
                      icon: Bell, 
                      color: 'bg-gray-100 text-gray-600' 
                    };
                    const Icon = config.icon;

                    return (
                      <div
                        key={notification.id}
                        className={`flex items-start gap-4 p-4 ${
                          !notification.read ? 'bg-blue-50/50' : ''
                        }`}
                      >
                        <div className={`rounded-lg p-2 ${config.color}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`${!notification.read ? 'font-medium' : ''} text-gray-900`}>
                            {notification.title}
                          </p>
                          <p className="text-sm text-gray-600">{notification.message}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {!notification.read && (
                            <button
                              onClick={() => markAsRead(notification.id)}
                              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                              title="Mark as read"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteNotification(notification.id)}
                            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
