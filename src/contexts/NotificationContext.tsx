'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Notification {
  id: string;
  type: string;
  title: string;
  message?: string;
  entity_type?: string;
  entity_id?: string;
  priority: string;
  read: boolean;
  read_at?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  refresh: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications?limit=50');
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (error) {
      console.error('[Notifications] Error fetching:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Mark single notification as read
  const markAsRead = useCallback(async (id: string) => {
    // Optimistic update
    setNotifications(prev =>
      prev.map(n =>
        n.id === id ? { ...n, read: true, read_at: new Date().toISOString() } : n
      )
    );
    setUnreadCount(prev => Math.max(0, prev - 1));

    // API call
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
    } catch (error) {
      console.error('[Notifications] Error marking read:', error);
      // Refresh on error
      fetchNotifications();
    }
  }, [fetchNotifications]);

  // Mark all as read
  const markAllAsRead = useCallback(async () => {
    // Optimistic update
    setNotifications(prev =>
      prev.map(n => ({ ...n, read: true, read_at: n.read_at || new Date().toISOString() }))
    );
    setUnreadCount(0);

    // API call
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch (error) {
      console.error('[Notifications] Error marking all read:', error);
      fetchNotifications();
    }
  }, [fetchNotifications]);

  // Initial fetch
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          console.log('[Notifications] New notification:', payload.new);
          const newNotification = payload.new as Notification;
          setNotifications(prev => [newNotification, ...prev]);
          setUnreadCount(prev => prev + 1);
          
          // Play notification sound (optional)
          try {
            const audio = new Audio('/notification.mp3');
            audio.volume = 0.5;
            audio.play().catch(() => {}); // Ignore autoplay errors
          } catch {}
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Poll every 30 seconds as backup
  useEffect(() => {
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead,
        refresh: fetchNotifications,
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
