import { ReactNode } from 'react';

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className = '' }: TableProps) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="min-w-full divide-y divide-gray-200">
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children }: TableProps) {
  return (
    <thead className="bg-gray-50">
      {children}
    </thead>
  );
}

export function TableBody({ children }: TableProps) {
  return (
    <tbody className="divide-y divide-gray-200 bg-white">
      {children}
    </tbody>
  );
}

export function TableRow({ children, className = '' }: TableProps) {
  return (
    <tr className={`hover:bg-gray-50 transition-colors ${className}`}>
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
      <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 ${className}`}>
        {children}
      </th>
    );
  }
  
  return (
    <td className={`px-6 py-4 text-sm text-gray-900 ${className}`}>
      {children}
    </td>
  );
}

export function TableEmpty({ message = 'No data found' }: { message?: string }) {
  return (
    <tr>
      <td colSpan={100} className="px-6 py-12 text-center text-sm text-gray-500">
        {message}
      </td>
    </tr>
  );
}
