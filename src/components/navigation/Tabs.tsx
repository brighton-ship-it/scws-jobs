'use client';

import React from 'react';

export interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  variant?: 'default' | 'pills' | 'underline';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: 'text-sm px-3 py-1.5',
  md: 'text-sm px-4 py-2',
  lg: 'text-base px-5 py-2.5',
};

export function Tabs({
  tabs,
  activeTab,
  onChange,
  variant = 'default',
  size = 'md',
  fullWidth = false,
  className = '',
}: TabsProps) {
  const getTabClasses = (tab: Tab) => {
    const isActive = tab.id === activeTab;
    const base = `
      inline-flex items-center gap-2 font-medium transition-all duration-200
      ${tab.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      ${sizeClasses[size]}
      ${fullWidth ? 'flex-1 justify-center' : ''}
    `;

    switch (variant) {
      case 'pills':
        return `${base} rounded-lg ${
          isActive
            ? 'bg-emerald-600 text-white shadow-sm'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }`;
      case 'underline':
        return `${base} border-b-2 -mb-px ${
          isActive
            ? 'border-emerald-600 text-emerald-600'
            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
        }`;
      default:
        return `${base} rounded-lg ${
          isActive
            ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200'
            : 'text-gray-500 hover:text-gray-700'
        }`;
    }
  };

  const containerClasses = {
    default: 'inline-flex gap-1 p-1 bg-gray-100 rounded-xl',
    pills: 'inline-flex gap-1',
    underline: 'inline-flex gap-0 border-b border-gray-200',
  };

  return (
    <div
      className={`${containerClasses[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTab}
          aria-disabled={tab.disabled}
          onClick={() => !tab.disabled && onChange(tab.id)}
          className={getTabClasses(tab)}
        >
          {tab.icon && <span className="w-4 h-4">{tab.icon}</span>}
          <span>{tab.label}</span>
          {tab.badge !== undefined && tab.badge > 0 && (
            <span
              className={`
                px-1.5 py-0.5 text-xs font-semibold rounded-full min-w-[20px] text-center
                ${tab.id === activeTab 
                  ? variant === 'pills' 
                    ? 'bg-white/20 text-white' 
                    : 'bg-emerald-100 text-emerald-700'
                  : 'bg-gray-200 text-gray-600'
                }
              `}
            >
              {tab.badge > 99 ? '99+' : tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export default Tabs;
