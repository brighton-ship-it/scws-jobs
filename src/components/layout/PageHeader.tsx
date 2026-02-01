import React from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  backHref?: string;
  onBack?: () => void;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  backHref,
  onBack,
  className = '',
}: PageHeaderProps) {
  const BackButton = () => (
    <button
      onClick={onBack}
      className="mr-3 p-2 -ml-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
      aria-label="Go back"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
    </button>
  );

  const BackLink = () => (
    <a
      href={backHref}
      className="mr-3 p-2 -ml-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors inline-flex"
      aria-label="Go back"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
    </a>
  );

  return (
    <div className={`flex items-center justify-between py-6 ${className}`}>
      <div className="flex items-center">
        {onBack && <BackButton />}
        {backHref && !onBack && <BackLink />}
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-3">
          {actions}
        </div>
      )}
    </div>
  );
}

export default PageHeader;
