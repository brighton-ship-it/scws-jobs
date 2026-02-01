'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/contexts/SidebarContext';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  FileText,
  Settings,
  LogOut,
  Wrench,
  Calendar,
  Truck,
  ClipboardList,
  BarChart3,
  X,
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Customers', href: '/customers', icon: Users },
  { name: 'Jobs', href: '/jobs', icon: Briefcase },
  { name: 'Schedule', href: '/schedule', icon: Calendar },
  { name: 'Dispatch', href: '/dispatch', icon: Truck },
  { name: 'Quotes', href: '/quotes', icon: ClipboardList },
  { name: 'Invoices', href: '/invoices', icon: FileText },
  { name: 'Reports', href: '/reports', icon: BarChart3 },
];

const adminNavigation = [
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, signOut, isAdmin } = useAuth();
  const { isOpen, close } = useSidebar();

  const handleNavClick = () => {
    // Close sidebar on mobile after navigation
    if (window.innerWidth < 1024) {
      close();
    }
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={close}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed lg:static inset-y-0 left-0 z-50
        flex h-full w-64 flex-col bg-slate-900
        transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        lg:transform-none
      `}>
        {/* Logo */}
        <div className="flex h-16 items-center justify-between px-6 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Wrench className="h-8 w-8 text-blue-500" />
            <div>
              <h1 className="text-lg font-bold text-white">SCWS</h1>
              <p className="text-xs text-slate-400">Job Management</p>
            </div>
          </div>
          {/* Close button - mobile only */}
          <button
            onClick={close}
            className="lg:hidden rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== '/' && pathname.startsWith(item.href));
            
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={handleNavClick}
                className={`
                  flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                  ${isActive 
                    ? 'bg-blue-600 text-white' 
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'}
                `}
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}

          {isAdmin && (
            <>
              <div className="my-4 border-t border-slate-800" />
              {adminNavigation.map((item) => {
                const isActive = pathname === item.href || 
                  (item.href !== '/' && pathname.startsWith(item.href));
                
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={handleNavClick}
                    className={`
                      flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                      ${isActive 
                        ? 'bg-blue-600 text-white' 
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'}
                    `}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.name}
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        {/* User section */}
        <div className="border-t border-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-medium text-white">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.name || 'User'}</p>
              <p className="text-xs text-slate-400 capitalize">{user?.role || 'Unknown'}</p>
            </div>
            <button
              onClick={() => signOut()}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              title="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
