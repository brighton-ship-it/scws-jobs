'use client';

import React from 'react';
import Link from 'next/link';
import { 
  Inbox, 
  Users, 
  Briefcase, 
  FileText, 
  Receipt, 
  Search, 
  Calendar,
  Package,
  Truck,
  CheckSquare,
  Plus
} from 'lucide-react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  secondaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  variant?: 'default' | 'compact' | 'card';
  className?: string;
}

// Pre-defined icons for common empty states
export const emptyStateIcons = {
  customers: Users,
  jobs: Briefcase,
  quotes: FileText,
  invoices: Receipt,
  search: Search,
  schedule: Calendar,
  requests: Inbox,
  inventory: Package,
  dispatch: Truck,
  tasks: CheckSquare,
  default: Inbox,
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  variant = 'default',
  className = '',
}: EmptyStateProps) {
  const iconElement = icon || <Inbox className="w-8 h-8" />;

  if (variant === 'compact') {
    return (
      <div className={`text-center py-8 ${className}`}>
        <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-3">
          {iconElement}
        </div>
        <p className="text-sm font-medium text-gray-900">{title}</p>
        {description && (
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        )}
        {action && (
          <div className="mt-4">
            {action.href ? (
              <Link
                href={action.href}
                className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                {action.label}
              </Link>
            ) : (
              <button
                onClick={action.onClick}
                className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                {action.label}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className={`bg-white rounded-xl border border-gray-100 p-8 text-center ${className}`}>
        <div className="mx-auto h-16 w-16 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 mb-4">
          {iconElement}
        </div>
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {description && (
          <p className="mt-2 text-sm text-gray-500 max-w-sm mx-auto">{description}</p>
        )}
        {(action || secondaryAction) && (
          <div className="mt-6 flex items-center justify-center gap-3">
            {secondaryAction && (
              secondaryAction.href ? (
                <Link
                  href={secondaryAction.href}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all"
                >
                  {secondaryAction.label}
                </Link>
              ) : (
                <button
                  onClick={secondaryAction.onClick}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all"
                >
                  {secondaryAction.label}
                </button>
              )
            )}
            {action && (
              action.href ? (
                <Link
                  href={action.href}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-all shadow-sm"
                >
                  <Plus className="h-4 w-4" />
                  {action.label}
                </Link>
              ) : (
                <button
                  onClick={action.onClick}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-all shadow-sm"
                >
                  <Plus className="h-4 w-4" />
                  {action.label}
                </button>
              )
            )}
          </div>
        )}
      </div>
    );
  }

  // Default variant
  return (
    <div className={`text-center py-16 px-4 ${className}`}>
      <div className="mx-auto h-20 w-20 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 mb-5">
        {iconElement}
      </div>
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto leading-relaxed">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-8 flex items-center justify-center gap-3">
          {secondaryAction && (
            secondaryAction.href ? (
              <Link
                href={secondaryAction.href}
                className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all"
              >
                {secondaryAction.label}
              </Link>
            ) : (
              <button
                onClick={secondaryAction.onClick}
                className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all"
              >
                {secondaryAction.label}
              </button>
            )
          )}
          {action && (
            action.href ? (
              <Link
                href={action.href}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-all shadow-sm"
              >
                <Plus className="h-4 w-4" />
                {action.label}
              </Link>
            ) : (
              <button
                onClick={action.onClick}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-all shadow-sm"
              >
                <Plus className="h-4 w-4" />
                {action.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// Pre-built empty states for common scenarios
export function NoCustomersEmpty() {
  return (
    <EmptyState
      icon={<Users className="w-8 h-8" />}
      title="No customers yet"
      description="Get started by adding your first customer. You can import customers or add them one at a time."
      action={{ label: 'Add Customer', href: '/customers/new' }}
    />
  );
}

export function NoJobsEmpty() {
  return (
    <EmptyState
      icon={<Briefcase className="w-8 h-8" />}
      title="No jobs scheduled"
      description="Create a job to start tracking work for your customers."
      action={{ label: 'Create Job', href: '/jobs/new' }}
    />
  );
}

export function NoSearchResultsEmpty({ query }: { query: string }) {
  return (
    <EmptyState
      icon={<Search className="w-8 h-8" />}
      title="No results found"
      description={`We couldn't find anything matching "${query}". Try adjusting your search or filters.`}
      variant="compact"
    />
  );
}

export function NoInvoicesEmpty() {
  return (
    <EmptyState
      icon={<Receipt className="w-8 h-8" />}
      title="No invoices yet"
      description="Create invoices to bill your customers for completed work."
      action={{ label: 'Create Invoice', href: '/invoices/new' }}
    />
  );
}

export default EmptyState;
