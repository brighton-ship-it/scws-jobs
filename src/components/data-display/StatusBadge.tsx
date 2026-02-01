import React from 'react';

export type StatusVariant = 
  | 'pending' 
  | 'scheduled' 
  | 'in-progress' 
  | 'completed' 
  | 'cancelled'
  | 'draft'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'partial'
  | 'active'
  | 'inactive'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export interface StatusBadgeProps {
  status: StatusVariant | string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  dot?: boolean;
  className?: string;
}

const statusStyles: Record<StatusVariant, { bg: string; text: string; dot: string }> = {
  // Job statuses
  pending: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  scheduled: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  'in-progress': { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  cancelled: { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-500' },
  
  // Invoice statuses
  draft: { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-500' },
  sent: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  paid: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  overdue: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
  partial: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  
  // Generic statuses
  active: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  inactive: { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-500' },
  success: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  warning: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  error: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
  info: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
};

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-xs',
  lg: 'px-3 py-1.5 text-sm',
};

export function StatusBadge({
  status,
  label,
  size = 'md',
  dot = false,
  className = '',
}: StatusBadgeProps) {
  const normalizedStatus = status.toLowerCase().replace(/\s+/g, '-') as StatusVariant;
  const styles = statusStyles[normalizedStatus] || statusStyles.info;
  const displayLabel = label || status.charAt(0).toUpperCase() + status.slice(1).replace(/-/g, ' ');

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 font-medium rounded-full
        ${styles.bg} ${styles.text} ${sizeClasses[size]}
        ${className}
      `}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
      )}
      {displayLabel}
    </span>
  );
}

export default StatusBadge;
