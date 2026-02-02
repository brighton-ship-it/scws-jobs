'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { getRecentActivity, getUserById } from '@/lib/mock-data';
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
} from 'lucide-react';

// Jobber-style activity icons
const activityIcons = {
  job: { icon: Briefcase, color: 'bg-blue-50 text-blue-600' },
  invoice: { icon: DollarSign, color: 'bg-emerald-50 text-emerald-600' },
  customer: { icon: User, color: 'bg-purple-50 text-purple-600' },
  quote: { icon: FileText, color: 'bg-amber-50 text-amber-600' },
  payment: { icon: CheckCircle, color: 'bg-emerald-50 text-emerald-600' },
  schedule: { icon: Clock, color: 'bg-blue-50 text-blue-600' },
  sent: { icon: Send, color: 'bg-indigo-50 text-indigo-600' },
};

interface ActivityFeedProps {
  limit?: number;
  showHeader?: boolean;
  showViewAll?: boolean;
}

export function ActivityFeed({ limit = 5, showHeader = true, showViewAll = false }: ActivityFeedProps) {
  const activities = getRecentActivity(limit);

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
          const config = activityIcons[activity.entity_type as keyof typeof activityIcons] || {
            icon: Activity,
            color: 'bg-gray-50 text-gray-600',
          };
          const Icon = config.icon;
          const user = getUserById(activity.user_id);
          const isLast = index === activities.length - 1;

          return (
            <div 
              key={activity.id} 
              className={`flex items-start gap-3 py-3 ${!isLast ? 'border-b border-gray-50' : ''}`}
            >
              <div className={`rounded-lg p-2 ${config.color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 leading-snug">{activity.description}</p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-xs text-gray-400">
                    {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                  </p>
                  {user && (
                    <>
                      <span className="text-gray-300">•</span>
                      <p className="text-xs text-gray-400">{user.name}</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// Compact version for sidebars
export function ActivityFeedCompact({ limit = 3 }: { limit?: number }) {
  const activities = getRecentActivity(limit);

  if (activities.length === 0) {
    return (
      <div className="text-center py-6">
        <Activity className="mx-auto h-8 w-8 text-gray-300" />
        <p className="mt-2 text-xs text-gray-500">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activities.map((activity) => {
        const config = activityIcons[activity.entity_type as keyof typeof activityIcons] || {
          icon: Activity,
          color: 'bg-gray-50 text-gray-600',
        };
        const Icon = config.icon;

        return (
          <div key={activity.id} className="flex items-start gap-2">
            <div className={`rounded p-1.5 ${config.color}`}>
              <Icon className="h-3 w-3" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-600 line-clamp-2">{activity.description}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
