'use client';

import React, { useState, useEffect, useCallback, forwardRef } from 'react';

export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange'> {
  onSearch?: (value: string) => void;
  onChange?: (value: string) => void;
  debounceMs?: number;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  clearable?: boolean;
  fullWidth?: boolean;
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm pl-9',
  md: 'px-3 py-2 text-sm pl-10',
  lg: 'px-4 py-3 text-base pl-11',
};

const iconSizeClasses = {
  sm: 'w-4 h-4 left-2.5',
  md: 'w-5 h-5 left-3',
  lg: 'w-5 h-5 left-3.5',
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      onSearch,
      onChange,
      debounceMs = 300,
      size = 'md',
      loading = false,
      clearable = true,
      fullWidth = true,
      className = '',
      placeholder = 'Search...',
      value: controlledValue,
      ...props
    },
    ref
  ) => {
    const [internalValue, setInternalValue] = useState(controlledValue?.toString() || '');
    const value = controlledValue !== undefined ? controlledValue.toString() : internalValue;

    // Debounced search
    useEffect(() => {
      if (!onSearch) return;

      const timer = setTimeout(() => {
        onSearch(value);
      }, debounceMs);

      return () => clearTimeout(timer);
    }, [value, debounceMs, onSearch]);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setInternalValue(newValue);
        onChange?.(newValue);
      },
      [onChange]
    );

    const handleClear = useCallback(() => {
      setInternalValue('');
      onChange?.('');
      onSearch?.('');
    }, [onChange, onSearch]);

    return (
      <div className={`relative ${fullWidth ? 'w-full' : ''}`}>
        {/* Search icon or loading spinner */}
        <div className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${iconSizeClasses[size]}`}>
          {loading ? (
            <svg className="animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          )}
        </div>

        <input
          ref={ref}
          type="search"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          className={`
            block rounded-lg border border-slate-300 bg-white transition-colors
            focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500
            ${sizeClasses[size]}
            ${fullWidth ? 'w-full' : ''}
            ${clearable && value ? 'pr-9' : ''}
            ${className}
          `}
          {...props}
        />

        {/* Clear button */}
        {clearable && value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Clear search"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  }
);

SearchInput.displayName = 'SearchInput';

export default SearchInput;
