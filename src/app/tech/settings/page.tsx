'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import {
  Home,
  Calendar,
  Clock,
  Search,
  MoreHorizontal,
  ChevronLeft,
  Bell,
  Moon,
  Globe,
  Shield,
  ChevronRight,
} from 'lucide-react';

export default function TechSettingsPage() {
  const { user } = useAuth();

  const settingsItems = [
    { icon: Bell, label: 'Notifications', href: '/tech/notifications', description: 'Push notifications & alerts' },
    { icon: Moon, label: 'Appearance', href: '#', description: 'Coming soon', disabled: true },
    { icon: Globe, label: 'Language', href: '#', description: 'English (US)', disabled: true },
    { icon: Shield, label: 'Privacy', href: '#', description: 'Coming soon', disabled: true },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white px-4 pt-6 pb-4 border-b flex items-center gap-3">
        <Link href="/tech/more" className="p-2 -ml-2 rounded-full hover:bg-gray-100">
          <ChevronLeft className="h-5 w-5 text-gray-600" />
        </Link>
        <h1 className="text-xl font-bold text-[#1f3b4d]">Settings</h1>
      </div>

      <div className="p-4 space-y-2">
        {settingsItems.map((item) => {
          const Icon = item.icon;
          
          if (item.disabled) {
            return (
              <Card key={item.label} className="opacity-50">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full flex items-center justify-center bg-gray-100 text-gray-600">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <span className="font-medium text-gray-900">{item.label}</span>
                      <p className="text-sm text-gray-500">{item.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          }
          
          return (
            <Link key={item.label} href={item.href}>
              <Card className="hover:bg-gray-50 active:bg-gray-100">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full flex items-center justify-center bg-gray-100 text-gray-600">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <span className="font-medium text-gray-900">{item.label}</span>
                      <p className="text-sm text-gray-500">{item.description}</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* App Info */}
      <div className="px-4 mt-8 text-center">
        <p className="text-xs text-gray-400">SCWS Tech App v1.0</p>
        <p className="text-xs text-gray-400">Logged in as {user?.email}</p>
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
