'use client';

import React, { forwardRef } from 'react';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-3 text-base',
};

const iconSizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-5 h-5',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      leftIcon,
      rightIcon,
      size = 'md',
      fullWidth = true,
      className = '',
      disabled,
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

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
          {leftIcon && (
            <div className={`absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 ${iconSizeClasses[size]}`}>
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            className={`
              block rounded-lg border bg-white transition-colors
              focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500
              disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed
              ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : 'border-slate-300'}
              ${leftIcon ? 'pl-10' : ''}
              ${rightIcon ? 'pr-10' : ''}
              ${sizeClasses[size]}
              ${fullWidth ? 'w-full' : ''}
              ${className}
            `}
            {...props}
          />
          {rightIcon && (
            <div className={`absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 ${iconSizeClasses[size]}`}>
              {rightIcon}
            </div>
          )}
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

Input.displayName = 'Input';

export default Input;
