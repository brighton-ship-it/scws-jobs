import React from 'react';

export interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}

const columnClasses = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

export function FormSection({
  title,
  description,
  children,
  columns = 1,
  className = '',
}: FormSectionProps) {
  return (
    <div className={`${className}`}>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-800">{title}</h3>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
      <div className={`grid ${columnClasses[columns]} gap-4`}>
        {children}
      </div>
    </div>
  );
}

export default FormSection;
