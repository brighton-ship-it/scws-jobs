import React from 'react';

export interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: {
    value: number;
    label?: string;
  };
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  loading?: boolean;
  className?: string;
  onClick?: () => void;
}

const variantStyles = {
  default: {
    icon: 'bg-slate-100 text-slate-600',
    trend: { up: 'text-green-600', down: 'text-red-600' },
  },
  primary: {
    icon: 'bg-blue-100 text-blue-600',
    trend: { up: 'text-green-600', down: 'text-red-600' },
  },
  success: {
    icon: 'bg-green-100 text-green-600',
    trend: { up: 'text-green-600', down: 'text-red-600' },
  },
  warning: {
    icon: 'bg-amber-100 text-amber-600',
    trend: { up: 'text-green-600', down: 'text-red-600' },
  },
  danger: {
    icon: 'bg-red-100 text-red-600',
    trend: { up: 'text-green-600', down: 'text-red-600' },
  },
};

export function StatCard({
  label,
  value,
  icon,
  trend,
  variant = 'default',
  loading = false,
  className = '',
  onClick,
}: StatCardProps) {
  const styles = variantStyles[variant];
  const isPositive = trend && trend.value >= 0;
  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={`
        bg-white rounded-xl border border-slate-200 p-4 shadow-sm
        ${onClick ? 'hover:shadow-md hover:border-slate-300 transition-all duration-200 cursor-pointer text-left w-full' : ''}
        ${className}
      `}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-500 truncate">{label}</p>
          {loading ? (
            <div className="mt-2 h-8 w-24 bg-slate-200 rounded animate-pulse" />
          ) : (
            <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
          )}
          {trend && !loading && (
            <div className={`mt-2 flex items-center gap-1 text-sm ${isPositive ? styles.trend.up : styles.trend.down}`}>
              {isPositive ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17l9.2-9.2M17 17V7H7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 7l-9.2 9.2M7 7v10h10" />
                </svg>
              )}
              <span className="font-medium">
                {isPositive ? '+' : ''}{trend.value}%
              </span>
              {trend.label && (
                <span className="text-slate-500 font-normal">{trend.label}</span>
              )}
            </div>
          )}
        </div>
        {icon && (
          <div className={`p-3 rounded-lg ${styles.icon}`}>
            <div className="w-6 h-6">{icon}</div>
          </div>
        )}
      </div>
    </Component>
  );
}

export default StatCard;
