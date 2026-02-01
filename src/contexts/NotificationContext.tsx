'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { Notification } from '@/types/database';
import { mockNotifications } from '@/lib/mock-data';

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  addNotification: (notification: Omit<Notification, 'id' | 'created_at' | 'sent_at' | 'read_at'>) => void;
  deleteNotification: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev =>
      prev.map(n =>
        n.id === id
          ? { ...n, read: true, read_at: new Date().toISOString() }
          : n
      )
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev =>
      prev.map(n => ({
        ...n,
        read: true,
        read_at: n.read_at || new Date().toISOString(),
      }))
    );
  }, []);

  const addNotification = useCallback(
    (notification: Omit<Notification, 'id' | 'created_at' | 'sent_at' | 'read_at'>) => {
      const now = new Date().toISOString();
      const newNotification: Notification = {
        ...notification,
        id: crypto.randomUUID(),
        created_at: now,
        sent_at: now,
        read_at: null,
      };
      setNotifications(prev => [newNotification, ...prev]);
    },
    []
  );

  const deleteNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
        addNotification,
        deleteNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
