import React from 'react';

export interface SkeletonProps {
  variant?: 'text' | 'circular' | 'rectangular' | 'rounded';
  width?: string | number;
  height?: string | number;
  className?: string;
  lines?: number;
  animation?: 'pulse' | 'wave' | 'none';
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  className = '',
  lines = 1,
  animation = 'pulse',
}: SkeletonProps) {
  const baseClasses = 'bg-slate-200';
  
  const animationClasses = {
    pulse: 'animate-pulse',
    wave: 'animate-shimmer',
    none: '',
  };

  const variantClasses = {
    text: 'rounded',
    circular: 'rounded-full',
    rectangular: '',
    rounded: 'rounded-lg',
  };

  const style: React.CSSProperties = {
    width: width,
    height: height,
  };

  // For text variant, render multiple lines if specified
  if (variant === 'text' && lines > 1) {
    return (
      <div className={`space-y-2 ${className}`}>
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className={`${baseClasses} ${animationClasses[animation]} ${variantClasses[variant]} h-4`}
            style={{
              width: index === lines - 1 ? '75%' : '100%',
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`
        ${baseClasses}
        ${animationClasses[animation]}
        ${variantClasses[variant]}
        ${className}
      `}
      style={style}
    />
  );
}

// Pre-built skeleton patterns
export function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" width={40} height={40} />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" width="60%" height={16} />
          <Skeleton variant="text" width="40%" height={12} />
        </div>
      </div>
      <Skeleton variant="text" lines={3} />
    </div>
  );
}

export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex gap-4 px-4 py-3 bg-slate-50 rounded-lg">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} variant="text" width={`${100 / columns}%`} height={16} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 px-4 py-3">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} variant="text" width={`${100 / columns}%`} height={16} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-slate-200 p-4">
          <Skeleton variant="text" width="40%" height={12} />
          <Skeleton variant="text" width="60%" height={28} className="mt-2" />
          <Skeleton variant="text" width="50%" height={12} className="mt-2" />
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
