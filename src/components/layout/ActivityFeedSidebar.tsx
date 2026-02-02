'use client';

import { useActivityFeed } from '@/contexts/ActivityFeedContext';
import { getRecentActivity, getUserById } from '@/lib/mock-data';
import { formatDistanceToNow } from 'date-fns';
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
} from 'lucide-react';

// Activity type icons matching Jobber style
const activityIcons = {
  job: { icon: Briefcase, color: 'bg-blue-50 text-blue-600', label: 'Job' },
  invoice: { icon: DollarSign, color: 'bg-emerald-50 text-emerald-600', label: 'Invoice' },
  customer: { icon: User, color: 'bg-purple-50 text-purple-600', label: 'Customer' },
  quote: { icon: FileText, color: 'bg-amber-50 text-amber-600', label: 'Quote' },
  payment: { icon: CheckCircle, color: 'bg-emerald-50 text-emerald-600', label: 'Payment' },
  schedule: { icon: Clock, color: 'bg-blue-50 text-blue-600', label: 'Schedule' },
  sent: { icon: Send, color: 'bg-indigo-50 text-indigo-600', label: 'Sent' },
};

export function ActivityFeedSidebar() {
  const { isOpen, close } = useActivityFeed();
  const activities = getRecentActivity(20);

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
              className="text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors flex items-center gap-1"
            >
              <Settings2 className="h-4 w-4" />
              Customize Feed
            </button>
            <button
              onClick={close}
              className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Activity List */}
        <div className="flex-1 overflow-y-auto">
          {activities.length === 0 ? (
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
                const config = activityIcons[activity.entity_type as keyof typeof activityIcons] || {
                  icon: Activity,
                  color: 'bg-gray-50 text-gray-600',
                  label: 'Activity',
                };
                const Icon = config.icon;
                const user = getUserById(activity.user_id);

                return (
                  <div 
                    key={activity.id}
                    className="px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`rounded-lg p-2 flex-shrink-0 ${config.color}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 leading-snug">{activity.description}</p>
                        
                        {/* Status badge if applicable */}
                        {activity.entity_type === 'job' && (
                          <span className="inline-flex items-center mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                            Completed
                          </span>
                        )}
                        {activity.entity_type === 'invoice' && (
                          <span className="inline-flex items-center mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            Sent
                          </span>
                        )}
                        
                        <div className="flex items-center gap-2 mt-1.5">
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
