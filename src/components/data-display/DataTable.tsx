'use client';

import React, { useState, useMemo } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render?: (value: unknown, row: T, index: number) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T;
  loading?: boolean;
  emptyMessage?: string;
  sortable?: boolean;
  defaultSort?: { key: string; direction: 'asc' | 'desc' };
  onRowClick?: (row: T) => void;
  selectedRows?: Set<string | number>;
  onSelectionChange?: (selected: Set<string | number>) => void;
  selectable?: boolean;
  stickyHeader?: boolean;
  className?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyField,
  loading = false,
  emptyMessage = 'No data available',
  sortable = true,
  defaultSort,
  onRowClick,
  selectedRows,
  onSelectionChange,
  selectable = false,
  stickyHeader = false,
  className = '',
}: DataTableProps<T>) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(
    defaultSort || null
  );

  const sortedData = useMemo(() => {
    if (!sortConfig) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      let comparison = 0;
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        comparison = aValue.localeCompare(bValue);
      } else if (typeof aValue === 'number' && typeof bValue === 'number') {
        comparison = aValue - bValue;
      } else {
        comparison = String(aValue).localeCompare(String(bValue));
      }

      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  }, [data, sortConfig]);

  const handleSort = (key: string) => {
    if (!sortable) return;
    
    setSortConfig((current) => {
      if (current?.key !== key) {
        return { key, direction: 'asc' };
      }
      if (current.direction === 'asc') {
        return { key, direction: 'desc' };
      }
      return null;
    });
  };

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    
    const allKeys = new Set(data.map((row) => row[keyField] as string | number));
    const allSelected = selectedRows && allKeys.size === selectedRows.size;
    
    onSelectionChange(allSelected ? new Set() : allKeys);
  };

  const handleSelectRow = (key: string | number) => {
    if (!onSelectionChange || !selectedRows) return;
    
    const newSelected = new Set(selectedRows);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    onSelectionChange(newSelected);
  };

  const allSelected = selectedRows && data.length > 0 && selectedRows.size === data.length;
  const someSelected = selectedRows && selectedRows.size > 0 && selectedRows.size < data.length;

  const alignClasses = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full">
        <thead className={`${stickyHeader ? 'sticky top-0 z-10' : ''}`}>
          <tr className="bg-slate-50 border-b border-slate-200">
            {selectable && (
              <th className="w-12 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !!someSelected;
                  }}
                  onChange={handleSelectAll}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
            )}
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider ${alignClasses[column.align || 'left']} ${column.sortable !== false && sortable ? 'cursor-pointer select-none hover:bg-slate-100 transition-colors' : ''}`}
                style={{ width: column.width }}
                onClick={() => column.sortable !== false && handleSort(column.key)}
              >
                <div className={`flex items-center gap-1 ${column.align === 'right' ? 'justify-end' : column.align === 'center' ? 'justify-center' : ''}`}>
                  <span>{column.header}</span>
                  {column.sortable !== false && sortable && (
                    <span className="text-slate-400">
                      {sortConfig?.key === column.key ? (
                        sortConfig.direction === 'asc' ? (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        )
                      ) : (
                        <svg className="w-4 h-4 opacity-0 group-hover:opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                      )}
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {loading ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-12 text-center">
                <div className="flex items-center justify-center gap-3 text-slate-500">
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Loading...
                </div>
              </td>
            </tr>
          ) : sortedData.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-12 text-center text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedData.map((row, rowIndex) => {
              const rowKey = row[keyField] as string | number;
              const isSelected = selectedRows?.has(rowKey);

              return (
                <tr
                  key={rowKey}
                  onClick={() => onRowClick?.(row)}
                  className={`
                    ${onRowClick ? 'cursor-pointer' : ''}
                    ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}
                    transition-colors
                  `}
                >
                  {selectable && (
                    <td className="w-12 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectRow(rowKey)}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-3 text-sm text-slate-700 ${alignClasses[column.align || 'left']}`}
                    >
                      {column.render
                        ? column.render(row[column.key], row, rowIndex)
                        : (row[column.key] as React.ReactNode)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
