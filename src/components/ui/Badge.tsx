import { ReactNode } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'orange' | 'green';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
  size?: 'sm' | 'md';
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-800',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  orange: 'bg-orange-100 text-orange-700',
  green: 'bg-emerald-100 text-emerald-700',
};

export function Badge({ children, variant = 'default', className = '', size = 'sm' }: BadgeProps) {
  const sizeStyles = size === 'sm' 
    ? 'px-2 py-0.5 text-xs' 
    : 'px-2.5 py-1 text-sm';
  
  return (
    <span 
      className={`
        inline-flex items-center rounded-full font-medium
        ${sizeStyles}
        ${variantStyles[variant]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}

// Jobber-style job status badges
export type JobStatus = 
  | 'scheduled' 
  | 'in_progress' 
  | 'completed' 
  | 'invoiced'
  | 'late'
  | 'action_required'
  | 'requires_invoicing'
  | 'unscheduled'
  | 'upcoming'
  | 'archived';

export function JobStatusBadge({ status, showDot = false }: { status: string; showDot?: boolean }) {
  const statusConfig: Record<string, { label: string; variant: BadgeVariant; dotColor?: string }> = {
    // Core statuses
    scheduled: { label: 'Scheduled', variant: 'info', dotColor: 'bg-blue-500' },
    in_progress: { label: 'In Progress', variant: 'warning', dotColor: 'bg-yellow-500' },
    completed: { label: 'Completed', variant: 'success', dotColor: 'bg-green-500' },
    invoiced: { label: 'Invoiced', variant: 'default', dotColor: 'bg-gray-500' },
    
    // Jobber-style action statuses
    late: { label: 'Late', variant: 'danger', dotColor: 'bg-red-500' },
    action_required: { label: 'Action Required', variant: 'orange', dotColor: 'bg-orange-500' },
    requires_invoicing: { label: 'Requires Invoicing', variant: 'purple', dotColor: 'bg-purple-500' },
    unscheduled: { label: 'Unscheduled', variant: 'warning', dotColor: 'bg-yellow-500' },
    upcoming: { label: 'Upcoming', variant: 'info', dotColor: 'bg-blue-500' },
    archived: { label: 'Archived', variant: 'default', dotColor: 'bg-gray-400' },
  };

  const config = statusConfig[status] || { label: status, variant: 'default' as BadgeVariant };

  return (
    <Badge variant={config.variant}>
      {showDot && config.dotColor && (
        <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${config.dotColor}`} />
      )}
      {config.label}
    </Badge>
  );
}

// Specific badge for invoice status - matches Jobber
export function InvoiceStatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { label: string; variant: BadgeVariant }> = {
    draft: { label: 'Draft', variant: 'default' },
    sent: { label: 'Sent', variant: 'info' },
    viewed: { label: 'Viewed', variant: 'purple' },
    paid: { label: 'Paid', variant: 'success' },
    overdue: { label: 'Past Due', variant: 'danger' },
    partial: { label: 'Partial Payment', variant: 'warning' },
    void: { label: 'Void', variant: 'default' },
    bad_debt: { label: 'Bad Debt', variant: 'danger' },
  };

  const config = statusConfig[status] || { label: status, variant: 'default' as BadgeVariant };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

// Specific badge for quote status - matches Jobber
export function QuoteStatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { label: string; variant: BadgeVariant }> = {
    draft: { label: 'Draft', variant: 'default' },
    sent: { label: 'Awaiting Response', variant: 'info' },
    accepted: { label: 'Approved', variant: 'success' },
    declined: { label: 'Declined', variant: 'danger' },
    expired: { label: 'Expired', variant: 'warning' },
    changes_requested: { label: 'Changes Requested', variant: 'orange' },
  };

  const config = statusConfig[status] || { label: status, variant: 'default' as BadgeVariant };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

// Priority badge
export function PriorityBadge({ priority }: { priority: string }) {
  const priorityConfig: Record<string, { label: string; variant: BadgeVariant }> = {
    low: { label: 'Low', variant: 'default' },
    normal: { label: 'Normal', variant: 'info' },
    high: { label: 'High', variant: 'warning' },
    urgent: { label: 'Urgent', variant: 'danger' },
  };

  const config = priorityConfig[priority] || { label: priority, variant: 'default' as BadgeVariant };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

// Customer status badge
export function CustomerStatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { label: string; variant: BadgeVariant }> = {
    lead: { label: 'Lead', variant: 'purple' },
    active: { label: 'Active', variant: 'success' },
    inactive: { label: 'Inactive', variant: 'default' },
    archived: { label: 'Archived', variant: 'default' },
  };

  const config = statusConfig[status] || { label: status, variant: 'default' as BadgeVariant };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}
