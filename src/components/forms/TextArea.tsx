'use client';

import React, { forwardRef } from 'react';

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
  fullWidth?: boolean;
}

const resizeClasses = {
  none: 'resize-none',
  vertical: 'resize-y',
  horizontal: 'resize-x',
  both: 'resize',
};

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (
    {
      label,
      error,
      hint,
      resize = 'vertical',
      fullWidth = true,
      className = '',
      disabled,
      id,
      rows = 4,
      ...props
    },
    ref
  ) => {
    const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;

    return (
      <div className={`${fullWidth ? 'w-full' : ''}`}>
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          disabled={disabled}
          className={`
            block px-3 py-2 text-sm rounded-lg border bg-white transition-colors
            focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500
            disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed
            ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : 'border-slate-300'}
            ${resizeClasses[resize]}
            ${fullWidth ? 'w-full' : ''}
            ${className}
          `}
          {...props}
        />
        {(error || hint) && (
          <p className={`mt-1.5 text-sm ${error ? 'text-red-600' : 'text-slate-500'}`}>
            {error || hint}
          </p>
        )}
      </div>
    );
  }
);

TextArea.displayName = 'TextArea';

export default TextArea;
