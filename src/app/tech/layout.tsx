'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Briefcase, Clock, User } from 'lucide-react';

const inter = Inter({ subsets: ['latin'] });

export default function TechLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  
  const navItems = [
    { href: '/tech', label: 'Jobs', icon: Briefcase },
    { href: '/tech/timesheet', label: 'Timesheet', icon: Clock },
    { href: '/tech/profile', label: 'Profile', icon: User },
  ];

  return (
    <AuthProvider>
      <div className={`${inter.className} min-h-screen bg-gray-50 pb-20`}>
        {/* Main content */}
        <main className="max-w-lg mx-auto">
          {children}
        </main>
        
        {/* Bottom navigation */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom z-50">
          <div className="max-w-lg mx-auto flex">
            {navItems.map((item) => {
              const isActive = pathname === item.href || 
                (item.href !== '/tech' && pathname.startsWith(item.href));
              const Icon = item.icon;
              
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex-1 flex flex-col items-center py-3 px-2 transition-colors ${
                    isActive 
                      ? 'text-[#4e9271]' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon className="h-6 w-6" />
                  <span className="text-xs mt-1 font-medium">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </AuthProvider>
  );
}
