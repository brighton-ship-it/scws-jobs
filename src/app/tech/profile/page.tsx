'use client';

import { useState } from 'react';
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
  Bell,
  HelpCircle,
  Smartphone,
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
    { icon: Bell, label: 'Notifications', href: '#' },
    { icon: Smartphone, label: 'App Settings', href: '#' },
    { icon: HelpCircle, label: 'Help & Support', href: '#' },
  ];

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#1f3b4d]">Profile</h1>
        <p className="text-sm text-gray-500">Manage your account</p>
      </div>

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
            <a
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
            </a>
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
  );
}
