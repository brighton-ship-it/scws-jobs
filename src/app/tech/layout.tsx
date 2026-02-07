'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export default function TechLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className={`${inter.className} min-h-screen bg-gray-50`}>
        <main className="max-w-lg mx-auto">
          {children}
        </main>
      </div>
    </AuthProvider>
  );
}
