'use client';

import React, { forwardRef } from 'react';

export interface TimePickerProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string;
  error?: string;
  hint?: string;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-3 text-base',
};

export const TimePicker = forwardRef<HTMLInputElement, TimePickerProps>(
  (
    {
      label,
      error,
      hint,
      size = 'md',
      fullWidth = true,
      className = '',
      disabled,
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || `timepicker-${Math.random().toString(36).substr(2, 9)}`;

    return (
      <div className={`${fullWidth ? 'w-full' : ''}`}>
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type="time"
            disabled={disabled}
            className={`
              block rounded-lg border bg-white transition-colors
              focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500
              disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed
              ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : 'border-slate-300'}
              ${sizeClasses[size]}
              ${fullWidth ? 'w-full' : ''}
              ${className}
            `}
            {...props}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
        {(error || hint) && (
          <p className={`mt-1.5 text-sm ${error ? 'text-red-600' : 'text-slate-500'}`}>
            {error || hint}
          </p>
        )}
      </div>
    );
  }
);

TimePicker.displayName = 'TimePicker';

export default TimePicker;
