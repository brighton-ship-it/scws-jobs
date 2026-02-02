'use client';

import React from 'react';
import { Modal } from './Modal';
import { AlertTriangle, AlertCircle, Info, Trash2 } from 'lucide-react';
import { ButtonLoader } from './LoadingSpinner';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  loading?: boolean;
  icon?: React.ReactNode;
}

const variantStyles = {
  danger: {
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    button: 'bg-red-600 hover:bg-red-700 focus:ring-red-500/20',
  },
  warning: {
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    button: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500/20',
  },
  info: {
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    button: 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500/20',
  },
};

const defaultIcons = {
  danger: <Trash2 className="w-6 h-6" />,
  warning: <AlertTriangle className="w-6 h-6" />,
  info: <Info className="w-6 h-6" />,
};

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  icon,
}: ConfirmDialogProps) {
  const styles = variantStyles[variant];
  const displayIcon = icon || defaultIcons[variant];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      showCloseButton={false}
    >
      <div className="text-center">
        <div className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center ${styles.iconBg}`}>
          <span className={styles.iconColor}>{displayIcon}</span>
        </div>
        <h3 className="mt-5 text-lg font-semibold text-gray-900">{title}</h3>
        <p className="mt-2 text-sm text-gray-500 leading-relaxed">{message}</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`
              px-4 py-2.5 text-sm font-medium text-white rounded-lg transition-all
              focus:outline-none focus:ring-2 disabled:opacity-50
              flex items-center gap-2
              ${styles.button}
            `}
          >
            {loading && <ButtonLoader className="text-white" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
