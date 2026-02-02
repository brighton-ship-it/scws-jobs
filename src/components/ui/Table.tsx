import { ReactNode } from 'react';

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className = '' }: TableProps) {
  return (
    <div className={`overflow-x-auto rounded-xl border border-gray-100 ${className}`}>
      <table className="min-w-full divide-y divide-gray-100">
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children }: TableProps) {
  return (
    <thead className="bg-gray-50/80">
      {children}
    </thead>
  );
}

export function TableBody({ children }: TableProps) {
  return (
    <tbody className="divide-y divide-gray-50 bg-white">
      {children}
    </tbody>
  );
}

export function TableRow({ children, className = '', onClick }: TableProps & { onClick?: () => void }) {
  return (
    <tr 
      className={`hover:bg-gray-50/80 transition-colors group ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

interface TableCellProps {
  children?: ReactNode;
  header?: boolean;
  className?: string;
}

export function TableCell({ children, header = false, className = '' }: TableCellProps) {
  if (header) {
    return (
      <th className={`px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 ${className}`}>
        {children}
      </th>
    );
  }
  
  return (
    <td className={`px-5 py-4 text-sm text-gray-700 ${className}`}>
      {children}
    </td>
  );
}

export function TableEmpty({ message = 'No data found', icon }: { message?: string; icon?: ReactNode }) {
  return (
    <tr>
      <td colSpan={100} className="px-6 py-16 text-center">
        {icon && <div className="flex justify-center mb-3 text-gray-300">{icon}</div>}
        <p className="text-sm text-gray-500">{message}</p>
      </td>
    </tr>
  );
}

// Action cell for inline row actions - Jobber style
export function TableActions({ children }: { children: ReactNode }) {
  return (
    <td className="px-5 py-4 text-right">
      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {children}
      </div>
    </td>
  );
}
