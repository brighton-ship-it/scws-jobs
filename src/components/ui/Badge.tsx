import { ReactNode } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
};

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span 
      className={`
        inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
        ${variantStyles[variant]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}

// Specific badge for job status
export function JobStatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { label: string; variant: BadgeVariant }> = {
    scheduled: { label: 'Scheduled', variant: 'info' },
    in_progress: { label: 'In Progress', variant: 'warning' },
    completed: { label: 'Completed', variant: 'success' },
    invoiced: { label: 'Invoiced', variant: 'default' },
  };

  const config = statusConfig[status] || { label: status, variant: 'default' };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

// Specific badge for invoice status
export function InvoiceStatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { label: string; variant: BadgeVariant }> = {
    draft: { label: 'Draft', variant: 'default' },
    sent: { label: 'Sent', variant: 'info' },
    viewed: { label: 'Viewed', variant: 'purple' },
    paid: { label: 'Paid', variant: 'success' },
    overdue: { label: 'Overdue', variant: 'danger' },
    void: { label: 'Void', variant: 'default' },
  };

  const config = statusConfig[status] || { label: status, variant: 'default' };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

// Specific badge for quote status
export function QuoteStatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { label: string; variant: BadgeVariant }> = {
    draft: { label: 'Draft', variant: 'default' },
    sent: { label: 'Sent', variant: 'info' },
    accepted: { label: 'Accepted', variant: 'success' },
    declined: { label: 'Declined', variant: 'danger' },
    expired: { label: 'Expired', variant: 'warning' },
  };

  const config = statusConfig[status] || { label: status, variant: 'default' };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}
