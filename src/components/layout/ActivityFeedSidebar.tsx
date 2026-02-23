'use client';

import { useState, useEffect } from 'react';
import { useActivityFeed } from '@/contexts/ActivityFeedContext';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { 
  X, 
  Settings2,
  Briefcase, 
  DollarSign, 
  User, 
  FileText,
  Activity,
  CheckCircle,
  Clock,
  Send,
  Inbox,
  Loader2,
  RefreshCw,
} from 'lucide-react';

// Activity type icons matching Jobber style
const activityIcons: Record<string, { icon: any; color: string; label: string }> = {
  job: { icon: Briefcase, color: 'bg-blue-50 text-blue-600', label: 'Job' },
  invoice: { icon: DollarSign, color: 'bg-amber-50 text-amber-600', label: 'Invoice' },
  customer: { icon: User, color: 'bg-purple-50 text-purple-600', label: 'Customer' },
  quote: { icon: FileText, color: 'bg-indigo-50 text-indigo-600', label: 'Quote' },
  payment: { icon: CheckCircle, color: 'bg-emerald-50 text-emerald-600', label: 'Payment' },
  schedule: { icon: Clock, color: 'bg-blue-50 text-blue-600', label: 'Schedule' },
  sent: { icon: Send, color: 'bg-indigo-50 text-indigo-600', label: 'Sent' },
  booking: { icon: Inbox, color: 'bg-orange-50 text-orange-600', label: 'Booking' },
};

interface Activity {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  entity_id: string;
  entity_type: string;
  user_name?: string;
}

export function ActivityFeedSidebar() {
  const { isOpen, close } = useActivityFeed();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchActivities = async () => {
    try {
      const res = await fetch('/api/activity?limit=30');
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
    } catch (error) {
      console.error('Failed to fetch activities:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchActivities();
    }
  }, [isOpen]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchActivities();
  };

  // Helper to get link for activity
  const getActivityLink = (activity: Activity): string => {
    switch (activity.entity_type) {
      case 'job': return `/jobs/${activity.entity_id}`;
      case 'invoice': return `/invoices/${activity.entity_id}`;
      case 'quote': return `/quotes/${activity.entity_id}`;
      case 'customer': return `/customers/${activity.entity_id}`;
      case 'booking': return `/requests`;
      default: return '#';
    }
  };

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={close}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed right-0 top-0 h-full w-80 bg-white border-l border-gray-200
        transform transition-transform duration-300 ease-in-out z-50
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        flex flex-col
      `}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Activity Feed</h2>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={close}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Activity List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 px-4 text-center">
              <Loader2 className="h-8 w-8 text-gray-400 animate-spin mb-3" />
              <p className="text-sm text-gray-500">Loading activity...</p>
            </div>
          ) : activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-4 text-center">
              <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                <Activity className="h-6 w-6 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-900">No recent activity</p>
              <p className="text-xs text-gray-500 mt-1">Activity will appear here as you work</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {activities.map((activity) => {
                const config = activityIcons[activity.type] || {
                  icon: Activity,
                  color: 'bg-gray-50 text-gray-600',
                  label: 'Activity',
                };
                const Icon = config.icon;
                const link = getActivityLink(activity);

                return (
                  <Link 
                    key={activity.id}
                    href={link}
                    onClick={close}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className={`rounded-lg p-2 ${config.color} flex-shrink-0`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 leading-snug line-clamp-2">
                        {activity.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400">
                          {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                        </span>
                        {activity.user_name && (
                          <>
                            <span className="text-gray-300">•</span>
                            <span className="text-xs text-gray-400">{activity.user_name}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {activities.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
            <p className="text-xs text-gray-500 text-center">
              Showing latest {activities.length} activities
            </p>
          </div>
        )}
      </div>
    </>
  );
}
