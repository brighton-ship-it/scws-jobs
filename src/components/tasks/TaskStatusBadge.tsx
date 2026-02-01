'use client';

import { Badge } from '@/components/ui/Badge';
import type { TaskStatus, TaskPriority } from '@/types/database';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'orange';

interface TaskStatusBadgeProps {
  status: TaskStatus;
  showDot?: boolean;
}

const statusConfig: Record<TaskStatus, { label: string; variant: BadgeVariant; dotColor: string }> = {
  pending: { label: 'Pending', variant: 'warning', dotColor: 'bg-yellow-500' },
  in_progress: { label: 'In Progress', variant: 'info', dotColor: 'bg-blue-500' },
  completed: { label: 'Completed', variant: 'success', dotColor: 'bg-green-500' },
};

export function TaskStatusBadge({ status, showDot = false }: TaskStatusBadgeProps) {
  const config = statusConfig[status] || { label: status, variant: 'default' as BadgeVariant, dotColor: 'bg-gray-500' };

  return (
    <Badge variant={config.variant}>
      {showDot && (
        <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${config.dotColor}`} />
      )}
      {config.label}
    </Badge>
  );
}

interface TaskPriorityBadgeProps {
  priority: TaskPriority;
}

const priorityConfig: Record<TaskPriority, { label: string; variant: BadgeVariant }> = {
  low: { label: 'Low', variant: 'default' },
  normal: { label: 'Normal', variant: 'info' },
  high: { label: 'High', variant: 'warning' },
  urgent: { label: 'Urgent', variant: 'danger' },
};

export function TaskPriorityBadge({ priority }: TaskPriorityBadgeProps) {
  const config = priorityConfig[priority] || { label: priority, variant: 'default' as BadgeVariant };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}
