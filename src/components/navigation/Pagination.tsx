'use client';

import React from 'react';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  siblingCount?: number;
  showFirstLast?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-8 min-w-[2rem] text-sm',
  md: 'h-10 min-w-[2.5rem] text-sm',
  lg: 'h-12 min-w-[3rem] text-base',
};

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  siblingCount = 1,
  showFirstLast = true,
  size = 'md',
  className = '',
}: PaginationProps) {
  // Generate page numbers to display
  const generatePages = (): (number | 'ellipsis')[] => {
    const totalNumbers = siblingCount * 2 + 5; // siblings + first + last + current + 2 ellipsis

    if (totalNumbers >= totalPages) {
      return range(1, totalPages);
    }

    const leftSiblingIndex = Math.max(currentPage - siblingCount, 1);
    const rightSiblingIndex = Math.min(currentPage + siblingCount, totalPages);

    const showLeftEllipsis = leftSiblingIndex > 2;
    const showRightEllipsis = rightSiblingIndex < totalPages - 1;

    if (!showLeftEllipsis && showRightEllipsis) {
      const leftRange = range(1, 3 + siblingCount * 2);
      return [...leftRange, 'ellipsis', totalPages];
    }

    if (showLeftEllipsis && !showRightEllipsis) {
      const rightRange = range(totalPages - (2 + siblingCount * 2), totalPages);
      return [1, 'ellipsis', ...rightRange];
    }

    const middleRange = range(leftSiblingIndex, rightSiblingIndex);
    return [1, 'ellipsis', ...middleRange, 'ellipsis', totalPages];
  };

  const pages = generatePages();

  const buttonClasses = `
    ${sizeClasses[size]}
    px-3 flex items-center justify-center rounded-lg font-medium
    transition-all duration-200
    disabled:opacity-50 disabled:cursor-not-allowed
  `;

  const pageButtonClasses = (page: number) => `
    ${buttonClasses}
    ${page === currentPage
      ? 'bg-blue-600 text-white shadow-md'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
    }
  `;

  const navButtonClasses = `
    ${buttonClasses}
    text-slate-600 hover:bg-slate-100 hover:text-slate-800
    disabled:hover:bg-transparent
  `;

  return (
    <nav
      aria-label="Pagination"
      className={`flex items-center gap-1 ${className}`}
    >
      {/* First page */}
      {showFirstLast && (
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className={navButtonClasses}
          aria-label="First page"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Previous page */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className={navButtonClasses}
        aria-label="Previous page"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Page numbers */}
      {pages.map((page, index) => {
        if (page === 'ellipsis') {
          return (
            <span
              key={`ellipsis-${index}`}
              className={`${sizeClasses[size]} px-2 flex items-center justify-center text-slate-400`}
            >
              ...
            </span>
          );
        }

        return (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={pageButtonClasses(page)}
            aria-current={page === currentPage ? 'page' : undefined}
          >
            {page}
          </button>
        );
      })}

      {/* Next page */}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={navButtonClasses}
        aria-label="Next page"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Last page */}
      {showFirstLast && (
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className={navButtonClasses}
          aria-label="Last page"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </nav>
  );
}

export default Pagination;
