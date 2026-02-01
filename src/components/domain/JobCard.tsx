import React from 'react';
import { StatusBadge } from '../data-display/StatusBadge';

export type JobStatus = 'pending' | 'scheduled' | 'in-progress' | 'completed' | 'cancelled';

export interface Job {
  id: string;
  jobNumber: string;
  title: string;
  description?: string;
  customerName: string;
  propertyAddress?: string;
  status: JobStatus;
  scheduledDate?: string;
  scheduledTime?: string;
  estimatedHours?: number;
  assignedTo?: string[];
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  totalAmount?: number;
}

export interface JobCardProps {
  job: Job;
  onClick?: () => void;
  onStatusChange?: (status: JobStatus) => void;
  compact?: boolean;
  className?: string;
}

const priorityColors = {
  low: 'border-l-slate-400',
  medium: 'border-l-blue-500',
  high: 'border-l-amber-500',
  urgent: 'border-l-red-500',
};

export function JobCard({
  job,
  onClick,
  onStatusChange,
  compact = false,
  className = '',
}: JobCardProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`
          bg-white rounded-lg border border-slate-200 p-3 border-l-4
          ${job.priority ? priorityColors[job.priority] : 'border-l-slate-200'}
          ${onClick ? 'cursor-pointer hover:shadow-md hover:border-slate-300 transition-all duration-200' : ''}
          ${className}
        `}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-slate-400">{job.jobNumber}</span>
              <StatusBadge status={job.status} size="sm" />
            </div>
            <h4 className="font-medium text-slate-800 truncate mt-1">{job.title}</h4>
            <p className="text-sm text-slate-500 truncate">{job.customerName}</p>
          </div>
          {job.scheduledDate && (
            <div className="text-right text-sm">
              <p className="text-slate-500">{formatDate(job.scheduledDate)}</p>
              {job.scheduledTime && (
                <p className="text-slate-400">{job.scheduledTime}</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`
        bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden border-l-4
        ${job.priority ? priorityColors[job.priority] : 'border-l-slate-200'}
        ${onClick ? 'cursor-pointer hover:shadow-md hover:border-slate-300 transition-all duration-200' : ''}
        ${className}
      `}
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                {job.jobNumber}
              </span>
              <StatusBadge status={job.status} size="sm" dot />
            </div>
            <h3 className="text-lg font-semibold text-slate-800">{job.title}</h3>
          </div>
          {job.totalAmount !== undefined && (
            <div className="text-right">
              <p className="text-lg font-bold text-slate-800">{formatCurrency(job.totalAmount)}</p>
            </div>
          )}
        </div>

        {/* Description */}
        {job.description && (
          <p className="text-sm text-slate-500 line-clamp-2 mb-3">{job.description}</p>
        )}

        {/* Customer & Property */}
        <div className="space-y-2 mb-3">
          <div className="flex items-center gap-2 text-sm">
            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-slate-600">{job.customerName}</span>
          </div>
          {job.propertyAddress && (
            <div className="flex items-center gap-2 text-sm">
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-slate-600 truncate">{job.propertyAddress}</span>
            </div>
          )}
        </div>

        {/* Schedule & Assigned */}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {job.scheduledDate && (
            <div className="flex items-center gap-1.5 text-slate-500">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>{formatDate(job.scheduledDate)}</span>
              {job.scheduledTime && <span>at {job.scheduledTime}</span>}
            </div>
          )}
          {job.estimatedHours && (
            <div className="flex items-center gap-1.5 text-slate-500">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{job.estimatedHours}h estimated</span>
            </div>
          )}
        </div>

        {/* Assigned Team */}
        {job.assignedTo && job.assignedTo.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 uppercase tracking-wide">Assigned:</span>
              <div className="flex -space-x-2">
                {job.assignedTo.slice(0, 3).map((name, index) => (
                  <div
                    key={index}
                    className="w-6 h-6 rounded-full bg-blue-100 border-2 border-white flex items-center justify-center text-xs font-medium text-blue-600"
                    title={name}
                  >
                    {name.charAt(0)}
                  </div>
                ))}
                {job.assignedTo.length > 3 && (
                  <div className="w-6 h-6 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-xs font-medium text-slate-600">
                    +{job.assignedTo.length - 3}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default JobCard;
