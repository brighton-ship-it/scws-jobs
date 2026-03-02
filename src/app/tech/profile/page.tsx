'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import {
  User,
  Phone,
  Mail,
  LogOut,
  Shield,
  Settings,
  ChevronRight,
  ChevronLeft,
  Bell,
  HelpCircle,
  Smartphone,
  Home,
  Calendar,
  Clock,
  Search,
  MoreHorizontal,
} from 'lucide-react';

export default function TechProfilePage() {
  const { user, signOut } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleSignOut = async () => {
    setIsLoggingOut(true);
    await signOut();
  };

  // Use a fallback field user for demo if no user is logged in
  const demoUser = user || { id: '6', name: 'Travis Sego', email: 'travis@scwellservice.com', role: 'field' as const, phone: '(760) 440-8520', created_at: '2024-01-01' };

  const roleDisplay = {
    admin: 'Administrator',
    office: 'Office Staff',
    field: 'Field Technician',
  };

  const menuItems = [
    { icon: Bell, label: 'Notifications', href: '/tech/notifications' },
    { icon: Smartphone, label: 'App Settings', href: '/tech/settings' },
    { icon: HelpCircle, label: 'Help & Support', href: '/tech/help' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white px-4 pt-6 pb-4 border-b flex items-center gap-3">
        <Link href="/tech/more" className="p-2 -ml-2 rounded-full hover:bg-gray-100">
          <ChevronLeft className="h-5 w-5 text-gray-600" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-[#1f3b4d]">Profile</h1>
          <p className="text-sm text-gray-500">Manage your account</p>
        </div>
      </div>
      
      <div className="p-4 space-y-4">

      {/* User Info Card */}
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="h-16 w-16 rounded-full bg-[#4e9271] flex items-center justify-center text-white text-xl font-bold">
              {demoUser.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-900">{demoUser.name}</h2>
              <div className="flex items-center gap-1 text-sm text-gray-500">
                <Shield className="h-4 w-4" />
                <span>{roleDisplay[demoUser.role] || demoUser.role}</span>
              </div>
            </div>
          </div>

          {/* Contact Info */}
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3 text-gray-600">
              <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center">
                <Mail className="h-5 w-5 text-gray-500" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Email</p>
                <p className="text-sm font-medium">{demoUser.email}</p>
              </div>
            </div>
            {demoUser.phone && (
              <div className="flex items-center gap-3 text-gray-600">
                <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center">
                  <Phone className="h-5 w-5 text-gray-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Phone</p>
                  <p className="text-sm font-medium">{demoUser.phone}</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Menu Items */}
      <Card>
        <CardContent className="py-2">
          {menuItems.map((item, index) => (
            <Link
              key={item.label}
              href={item.href}
              className={`flex items-center justify-between py-3 ${
                index !== menuItems.length - 1 ? 'border-b border-gray-100' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <item.icon className="h-5 w-5 text-gray-400" />
                <span className="font-medium text-gray-700">{item.label}</span>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-400" />
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* App Info */}
      <Card>
        <CardContent className="py-4">
          <div className="text-center">
            <p className="text-sm text-gray-500">SCWS Tech App</p>
            <p className="text-xs text-gray-400 mt-1">Version 1.0.0</p>
          </div>
        </CardContent>
      </Card>

      {/* Sign Out */}
      <Button
        variant="outline"
        fullWidth
        className="h-12 text-red-600 border-red-200 hover:bg-red-50"
        onClick={handleSignOut}
        loading={isLoggingOut}
        leftIcon={<LogOut className="h-5 w-5" />}
      >
        Sign Out
      </Button>
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
