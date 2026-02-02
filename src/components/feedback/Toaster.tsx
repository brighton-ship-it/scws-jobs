'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { X, CheckCircle, XCircle, Info, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const icons = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

// Jobber-style toast colors
const colors = {
  success: 'bg-emerald-50 border-emerald-200',
  error: 'bg-red-50 border-red-200',
  info: 'bg-blue-50 border-blue-200',
  warning: 'bg-amber-50 border-amber-200',
};

const iconColors = {
  success: 'text-emerald-600 bg-emerald-100',
  error: 'text-red-600 bg-red-100',
  info: 'text-blue-600 bg-blue-100',
  warning: 'text-amber-600 bg-amber-100',
};

const textColors = {
  success: 'text-emerald-900',
  error: 'text-red-900',
  info: 'text-blue-900',
  warning: 'text-amber-900',
};

const subtextColors = {
  success: 'text-emerald-700',
  error: 'text-red-700',
  info: 'text-blue-700',
  warning: 'text-amber-700',
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const Icon = icons[toast.type];

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-4 shadow-lg animate-slide-in-right ${colors[toast.type]}`}
      role="alert"
    >
      <div className={`flex-shrink-0 p-1.5 rounded-lg ${iconColors[toast.type]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-sm ${textColors[toast.type]}`}>{toast.title}</p>
        {toast.message && (
          <p className={`mt-0.5 text-sm ${subtextColors[toast.type]}`}>{toast.message}</p>
        )}
      </div>
      <button
        onClick={onRemove}
        className={`flex-shrink-0 p-1 rounded-lg opacity-60 hover:opacity-100 hover:bg-black/5 transition-all ${subtextColors[toast.type]}`}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = crypto.randomUUID();
      const duration = toast.duration ?? 5000;

      setToasts((prev) => [...prev, { ...toast, id }]);

      if (duration > 0) {
        setTimeout(() => removeToast(id), duration);
      }
    },
    [removeToast]
  );

  const success = useCallback(
    (title: string, message?: string) => addToast({ type: 'success', title, message }),
    [addToast]
  );

  const error = useCallback(
    (title: string, message?: string) => addToast({ type: 'error', title, message }),
    [addToast]
  );

  const info = useCallback(
    (title: string, message?: string) => addToast({ type: 'info', title, message }),
    [addToast]
  );

  const warning = useCallback(
    (title: string, message?: string) => addToast({ type: 'warning', title, message }),
    [addToast]
  );

  return (
    <ToastContext.Provider
      value={{ toasts, addToast, removeToast, success, error, info, warning }}
    >
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function Toaster() {
  return (
    <ToastProvider>
      <ToasterContent />
    </ToastProvider>
  );
}

function ToasterContent() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onRemove={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

// Standalone toast function for use without context
let toastHandler: ToastContextType | null = null;

export function setToastHandler(handler: ToastContextType) {
  toastHandler = handler;
}

export function toast(options: Omit<Toast, 'id'>) {
  if (toastHandler) {
    toastHandler.addToast(options);
  }
}
