'use client';

import { Bell, Search, Plus, X, Check } from 'lucide-react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { useNotifications } from '@/contexts/NotificationContext';
import { useSearch } from '@/contexts/SearchContext';
import { formatDistanceToNow } from 'date-fns';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/customers': 'Customers',
  '/jobs': 'Jobs',
  '/schedule': 'Schedule',
  '/invoices': 'Invoices',
  '/properties': 'Properties',
  '/settings': 'Settings',
  '/reports': 'Reports',
  '/dispatch': 'Dispatch',
};

const quickActions: Record<string, { href: string; label: string }> = {
  '/customers': { href: '/customers/new', label: 'Add Customer' },
  '/jobs': { href: '/jobs/new', label: 'Create Job' },
};

export default function Header() {
  const pathname = usePathname();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const { openSearch } = useSearch();
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Get page title, handling dynamic routes
  let pageTitle = pageTitles[pathname] || 'Dashboard';
  if (pathname.startsWith('/customers/') && pathname !== '/customers/new') {
    pageTitle = 'Customer Details';
  } else if (pathname.startsWith('/jobs/') && pathname !== '/jobs/new') {
    pageTitle = 'Job Details';
  } else if (pathname.startsWith('/settings/')) {
    pageTitle = 'Settings';
  } else if (pathname.startsWith('/reports/')) {
    pageTitle = 'Reports';
  }

  const quickAction = quickActions[pathname];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const recentNotifications = notifications.slice(0, 5);

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'job_assigned':
        return '📋';
      case 'job_reminder':
        return '⏰';
      case 'invoice_paid':
        return '💰';
      case 'customer_created':
        return '👤';
      default:
        return '🔔';
    }
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold text-gray-900">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-4">
        {/* Search */}
        <button
          onClick={openSearch}
          className="relative flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Search...</span>
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-gray-100 px-1.5 font-mono text-[10px] font-medium text-gray-500">
            ⌘K
          </kbd>
        </button>

        {/* Quick action button */}
        {quickAction && (
          <Link
            href={quickAction.href}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {quickAction.label}
          </Link>
        )}

        {/* Notifications */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-medium text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Notification Dropdown */}
          {showNotifications && (
            <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-gray-200 bg-white shadow-lg z-50">
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <h3 className="font-semibold text-gray-900">Notifications</h3>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    Mark all as read
                  </button>
                )}
              </div>
              
              <div className="max-h-96 overflow-y-auto">
                {recentNotifications.length === 0 ? (
                  <div className="p-4 text-center text-sm text-gray-500">
                    No notifications
                  </div>
                ) : (
                  recentNotifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`flex gap-3 border-b border-gray-100 p-4 hover:bg-gray-50 transition-colors ${
                        !notification.read ? 'bg-blue-50/50' : ''
                      }`}
                    >
                      <span className="text-lg">{getNotificationIcon(notification.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${!notification.read ? 'font-medium' : ''} text-gray-900`}>
                          {notification.title}
                        </p>
                        <p className="text-sm text-gray-600 truncate">{notification.message}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      {!notification.read && (
                        <button
                          onClick={() => markAsRead(notification.id)}
                          className="text-gray-400 hover:text-gray-600"
                          title="Mark as read"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
              
              <div className="border-t border-gray-200 p-2">
                <Link
                  href="/notifications"
                  className="block w-full rounded-lg py-2 text-center text-sm text-blue-600 hover:bg-gray-50"
                  onClick={() => setShowNotifications(false)}
                >
                  View all notifications
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
