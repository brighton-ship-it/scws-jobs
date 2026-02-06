'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { 
  Home, 
  Calendar, 
  Clock, 
  Search,
  MoreHorizontal,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  activeIcon?: React.ReactNode;
}

const navItems: NavItem[] = [
  { 
    label: 'Home', 
    href: '/', 
    icon: <Home className="h-6 w-6" strokeWidth={1.5} />,
    activeIcon: <Home className="h-6 w-6" strokeWidth={2} />,
  },
  { 
    label: 'Schedule', 
    href: '/schedule', 
    icon: <Calendar className="h-6 w-6" strokeWidth={1.5} />,
    activeIcon: <Calendar className="h-6 w-6" strokeWidth={2} />,
  },
  { 
    label: 'Timesheet', 
    href: '/tech/timesheet', 
    icon: <Clock className="h-6 w-6" strokeWidth={1.5} />,
    activeIcon: <Clock className="h-6 w-6" strokeWidth={2} />,
  },
  { 
    label: 'Search', 
    href: '/customers', 
    icon: <Search className="h-6 w-6" strokeWidth={1.5} />,
    activeIcon: <Search className="h-6 w-6" strokeWidth={2} />,
  },
  { 
    label: 'More', 
    href: '/settings', 
    icon: <MoreHorizontal className="h-6 w-6" strokeWidth={1.5} />,
    activeIcon: <MoreHorizontal className="h-6 w-6" strokeWidth={2} />,
  },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  // Don't show on login page or portal pages
  if (pathname === '/login' || pathname.startsWith('/portal/') || pathname.startsWith('/pay')) {
    return null;
  }

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 md:hidden safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors ${
                active 
                  ? 'text-green-700' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {active ? (item.activeIcon || item.icon) : item.icon}
              <span className={`text-xs ${active ? 'font-medium' : ''}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
