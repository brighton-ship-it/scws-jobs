'use client';

import { JobAssignmentWithUser } from '@/types/database';
import { format } from 'date-fns';
import { UserPlus, Clock, MessageSquare } from 'lucide-react';

interface AssignmentHistoryProps {
  assignments: JobAssignmentWithUser[];
  className?: string;
}

export function AssignmentHistory({ assignments, className = '' }: AssignmentHistoryProps) {
  if (assignments.length === 0) {
    return (
      <div className={`text-center py-6 text-gray-400 ${className}`}>
        <UserPlus className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No assignments yet</p>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {assignments.map((assignment) => (
        <div
          key={assignment.id}
          className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100"
        >
          {/* Avatar */}
          <div className="h-10 w-10 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-medium flex-shrink-0">
            {assignment.user.name.charAt(0)}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-900">
                {assignment.user.name}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded capitalize ${
                assignment.user.role === 'field' 
                  ? 'bg-green-100 text-green-700' 
                  : assignment.user.role === 'admin'
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-blue-100 text-blue-700'
              }`}>
                {assignment.user.role}
              </span>
            </div>

            {/* Timestamp and assigned by */}
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
              <Clock className="h-3 w-3" />
              <span>
                Assigned {format(new Date(assignment.assigned_at), 'MMM d, yyyy \'at\' h:mm a')}
              </span>
              {assignment.assigned_by_user && (
                <span>by {assignment.assigned_by_user.name}</span>
              )}
            </div>

            {/* Notes */}
            {assignment.notes && (
              <div className="flex items-start gap-1.5 mt-2 text-sm text-gray-600">
                <MessageSquare className="h-3.5 w-3.5 mt-0.5 text-gray-400" />
                <span>{assignment.notes}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default AssignmentHistory;
