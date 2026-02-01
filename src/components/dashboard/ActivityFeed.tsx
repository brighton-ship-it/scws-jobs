'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/forms/Button';
import { getRecentActivity, getUserById } from '@/lib/mock-data';
import { formatDistanceToNow } from 'date-fns';
import { 
  Briefcase, 
  DollarSign, 
  User, 
  FileText,
  ArrowRight,
  Activity,
} from 'lucide-react';

const activityIcons = {
  job: { icon: Briefcase, color: 'bg-blue-100 text-blue-600' },
  invoice: { icon: DollarSign, color: 'bg-green-100 text-green-600' },
  customer: { icon: User, color: 'bg-purple-100 text-purple-600' },
  quote: { icon: FileText, color: 'bg-orange-100 text-orange-600' },
};

interface ActivityFeedProps {
  limit?: number;
  showHeader?: boolean;
}

export function ActivityFeed({ limit = 5, showHeader = true }: ActivityFeedProps) {
  const activities = getRecentActivity(limit);

  if (activities.length === 0) {
    return (
      <Card>
        {showHeader && (
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
        )}
        <CardContent className="py-8 text-center">
          <Activity className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">No recent activity</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {showHeader && (
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
      )}
      <CardContent className="space-y-4">
        {activities.map((activity) => {
          const config = activityIcons[activity.entity_type as keyof typeof activityIcons] || {
            icon: Activity,
            color: 'bg-gray-100 text-gray-600',
          };
          const Icon = config.icon;
          const user = getUserById(activity.user_id);

          return (
            <div key={activity.id} className="flex items-start gap-3">
              <div className={`rounded-lg p-2 ${config.color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900">{activity.description}</p>
                <p className="text-xs text-gray-500">
                  {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                </p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
