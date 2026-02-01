'use client';

import { ReactNode, Suspense } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { SearchProvider } from '@/contexts/SearchContext';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { Toaster } from '@/components/feedback/Toaster';

function DashboardSkeleton() {
  return (
    <div className="flex h-screen bg-gray-50">
      <div className="w-64 bg-gray-100 animate-pulse" />
      <div className="flex flex-1 flex-col">
        <div className="h-16 bg-gray-100 animate-pulse" />
        <div className="flex-1 p-6">
          <div className="h-32 bg-gray-100 rounded-lg animate-pulse" />
        </div>
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
            <div className="flex h-screen bg-gray-50">
              <Sidebar />
              <div className="flex flex-1 flex-col overflow-hidden">
                <Header />
                <main className="flex-1 overflow-y-auto p-6">
                  {children}
                </main>
              </div>
            </div>
            <GlobalSearch />
            <Toaster />
          </SearchProvider>
        </NotificationProvider>
      </AuthProvider>
    </Suspense>
  );
}
