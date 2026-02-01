import React from 'react';

export interface CardProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export function Card({
  children,
  header,
  footer,
  title,
  subtitle,
  actions,
  padding = 'md',
  className = '',
  hover = false,
  onClick,
}: CardProps) {
  const paddingClasses = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
  };

  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={`
        bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden
        ${hover ? 'hover:shadow-md hover:border-slate-300 transition-all duration-200' : ''}
        ${onClick ? 'w-full text-left cursor-pointer' : ''}
        ${className}
      `}
    >
      {/* Header - either custom header or title/actions combo */}
      {(header || title) && (
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/50">
          {header || (
            <div className="flex items-center justify-between">
              <div>
                {title && <h3 className="font-semibold text-slate-800">{title}</h3>}
                {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
              </div>
              {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div className={paddingClasses[padding]}>
        {children}
      </div>

      {/* Footer */}
      {footer && (
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/50">
          {footer}
        </div>
      )}
    </Component>
  );
}

export default Card;
