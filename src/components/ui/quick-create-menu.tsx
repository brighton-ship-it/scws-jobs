'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { 
  Plus, 
  X,
  Briefcase,
  Users,
  FileText,
  Receipt,
  ClipboardList,
  Truck,
} from 'lucide-react';

interface QuickCreateOption {
  label: string;
  href: string;
  icon: React.ReactNode;
  color: string;
  adminOnly?: boolean;
}

const createOptions: QuickCreateOption[] = [
  { 
    label: 'Job', 
    href: '/jobs/new', 
    icon: <Briefcase className="h-5 w-5" />,
    color: 'bg-blue-500',
    adminOnly: true,
  },
  { 
    label: 'Client', 
    href: '/customers/new', 
    icon: <Users className="h-5 w-5" />,
    color: 'bg-green-500',
    adminOnly: true,
  },
  { 
    label: 'Quote', 
    href: '/quotes/new', 
    icon: <FileText className="h-5 w-5" />,
    color: 'bg-purple-500',
    adminOnly: true,
  },
  { 
    label: 'Invoice', 
    href: '/invoices/new', 
    icon: <Receipt className="h-5 w-5" />,
    color: 'bg-amber-500',
    adminOnly: true,
  },
  { 
    label: 'Request', 
    href: '/requests?new=true', 
    icon: <ClipboardList className="h-5 w-5" />,
    color: 'bg-teal-500',
    adminOnly: true,
  },
  { 
    label: 'Expense', 
    href: '/expenses?new=true', 
    icon: <Truck className="h-5 w-5" />,
    color: 'bg-red-500',
    adminOnly: true,
  },
];

export function QuickCreateMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { isAdmin, isOffice, user } = useAuth();

  // Show for admin, office, or if no role set (owner/default account)
  const canCreate = isAdmin || isOffice || !user?.role;
  
  // Filter options based on role
  const visibleOptions = createOptions.filter(opt => {
    if (opt.adminOnly && !canCreate) return false;
    return true;
  });

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Don't render for techs (explicit tech role)
  if (user?.role === 'tech' || user?.role === 'field') {
    return null;
  }

  return (
    <div ref={menuRef} className="fixed bottom-24 md:bottom-6 right-6 z-50">
      {/* Options - shown when open */}
      {isOpen && (
        <div className="absolute bottom-16 right-0 flex flex-col-reverse gap-3 mb-2">
          {visibleOptions.map((option, index) => (
            <Link
              key={option.label}
              href={option.href}
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <span className="bg-white text-gray-700 text-sm font-medium px-3 py-1.5 rounded-full shadow-lg whitespace-nowrap">
                {option.label}
              </span>
              <div className={`${option.color} h-12 w-12 rounded-full flex items-center justify-center text-white shadow-lg`}>
                {option.icon}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Main FAB Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`h-14 w-14 rounded-full flex items-center justify-center text-white shadow-lg transition-all duration-200 ${
          isOpen 
            ? 'bg-gray-700 rotate-45' 
            : 'bg-green-600 hover:bg-green-700'
        }`}
      >
        {isOpen ? (
          <X className="h-6 w-6 rotate-45" />
        ) : (
          <Plus className="h-6 w-6" />
        )}
      </button>
    </div>
  );
}

// Compact version for use in headers
export function QuickCreateButton() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { isAdmin, isOffice, user } = useAuth();

  // Show for admin, office, or if no role set (owner/default account)
  const canCreate = isAdmin || isOffice || !user?.role;
  
  // Filter options based on role
  const visibleOptions = createOptions.filter(opt => {
    if (opt.adminOnly && !canCreate) return false;
    return true;
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Don't render for techs (explicit tech role)
  if (user?.role === 'tech' || user?.role === 'field') {
    return null;
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="h-9 w-9 rounded-full bg-green-600 hover:bg-green-700 flex items-center justify-center text-white transition-colors"
      >
        <Plus className="h-5 w-5" />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 py-2 min-w-[160px] z-50">
          {visibleOptions.map((option) => (
            <Link
              key={option.label}
              href={option.href}
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors"
            >
              <div className={`${option.color} h-8 w-8 rounded-full flex items-center justify-center text-white`}>
                {option.icon}
              </div>
              <span className="text-sm font-medium text-gray-700">{option.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
