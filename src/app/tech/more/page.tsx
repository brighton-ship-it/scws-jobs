'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import {
  Home,
  Calendar,
  Clock,
  Search,
  MoreHorizontal,
  User,
  Settings,
  HelpCircle,
  LogOut,
  FileText,
  Bell,
  ChevronRight,
  Phone,
  PhoneCall,
} from 'lucide-react';

export default function TechMorePage() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  const menuItems = [
    { icon: User, label: 'My Profile', href: '/tech/profile', color: 'bg-blue-100 text-blue-600' },
    { icon: PhoneCall, label: 'On-Call Schedule', href: '/tech/on-call', color: 'bg-orange-100 text-orange-600' },
    { icon: Bell, label: 'Notifications', href: '/tech/notifications', color: 'bg-amber-100 text-amber-600' },
    { icon: FileText, label: 'My Jobs History', href: '/tech/history', color: 'bg-green-100 text-green-600' },
    { icon: Phone, label: 'Contact Office', href: 'tel:7604408520', color: 'bg-purple-100 text-purple-600' },
    { icon: Settings, label: 'Settings', href: '/tech/settings', color: 'bg-gray-100 text-gray-600' },
    { icon: HelpCircle, label: 'Help & Support', href: '/tech/help', color: 'bg-cyan-100 text-cyan-600' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white px-4 pt-6 pb-4 border-b">
        <h1 className="text-xl font-bold text-[#1f3b4d]">More</h1>
      </div>

      {/* User Card */}
      <div className="p-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 bg-[#1f3b4d] rounded-full flex items-center justify-center">
                <span className="text-xl font-bold text-white">
                  {user?.name?.charAt(0) || 'U'}
                </span>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">{user?.name || 'User'}</p>
                <p className="text-sm text-gray-500">{user?.email || ''}</p>
                <p className="text-xs text-[#4e9271] font-medium capitalize">{user?.role || 'Team Member'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Menu Items */}
      <div className="px-4 space-y-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isExternal = item.href.startsWith('tel:');
          
          if (isExternal) {
            return (
              <a key={item.label} href={item.href}>
                <Card className="hover:bg-gray-50 active:bg-gray-100">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${item.color}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="flex-1 font-medium text-gray-900">{item.label}</span>
                      <ChevronRight className="h-5 w-5 text-gray-400" />
                    </div>
                  </CardContent>
                </Card>
              </a>
            );
          }
          
          return (
            <Link key={item.label} href={item.href}>
              <Card className="hover:bg-gray-50 active:bg-gray-100">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${item.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="flex-1 font-medium text-gray-900">{item.label}</span>
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}

        {/* Sign Out Button */}
        <button onClick={handleSignOut} className="w-full mt-4">
          <Card className="hover:bg-red-50 active:bg-red-100 border-red-200">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full flex items-center justify-center bg-red-100 text-red-600">
                  <LogOut className="h-5 w-5" />
                </div>
                <span className="flex-1 font-medium text-red-600 text-left">Sign Out</span>
              </div>
            </CardContent>
          </Card>
        </button>
      </div>

      {/* App Version */}
      <div className="px-4 mt-8 text-center">
        <p className="text-xs text-gray-400">SCWS Tech App v1.0</p>
        <p className="text-xs text-gray-400">© 2026 Southern California Well Service</p>
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-2 safe-area-pb">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <Link href="/tech" className="flex flex-col items-center py-2 text-gray-400">
            <Home className="h-5 w-5" />
            <span className="text-xs mt-1">Home</span>
          </Link>
          <Link href="/tech/schedule" className="flex flex-col items-center py-2 text-gray-400">
            <Calendar className="h-5 w-5" />
            <span className="text-xs mt-1">Schedule</span>
          </Link>
          <Link href="/tech/timesheet" className="flex flex-col items-center py-2 text-gray-400">
            <Clock className="h-5 w-5" />
            <span className="text-xs mt-1">Timesheet</span>
          </Link>
          <Link href="/tech/search" className="flex flex-col items-center py-2 text-gray-400">
            <Search className="h-5 w-5" />
            <span className="text-xs mt-1">Search</span>
          </Link>
          <Link href="/tech/more" className="flex flex-col items-center py-2 text-[#1f3b4d]">
            <MoreHorizontal className="h-5 w-5" />
            <span className="text-xs mt-1 font-medium">More</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
