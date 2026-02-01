import React from 'react';
import { StatusBadge } from '../data-display/StatusBadge';

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  status: 'active' | 'inactive';
  totalJobs?: number;
  totalRevenue?: number;
  avatar?: string;
}

export interface CustomerCardProps {
  customer: Customer;
  onClick?: () => void;
  onEdit?: () => void;
  onEmail?: () => void;
  onCall?: () => void;
  className?: string;
}

export function CustomerCard({
  customer,
  onClick,
  onEdit,
  onEmail,
  onCall,
  className = '',
}: CustomerCardProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  return (
    <div
      onClick={onClick}
      className={`
        bg-white rounded-xl border border-slate-200 p-4 shadow-sm
        ${onClick ? 'cursor-pointer hover:shadow-md hover:border-slate-300 transition-all duration-200' : ''}
        ${className}
      `}
    >
      <div className="flex items-start gap-4">
        {/* Avatar */}
        {customer.avatar ? (
          <img
            src={customer.avatar}
            alt={customer.name}
            className="w-12 h-12 rounded-full object-cover"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-lg">
            {customer.name.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-slate-800 truncate">{customer.name}</h3>
            <StatusBadge status={customer.status} size="sm" />
          </div>
          
          {customer.company && (
            <p className="text-sm text-slate-500 truncate">{customer.company}</p>
          )}

          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            {customer.email && (
              <div className="flex items-center gap-1.5 text-slate-500">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="truncate">{customer.email}</span>
              </div>
            )}
            {customer.phone && (
              <div className="flex items-center gap-1.5 text-slate-500">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <span>{customer.phone}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      {(customer.totalJobs !== undefined || customer.totalRevenue !== undefined) && (
        <div className="mt-4 pt-4 border-t border-slate-100 flex gap-6">
          {customer.totalJobs !== undefined && (
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Jobs</p>
              <p className="text-lg font-semibold text-slate-800">{customer.totalJobs}</p>
            </div>
          )}
          {customer.totalRevenue !== undefined && (
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Revenue</p>
              <p className="text-lg font-semibold text-slate-800">{formatCurrency(customer.totalRevenue)}</p>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {(onEdit || onEmail || onCall) && (
        <div className="mt-4 pt-4 border-t border-slate-100 flex gap-2">
          {onEmail && customer.email && (
            <button
              onClick={(e) => { e.stopPropagation(); onEmail(); }}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Email
            </button>
          )}
          {onCall && customer.phone && (
            <button
              onClick={(e) => { e.stopPropagation(); onCall(); }}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              Call
            </button>
          )}
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="flex items-center justify-center px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default CustomerCard;
