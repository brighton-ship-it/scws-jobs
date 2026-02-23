'use client';

import type { Job } from '@/types/database';
import { Clock, MapPin, AlertTriangle, GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// Extended job type with included relations from API
interface JobWithRelations extends Job {
  property?: {
    id: string;
    address: string;
    city?: string;
    customer?: {
      id: string;
      name: string;
    };
  };
  customer_name?: string;
  service_address?: string;
}

interface JobCardOverlayProps {
  job: JobWithRelations;
}

// Job type color mapping
const JOB_TYPE_COLORS: Record<string, string> = {
  'Well Inspection': '#0d9488',
  'Pump Installation': '#2563eb',
  'Pump Repair': '#7c3aed',
  'Water Testing': '#059669',
  'Emergency Service': '#dc2626',
  'Maintenance': '#d97706',
  'Consultation': '#6366f1',
  'Well Drilling': '#0891b2',
  'default': '#3B82F6',
};

export function JobCardOverlay({ job }: JobCardOverlayProps) {
  // Use included property/customer data or fallback to direct fields
  const customerName = job.property?.customer?.name || job.customer_name || 'Unknown Customer';
  const location = job.property?.city || job.property?.address || job.service_address || '';
  const jobTypeColor = JOB_TYPE_COLORS[job.job_type] || JOB_TYPE_COLORS['default'];

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
        style={{ backgroundColor: jobTypeColor }}
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
              {customerName}
            </p>
          </div>
        </div>

        {/* Details */}
        <div className="mt-2 space-y-1">
          {location && (
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{location}</span>
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
