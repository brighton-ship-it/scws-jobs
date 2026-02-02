import React, { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

// Jobber-style input
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block text-sm font-medium text-gray-700">
            {label}
            {props.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
        )}
        <input
          ref={ref}
          className={`
            block w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900
            placeholder-gray-400 bg-white
            transition-all duration-150
            hover:border-gray-400
            focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20
            disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed disabled:hover:border-gray-200
            ${error 
              ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' 
              : 'border-gray-200'
            }
            ${className}
          `}
          {...props}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {helperText && !error && <p className="text-sm text-gray-500">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

// Jobber-style textarea
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, className = '', ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block text-sm font-medium text-gray-700">
            {label}
            {props.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          className={`
            block w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900
            placeholder-gray-400 bg-white
            transition-all duration-150
            hover:border-gray-400
            focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20
            disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed disabled:hover:border-gray-200
            resize-y
            ${error 
              ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' 
              : 'border-gray-200'
            }
            ${className}
          `}
          {...props}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {helperText && !error && <p className="text-sm text-gray-500">{helperText}</p>}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options?: { value: string; label: string }[];
  children?: React.ReactNode;
}

// Jobber-style select
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, children, className = '', ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block text-sm font-medium text-gray-700">
            {label}
            {props.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            className={`
              block w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900
              bg-white appearance-none cursor-pointer
              transition-all duration-150
              hover:border-gray-400
              focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20
              disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed disabled:hover:border-gray-200
              pr-10
              ${error 
                ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' 
                : 'border-gray-200'
              }
              ${className}
            `}
            {...props}
          >
            {children || options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
            <ChevronDown className="w-5 h-5" />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';

// Checkbox component - Jobber style
interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, description, error, className = '', ...props }, ref) => {
    return (
      <div className="flex items-start gap-3">
        <input
          ref={ref}
          type="checkbox"
          className={`
            h-4 w-4 mt-0.5 rounded border-gray-300 text-emerald-600 
            focus:ring-2 focus:ring-emerald-500/20 focus:ring-offset-0
            transition-all cursor-pointer
            disabled:cursor-not-allowed disabled:opacity-50
            ${error ? 'border-red-400' : ''}
            ${className}
          `}
          {...props}
        />
        {(label || description) && (
          <div className="flex-1">
            {label && (
              <label className="text-sm font-medium text-gray-900 cursor-pointer">
                {label}
              </label>
            )}
            {description && (
              <p className="text-sm text-gray-500 mt-0.5">{description}</p>
            )}
            {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
          </div>
        )}
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';

// Radio component - Jobber style
interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  description?: string;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  ({ label, description, className = '', ...props }, ref) => {
    return (
      <div className="flex items-start gap-3">
        <input
          ref={ref}
          type="radio"
          className={`
            h-4 w-4 mt-0.5 border-gray-300 text-emerald-600 
            focus:ring-2 focus:ring-emerald-500/20 focus:ring-offset-0
            transition-all cursor-pointer
            disabled:cursor-not-allowed disabled:opacity-50
            ${className}
          `}
          {...props}
        />
        {(label || description) && (
          <div className="flex-1">
            {label && (
              <label className="text-sm font-medium text-gray-900 cursor-pointer">
                {label}
              </label>
            )}
            {description && (
              <p className="text-sm text-gray-500 mt-0.5">{description}</p>
            )}
          </div>
        )}
      </div>
    );
  }
);

Radio.displayName = 'Radio';
