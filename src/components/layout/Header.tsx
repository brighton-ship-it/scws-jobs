'use client';

import { Bell, Search, Plus, X, Check, Menu, Activity, Settings, HelpCircle } from 'lucide-react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { useNotifications } from '@/contexts/NotificationContext';
import { useSearch } from '@/contexts/SearchContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { useActivityFeed } from '@/contexts/ActivityFeedContext';
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
  '/quotes': 'Quotes',
  '/tasks': 'Tasks',
  '/requests': 'Requests',
  '/inventory': 'Inventory',
  '/well-tools': 'Well Tools',
};

const quickActions: Record<string, { href: string; label: string }> = {
  '/customers': { href: '/customers/new', label: 'Add Customer' },
  '/jobs': { href: '/jobs/new', label: 'Create Job' },
  '/quotes': { href: '/quotes/new', label: 'New Quote' },
  '/invoices': { href: '/invoices/new', label: 'New Invoice' },
};

export default function Header() {
  const pathname = usePathname();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const { openSearch } = useSearch();
  const { toggle: toggleSidebar } = useSidebar();
  const { isOpen: isActivityFeedOpen, toggle: toggleActivityFeed } = useActivityFeed();
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
  } else if (pathname.startsWith('/quotes/') && pathname !== '/quotes/new') {
    pageTitle = 'Quote Details';
  } else if (pathname.startsWith('/invoices/') && pathname !== '/invoices/new') {
    pageTitle = 'Invoice Details';
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
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 lg:px-6">
      <div className="flex items-center gap-3">
        {/* Mobile menu button */}
        <button
          onClick={toggleSidebar}
          className="lg:hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-lg lg:text-xl font-semibold text-gray-900">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Search - Jobber style */}
        <button
          onClick={openSearch}
          className="relative flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 hover:border-gray-300 transition-all"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Search...</span>
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-gray-200 bg-white px-1.5 font-mono text-[10px] font-medium text-gray-400">
            ⌘K
          </kbd>
        </button>

        {/* Quick action button - Jobber green */}
        {quickAction && (
          <Link
            href={quickAction.href}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{quickAction.label}</span>
          </Link>
        )}

        {/* Divider */}
        <div className="hidden sm:block h-6 w-px bg-gray-200 mx-1" />

        {/* Activity Feed Toggle */}
        <button
          onClick={toggleActivityFeed}
          className={`rounded-lg p-2 transition-colors ${
            isActivityFeedOpen 
              ? 'bg-emerald-100 text-emerald-700' 
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
          }`}
          title="Activity Feed"
        >
          <Activity className="h-5 w-5" />
        </button>

        {/* Notifications */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => {
              setShowNotifications(!showNotifications)
              // Mark all as read when opening dropdown
              if (!showNotifications && unreadCount > 0) {
                setTimeout(() => markAllAsRead(), 2000) // Auto-clear after 2 sec
              }
            }}
            className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="Notifications"
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
            <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-gray-200 bg-white shadow-lg z-50">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <h3 className="font-semibold text-gray-900">Notifications</h3>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
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
                  recentNotifications.map((notification) => {
                    // Determine link based on entity type
                    const getNotificationLink = () => {
                      if (notification.entity_type === 'customer' && notification.entity_id) {
                        return `/customers/${notification.entity_id}`
                      }
                      if (notification.entity_type === 'job' && notification.entity_id) {
                        return `/jobs/${notification.entity_id}`
                      }
                      if (notification.entity_type === 'booking_request') {
                        return '/requests'
                      }
                      if (notification.type === 'call') {
                        return '/requests'
                      }
                      if (notification.type === 'booking') {
                        return '/requests'
                      }
                      return null
                    }
                    const link = getNotificationLink()
                    
                    return (
                      <div
                        key={notification.id}
                        onClick={() => {
                          markAsRead(notification.id)
                          if (link) {
                            setShowNotifications(false)
                            window.location.href = link
                          }
                        }}
                        className={`flex gap-3 border-b border-gray-50 p-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                          !notification.read ? 'bg-emerald-50/50' : ''
                        }`}
                      >
                        <span className="text-lg">{getNotificationIcon(notification.type)}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${!notification.read ? 'font-medium' : ''} text-gray-900`}>
                            {notification.title}
                          </p>
                          <p className="text-sm text-gray-500 truncate">{notification.message}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </p>
                        </div>
                        {link && (
                          <span className="text-gray-300">→</span>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
              
              <div className="border-t border-gray-100 p-2">
                <Link
                  href="/notifications"
                  className="block w-full rounded-lg py-2 text-center text-sm font-medium text-emerald-600 hover:bg-gray-50 transition-colors"
                  onClick={() => setShowNotifications(false)}
                >
                  View all notifications
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Help */}
        <button
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          title="Help"
        >
          <HelpCircle className="h-5 w-5" />
        </button>

        {/* Settings */}
        <Link
          href="/settings"
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          title="Settings"
        >
          <Settings className="h-5 w-5" />
        </Link>
      </div>
    </header>
  );
}
