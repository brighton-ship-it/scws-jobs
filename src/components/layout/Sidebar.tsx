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
  ChevronLeft,
  ChevronRight,
  Receipt,
  CreditCard,
  MessageSquare,
  Clock,
} from 'lucide-react';

// Jobber-style navigation groups
const navigationGroups = [
  {
    name: 'Core',
    items: [
      { name: 'Home', href: '/', icon: LayoutDashboard },
      { name: 'Schedule', href: '/schedule', icon: Calendar },
    ],
  },
  {
    name: 'Work Management',
    items: [
      { name: 'Customers', href: '/customers', icon: Users },
      { name: 'Quotes', href: '/quotes', icon: ClipboardList },
      { name: 'Jobs', href: '/jobs', icon: Briefcase },
      { name: 'Invoices', href: '/invoices', icon: FileText },
    ],
  },
  {
    name: 'Operations',
    items: [
      { name: 'Dispatch', href: '/dispatch', icon: Truck },
      { name: 'Reports', href: '/reports', icon: BarChart3 },
    ],
  },
];

const adminNavigation = [
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, signOut, isAdmin } = useAuth();
  const { isOpen, isCollapsed, close, toggleCollapse } = useSidebar();

  const handleNavClick = () => {
    // Close sidebar on mobile after navigation
    if (window.innerWidth < 1024) {
      close();
    }
  };

  const isActive = (href: string) => {
    return pathname === href || (href !== '/' && pathname.startsWith(href));
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
        flex h-full flex-col bg-slate-900
        transform transition-all duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${isCollapsed ? 'w-16' : 'w-64'}
        lg:transform-none
      `}>
        {/* Logo */}
        <div className={`flex h-16 items-center border-b border-slate-800 ${isCollapsed ? 'justify-center px-2' : 'justify-between px-6'}`}>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-600">
              <Wrench className="h-5 w-5 text-white" />
            </div>
            {!isCollapsed && (
              <div>
                <h1 className="text-lg font-bold text-white">SCWS</h1>
                <p className="text-xs text-slate-400">Job Management</p>
              </div>
            )}
          </div>
          {/* Close button - mobile only */}
          {!isCollapsed && (
            <button
              onClick={close}
              className="lg:hidden rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          {navigationGroups.map((group, idx) => (
            <div key={group.name} className={idx > 0 ? 'mt-4' : ''}>
              {/* Group label - hidden when collapsed */}
              {!isCollapsed && (
                <div className="px-4 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {group.name}
                  </span>
                </div>
              )}
              {isCollapsed && idx > 0 && (
                <div className="mx-3 my-2 border-t border-slate-800" />
              )}
              <div className="space-y-1 px-3">
                {group.items.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={handleNavClick}
                    title={isCollapsed ? item.name : undefined}
                    className={`
                      flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                      ${isCollapsed ? 'justify-center' : ''}
                      ${isActive(item.href)
                        ? 'bg-green-600 text-white' 
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'}
                    `}
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    {!isCollapsed && item.name}
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {isAdmin && (
            <>
              {isCollapsed ? (
                <div className="mx-3 my-4 border-t border-slate-800" />
              ) : (
                <div className="mt-4 px-4 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Admin
                  </span>
                </div>
              )}
              <div className="space-y-1 px-3">
                {adminNavigation.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={handleNavClick}
                    title={isCollapsed ? item.name : undefined}
                    className={`
                      flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                      ${isCollapsed ? 'justify-center' : ''}
                      ${isActive(item.href)
                        ? 'bg-green-600 text-white' 
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'}
                    `}
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    {!isCollapsed && item.name}
                  </Link>
                ))}
              </div>
            </>
          )}
        </nav>

        {/* Collapse toggle - desktop only */}
        <div className="hidden lg:block border-t border-slate-800">
          <button
            onClick={toggleCollapse}
            className={`
              w-full flex items-center gap-3 px-3 py-3 text-sm font-medium text-slate-400
              hover:bg-slate-800 hover:text-white transition-colors
              ${isCollapsed ? 'justify-center' : ''}
            `}
          >
            {isCollapsed ? (
              <ChevronRight className="h-5 w-5" />
            ) : (
              <>
                <ChevronLeft className="h-5 w-5" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>

        {/* User section */}
        <div className="border-t border-slate-800 p-4">
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-600 text-sm font-medium text-white flex-shrink-0">
              {user?.name?.charAt(0) || 'U'}
            </div>
            {!isCollapsed && (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
