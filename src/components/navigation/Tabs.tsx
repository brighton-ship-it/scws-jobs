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
            ? 'bg-blue-600 text-white shadow-md'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
        }`;
      case 'underline':
        return `${base} border-b-2 ${
          isActive
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
        }`;
      default:
        return `${base} rounded-lg border ${
          isActive
            ? 'bg-white border-slate-200 text-slate-800 shadow-sm'
            : 'border-transparent text-slate-500 hover:text-slate-700'
        }`;
    }
  };

  const containerClasses = {
    default: 'inline-flex gap-1 p-1 bg-slate-100 rounded-lg',
    pills: 'inline-flex gap-1',
    underline: 'inline-flex gap-0 border-b border-slate-200',
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
                px-1.5 py-0.5 text-xs font-semibold rounded-full
                ${tab.id === activeTab 
                  ? variant === 'pills' 
                    ? 'bg-white/20 text-white' 
                    : 'bg-blue-100 text-blue-600'
                  : 'bg-slate-200 text-slate-600'
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
