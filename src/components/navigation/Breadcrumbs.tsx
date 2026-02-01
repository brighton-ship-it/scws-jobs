import React from 'react';
import Link from 'next/link';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  separator?: React.ReactNode;
  className?: string;
}

export function Breadcrumbs({
  items,
  separator,
  className = '',
}: BreadcrumbsProps) {
  const defaultSeparator = (
    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );

  const renderSeparator = separator || defaultSeparator;

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex items-center gap-2 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={index} className="flex items-center gap-2">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 transition-colors"
                >
                  {item.icon && <span className="w-4 h-4">{item.icon}</span>}
                  {item.label}
                </Link>
              ) : (
                <span
                  className={`flex items-center gap-1.5 ${
                    isLast ? 'text-slate-800 font-medium' : 'text-slate-500'
                  }`}
                >
                  {item.icon && <span className="w-4 h-4">{item.icon}</span>}
                  {item.label}
                </span>
              )}
              {!isLast && <span className="flex-shrink-0">{renderSeparator}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default Breadcrumbs;
