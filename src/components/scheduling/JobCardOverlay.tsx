'use client';

import type { Job } from '@/types/database';
import { getPropertyById, getCustomerById, getJobTypeByName } from '@/lib/mock-data';
import { Clock, MapPin, AlertTriangle, GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

interface JobCardOverlayProps {
  job: Job;
}

export function JobCardOverlay({ job }: JobCardOverlayProps) {
  const property = getPropertyById(job.property_id);
  const customer = property ? getCustomerById(property.customer_id) : null;
  const jobType = getJobTypeByName(job.job_type);

  const getPriorityIndicator = () => {
    if (job.priority === 'urgent') {
      return <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />;
    }
    if (job.priority === 'high') {
      return <div className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />;
    }
    return null;
  };

  return (
    <div
      className="bg-white rounded-lg border shadow-xl overflow-hidden cursor-grabbing w-[280px]"
      style={{ transform: 'rotate(3deg)' }}
    >
      {/* Color indicator bar */}
      <div
        className="h-1"
        style={{ backgroundColor: jobType?.color || '#3B82F6' }}
      />
      
      <div className="p-3">
        {/* Header */}
        <div className="flex items-start gap-2">
          <div className="p-1 -ml-1 text-gray-400">
            <GripVertical className="h-4 w-4" />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 text-sm truncate">
                {job.job_type}
              </span>
              {getPriorityIndicator()}
            </div>
            <p className="text-sm text-gray-600 truncate">
              {customer?.name || 'Unknown Customer'}
            </p>
          </div>
        </div>

        {/* Details */}
        <div className="mt-2 space-y-1">
          {property && (
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{property.city || property.address}</span>
            </div>
          )}
          
          <div className="flex items-center justify-between text-xs">
            {job.scheduled_time && (
              <div className="flex items-center gap-1 text-gray-500">
                <Clock className="h-3 w-3" />
                <span>{job.scheduled_time}</span>
              </div>
            )}
            {job.estimated_duration && (
              <span className="text-gray-400">{job.estimated_duration}</span>
            )}
          </div>
        </div>

        {/* Status Badge */}
        <div className="mt-2">
          <Badge
            variant={
              job.status === 'in_progress' ? 'warning' :
              job.status === 'completed' ? 'success' : 'info'
            }
          >
            {job.status.replace('_', ' ')}
          </Badge>
        </div>
      </div>
    </div>
  );
}
