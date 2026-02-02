'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface ActivityFeedContextType {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const ActivityFeedContext = createContext<ActivityFeedContextType | undefined>(undefined);

export function ActivityFeedProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = () => setIsOpen(true);
  const close = () => setIsOpen(false);
  const toggle = () => setIsOpen(prev => !prev);

  return (
    <ActivityFeedContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </ActivityFeedContext.Provider>
  );
}

export function useActivityFeed() {
  const context = useContext(ActivityFeedContext);
  if (context === undefined) {
    throw new Error('useActivityFeed must be used within an ActivityFeedProvider');
  }
  return context;
}
