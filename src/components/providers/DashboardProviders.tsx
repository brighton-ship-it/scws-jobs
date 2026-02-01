'use client';

import { ReactNode, Suspense } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { SearchProvider } from '@/contexts/SearchContext';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { Toaster } from '@/components/feedback/Toaster';

function DashboardSkeleton() {
  return (
    <div className="flex h-screen bg-gray-50">
      <div className="hidden lg:block w-64 bg-gray-100 animate-pulse" />
      <div className="flex flex-1 flex-col">
        <div className="h-16 bg-gray-100 animate-pulse" />
        <div className="flex-1 p-6">
          <div className="h-32 bg-gray-100 rounded-lg animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function DashboardContent({ children }: { children: ReactNode }) {
  const { isCollapsed } = useSidebar();
  
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className={`
        flex flex-1 flex-col overflow-hidden w-full
        transition-all duration-300
        ${isCollapsed ? 'lg:ml-0' : 'lg:ml-0'}
      `}>
        <Header />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

export function DashboardProviders({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <AuthProvider>
        <NotificationProvider>
          <SearchProvider>
            <SidebarProvider>
              <DashboardContent>{children}</DashboardContent>
              <GlobalSearch />
              <Toaster />
            </SidebarProvider>
          </SearchProvider>
        </NotificationProvider>
      </AuthProvider>
    </Suspense>
  );
}
