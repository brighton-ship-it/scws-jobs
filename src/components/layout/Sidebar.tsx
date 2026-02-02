'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/contexts/SidebarContext';
import {
  LayoutDashboard,
  Users,
  User,
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
  CheckSquare,
  Inbox,
  Package,
  Droplets,
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
      { name: 'Requests', href: '/requests', icon: Inbox },
      { name: 'Quotes', href: '/quotes', icon: ClipboardList },
      { name: 'Jobs', href: '/jobs', icon: Briefcase },
      { name: 'My Jobs', href: '/jobs/my-jobs', icon: User },
      { name: 'Invoices', href: '/invoices', icon: FileText },
    ],
  },
  {
    name: 'Operations',
    items: [
      { name: 'Dispatch', href: '/dispatch', icon: Truck },
      { name: 'Tasks', href: '/tasks', icon: CheckSquare },
      { name: 'Reports', href: '/reports', icon: BarChart3 },
    ],
  },
  {
    name: 'SCWS Tools',
    items: [
      { name: 'Inventory', href: '/inventory', icon: Package },
      { name: 'Well Tools', href: '/well-tools', icon: Droplets },
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

      {/* Sidebar - Jobber light theme */}
      <div className={`
        fixed lg:static inset-y-0 left-0 z-50
        flex h-full flex-col bg-white border-r border-gray-200
        transform transition-all duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${isCollapsed ? 'w-16' : 'w-64'}
        lg:transform-none
      `}>
        {/* Logo - Light branded area */}
        <div className={`flex h-16 items-center ${isCollapsed ? 'justify-center px-2' : 'justify-between px-5'} border-b border-gray-200`}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600">
              <Wrench className="h-5 w-5 text-white" />
            </div>
            {!isCollapsed && (
              <div>
                <h1 className="text-lg font-bold text-gray-900 tracking-tight">SCWS</h1>
                <p className="text-xs text-gray-500">Job Management</p>
              </div>
            )}
          </div>
          {/* Close button - mobile only */}
          {!isCollapsed && (
            <button
              onClick={close}
              className="lg:hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          {navigationGroups.map((group, idx) => (
            <div key={group.name} className={idx > 0 ? 'mt-5' : ''}>
              {/* Group label - hidden when collapsed */}
              {!isCollapsed && (
                <div className="px-5 mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    {group.name}
                  </span>
                </div>
              )}
              {isCollapsed && idx > 0 && (
                <div className="mx-3 my-2 border-t border-gray-200" />
              )}
              <div className="space-y-0.5 px-3">
                {group.items.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={handleNavClick}
                    title={isCollapsed ? item.name : undefined}
                    className={`
                      flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all
                      ${isCollapsed ? 'justify-center' : ''}
                      ${isActive(item.href)
                        ? 'bg-emerald-50 text-emerald-700' 
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}
                    `}
                  >
                    <item.icon className={`h-5 w-5 flex-shrink-0 ${isActive(item.href) ? 'text-emerald-600' : ''}`} />
                    {!isCollapsed && item.name}
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {isAdmin && (
            <>
              {isCollapsed ? (
                <div className="mx-3 my-4 border-t border-gray-200" />
              ) : (
                <div className="mt-5 px-5 mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Admin
                  </span>
                </div>
              )}
              <div className="space-y-0.5 px-3">
                {adminNavigation.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={handleNavClick}
                    title={isCollapsed ? item.name : undefined}
                    className={`
                      flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all
                      ${isCollapsed ? 'justify-center' : ''}
                      ${isActive(item.href)
                        ? 'bg-emerald-50 text-emerald-700' 
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}
                    `}
                  >
                    <item.icon className={`h-5 w-5 flex-shrink-0 ${isActive(item.href) ? 'text-emerald-600' : ''}`} />
                    {!isCollapsed && item.name}
                  </Link>
                ))}
              </div>
            </>
          )}
        </nav>

        {/* Collapse toggle - desktop only */}
        <div className="hidden lg:block border-t border-gray-200">
          <button
            onClick={toggleCollapse}
            className={`
              w-full flex items-center gap-3 px-3 py-3 text-sm font-medium text-gray-500
              hover:bg-gray-100 hover:text-gray-700 transition-colors
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

        {/* User section - Light theme */}
        <div className="p-4 border-t border-gray-200">
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-sm font-semibold text-white flex-shrink-0 shadow-sm">
              {user?.name?.charAt(0) || 'U'}
            </div>
            {!isCollapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{user?.name || 'User'}</p>
                  <p className="text-xs text-gray-500 capitalize">{user?.role || 'Unknown'}</p>
                </div>
                <button
                  onClick={() => signOut()}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
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
