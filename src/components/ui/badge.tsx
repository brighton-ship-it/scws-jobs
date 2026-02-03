import { ReactNode } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'orange' | 'green' | 'teal';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
  size?: 'sm' | 'md';
}

// Jobber-style badge colors - more subtle and professional
const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-600',
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20',
  danger: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20',
  info: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20',
  purple: 'bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-600/20',
  orange: 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-600/20',
  green: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20',
  teal: 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-600/20',
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
    in_progress: { label: 'In Progress', variant: 'warning', dotColor: 'bg-amber-500' },
    completed: { label: 'Completed', variant: 'success', dotColor: 'bg-emerald-500' },
    invoiced: { label: 'Invoiced', variant: 'teal', dotColor: 'bg-teal-500' },
    
    // Jobber-style action statuses
    late: { label: 'Late', variant: 'danger', dotColor: 'bg-red-500' },
    action_required: { label: 'Action Required', variant: 'orange', dotColor: 'bg-orange-500' },
    requires_invoicing: { label: 'Requires Invoicing', variant: 'purple', dotColor: 'bg-purple-500' },
    unscheduled: { label: 'Unscheduled', variant: 'warning', dotColor: 'bg-amber-500' },
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

// Recurring job badge
export function RecurringBadge() {
  return (
    <Badge variant="teal" className="gap-1">
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 0 1 9-9" />
      </svg>
      Recurring
    </Badge>
  );
}
