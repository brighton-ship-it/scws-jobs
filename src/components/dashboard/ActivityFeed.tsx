'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { 
  Briefcase, 
  DollarSign, 
  User, 
  FileText,
  ArrowRight,
  Activity,
  CheckCircle,
  Clock,
  Send,
  Inbox,
  Loader2,
} from 'lucide-react';

// Activity type icons and colors
const activityIcons = {
  job: { icon: Briefcase, color: 'bg-blue-50 text-blue-600' },
  invoice: { icon: DollarSign, color: 'bg-amber-50 text-amber-600' },
  customer: { icon: User, color: 'bg-purple-50 text-purple-600' },
  quote: { icon: FileText, color: 'bg-indigo-50 text-indigo-600' },
  payment: { icon: CheckCircle, color: 'bg-emerald-50 text-emerald-600' },
  schedule: { icon: Clock, color: 'bg-blue-50 text-blue-600' },
  sent: { icon: Send, color: 'bg-indigo-50 text-indigo-600' },
  booking: { icon: Inbox, color: 'bg-orange-50 text-orange-600' },
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

interface ActivityFeedProps {
  limit?: number;
  showHeader?: boolean;
  showViewAll?: boolean;
}

export function ActivityFeed({ limit = 5, showHeader = true, showViewAll = false }: ActivityFeedProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const res = await fetch(`/api/activity?limit=${limit}`);
        if (res.ok) {
          const data = await res.json();
          setActivities(data.activities || []);
        }
      } catch (error) {
        console.error('Failed to fetch activity:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchActivity();
  }, [limit]);

  if (loading) {
    return (
      <Card>
        {showHeader && (
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
        )}
        <CardContent className="py-10 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-gray-400" />
        </CardContent>
      </Card>
    );
  }

  if (activities.length === 0) {
    return (
      <Card>
        {showHeader && (
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
        )}
        <CardContent className="py-10 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
            <Activity className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-900">No recent activity</p>
          <p className="text-xs text-gray-500 mt-1">Activity will appear here as you work</p>
        </CardContent>
      </Card>
    );
  }

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
    <Card>
      {showHeader && (
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Recent Activity</CardTitle>
          {showViewAll && (
            <Link 
              href="/activity" 
              className="text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors flex items-center gap-1"
            >
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </CardHeader>
      )}
      <CardContent className="space-y-1 pt-0">
        {activities.map((activity, index) => {
          const config = activityIcons[activity.type as keyof typeof activityIcons] || {
            icon: Activity,
            color: 'bg-gray-50 text-gray-600',
          };
          const Icon = config.icon;
          const isLast = index === activities.length - 1;
          const link = getActivityLink(activity);

          return (
            <Link 
              key={activity.id}
              href={link}
              className={`flex items-start gap-3 py-3 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors ${!isLast ? 'border-b border-gray-50' : ''}`}
            >
              <div className={`rounded-lg p-2 ${config.color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 leading-snug">{activity.description}</p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-xs text-gray-400">
                    {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                  </p>
                  {activity.user_name && (
                    <>
                      <span className="text-gray-300">•</span>
                      <p className="text-xs text-gray-400">{activity.user_name}</p>
                    </>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
