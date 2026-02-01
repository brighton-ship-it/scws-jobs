import React from 'react';
import { StatusBadge } from '../data-display/StatusBadge';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'partial' | 'cancelled';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  jobId?: string;
  jobNumber?: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  balance: number;
}

export interface InvoiceRowProps {
  invoice: Invoice;
  onClick?: () => void;
  onSend?: () => void;
  onMarkPaid?: () => void;
  onDownload?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  className?: string;
}

export function InvoiceRow({
  invoice,
  onClick,
  onSend,
  onMarkPaid,
  onDownload,
  selectable = false,
  selected = false,
  onSelect,
  className = '',
}: InvoiceRowProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const isOverdue = invoice.status !== 'paid' && new Date(invoice.dueDate) < new Date();

  return (
    <tr
      onClick={onClick}
      className={`
        ${onClick ? 'cursor-pointer hover:bg-slate-50' : ''}
        ${selected ? 'bg-blue-50' : ''}
        transition-colors
        ${className}
      `}
    >
      {selectable && (
        <td className="w-12 px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect?.(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
        </td>
      )}

      {/* Invoice Number */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-slate-800">
            {invoice.invoiceNumber}
          </span>
          {invoice.jobNumber && (
            <span className="text-xs text-slate-400">
              (Job #{invoice.jobNumber})
            </span>
          )}
        </div>
      </td>

      {/* Customer */}
      <td className="px-4 py-3">
        <span className="text-sm text-slate-700">{invoice.customerName}</span>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <StatusBadge status={invoice.status} size="sm" dot />
      </td>

      {/* Issue Date */}
      <td className="px-4 py-3">
        <span className="text-sm text-slate-500">{formatDate(invoice.issueDate)}</span>
      </td>

      {/* Due Date */}
      <td className="px-4 py-3">
        <span className={`text-sm ${isOverdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
          {formatDate(invoice.dueDate)}
          {isOverdue && invoice.status !== 'paid' && (
            <span className="ml-1 text-xs">(overdue)</span>
          )}
        </span>
      </td>

      {/* Total */}
      <td className="px-4 py-3 text-right">
        <span className="text-sm font-medium text-slate-800">{formatCurrency(invoice.total)}</span>
      </td>

      {/* Balance */}
      <td className="px-4 py-3 text-right">
        <span className={`text-sm font-medium ${invoice.balance > 0 ? 'text-amber-600' : 'text-green-600'}`}>
          {formatCurrency(invoice.balance)}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {invoice.status === 'draft' && onSend && (
            <button
              onClick={onSend}
              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="Send invoice"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          )}
          {invoice.balance > 0 && onMarkPaid && (
            <button
              onClick={onMarkPaid}
              className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
              title="Mark as paid"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          )}
          {onDownload && (
            <button
              onClick={onDownload}
              className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
              title="Download PDF"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// Also export a card variant for mobile/grid views
export function InvoiceCard({
  invoice,
  onClick,
  onSend,
  onMarkPaid,
  className = '',
}: Omit<InvoiceRowProps, 'selectable' | 'selected' | 'onSelect' | 'onDownload'>) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const isOverdue = invoice.status !== 'paid' && new Date(invoice.dueDate) < new Date();

  return (
    <div
      onClick={onClick}
      className={`
        bg-white rounded-xl border border-slate-200 p-4 shadow-sm
        ${onClick ? 'cursor-pointer hover:shadow-md hover:border-slate-300 transition-all duration-200' : ''}
        ${isOverdue ? 'border-l-4 border-l-red-500' : ''}
        ${className}
      `}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-sm font-medium text-slate-800">
              {invoice.invoiceNumber}
            </span>
            <StatusBadge status={invoice.status} size="sm" />
          </div>
          <p className="text-sm text-slate-500">{invoice.customerName}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-slate-800">{formatCurrency(invoice.total)}</p>
          {invoice.balance > 0 && (
            <p className="text-sm text-amber-600">
              {formatCurrency(invoice.balance)} due
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex gap-4 text-slate-500">
          <span>Issued: {formatDate(invoice.issueDate)}</span>
          <span className={isOverdue ? 'text-red-600' : ''}>
            Due: {formatDate(invoice.dueDate)}
          </span>
        </div>
        
        {(onSend || onMarkPaid) && (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            {invoice.status === 'draft' && onSend && (
              <button
                onClick={onSend}
                className="px-3 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
              >
                Send
              </button>
            )}
            {invoice.balance > 0 && onMarkPaid && (
              <button
                onClick={onMarkPaid}
                className="px-3 py-1 text-xs font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
              >
                Mark Paid
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default InvoiceRow;
