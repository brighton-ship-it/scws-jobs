'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastProps {
  id: string;
  message: string;
  title?: string;
  variant?: ToastVariant;
  duration?: number;
  onClose: (id: string) => void;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface ToastContainerProps {
  toasts: ToastProps[];
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
}

// Jobber-style toast colors
const variantStyles = {
  success: {
    bg: 'bg-emerald-50 border-emerald-200',
    iconBg: 'bg-emerald-100',
    icon: 'text-emerald-600',
    title: 'text-emerald-900',
    text: 'text-emerald-700',
    action: 'text-emerald-700 hover:text-emerald-800',
  },
  error: {
    bg: 'bg-red-50 border-red-200',
    iconBg: 'bg-red-100',
    icon: 'text-red-600',
    title: 'text-red-900',
    text: 'text-red-700',
    action: 'text-red-700 hover:text-red-800',
  },
  warning: {
    bg: 'bg-amber-50 border-amber-200',
    iconBg: 'bg-amber-100',
    icon: 'text-amber-600',
    title: 'text-amber-900',
    text: 'text-amber-700',
    action: 'text-amber-700 hover:text-amber-800',
  },
  info: {
    bg: 'bg-blue-50 border-blue-200',
    iconBg: 'bg-blue-100',
    icon: 'text-blue-600',
    title: 'text-blue-900',
    text: 'text-blue-700',
    action: 'text-blue-700 hover:text-blue-800',
  },
};

const icons = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

export function Toast({
  id,
  message,
  title,
  variant = 'info',
  duration = 5000,
  onClose,
  action,
}: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const styles = variantStyles[variant];
  const Icon = icons[variant];

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setIsVisible(true));
    
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsLeaving(true);
        setTimeout(() => onClose(id), 200);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, id, onClose]);

  const handleClose = () => {
    setIsLeaving(true);
    setTimeout(() => onClose(id), 200);
  };

  return (
    <div
      className={`
        flex items-start gap-3 p-4 rounded-xl border shadow-lg max-w-sm w-full
        transform transition-all duration-200 ease-out
        ${styles.bg}
        ${isVisible && !isLeaving ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}
      `}
      role="alert"
    >
      <div className={`flex-shrink-0 p-1 rounded-lg ${styles.iconBg}`}>
        <Icon className={`w-4 h-4 ${styles.icon}`} />
      </div>
      <div className="flex-1 min-w-0">
        {title && (
          <p className={`text-sm font-semibold ${styles.title}`}>{title}</p>
        )}
        <p className={`text-sm ${title ? 'mt-0.5' : ''} ${styles.text}`}>{message}</p>
        {action && (
          <button
            onClick={action.onClick}
            className={`mt-2 text-sm font-medium underline hover:no-underline transition-colors ${styles.action}`}
          >
            {action.label}
          </button>
        )}
      </div>
      <button
        onClick={handleClose}
        className={`flex-shrink-0 p-1 rounded-lg hover:bg-black/5 transition-colors ${styles.icon}`}
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

const positionClasses = {
  'top-right': 'top-4 right-4',
  'top-left': 'top-4 left-4',
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'top-center': 'top-4 left-1/2 -translate-x-1/2',
  'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
};

export function ToastContainer({
  toasts,
  position = 'bottom-right',
}: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className={`fixed z-50 ${positionClasses[position]} space-y-2`}>
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} />
      ))}
    </div>
  );
}

export default Toast;
