'use client';


import { Card, CardContent } from '@/components/ui/Card';
import { 
  Building2, 
  Users, 
  Bell, 
  CreditCard, 
  Puzzle,
  ArrowRight,
  ChevronRight,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';

const settingsLinks = [
  {
    title: 'Company',
    description: 'Business name, address, and logo',
    href: '/settings/company',
    icon: Building2,
    color: 'bg-blue-100 text-blue-600',
  },
  {
    title: 'Team',
    description: 'Manage users and permissions',
    href: '/settings/users',
    icon: Users,
    color: 'bg-green-100 text-green-600',
  },
  {
    title: 'Notifications',
    description: 'Email and push notification preferences',
    href: '/settings/notifications',
    icon: Bell,
    color: 'bg-purple-100 text-purple-600',
  },
  {
    title: 'Billing',
    description: 'Tax rates and payment terms',
    href: '/settings/billing',
    icon: CreditCard,
    color: 'bg-orange-100 text-orange-600',
  },
  {
    title: 'Payments',
    description: 'Payment methods and processing fees',
    href: '/settings/payments',
    icon: Wallet,
    color: 'bg-teal-100 text-teal-600',
  },
  {
    title: 'Integrations',
    description: 'Connect to Stripe, QuickBooks, and more',
    href: '/settings/integrations',
    icon: Puzzle,
    color: 'bg-pink-100 text-pink-600',
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
        <p className="text-gray-600">Manage your account and preferences</p>
      </div>

      <div className="grid gap-4">
        {settingsLinks.map((link) => (
          <Link key={link.title} href={link.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="flex items-center gap-4 p-4">
                <div className={`rounded-lg p-3 ${link.color}`}>
                  <link.icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900">{link.title}</h3>
                  <p className="text-sm text-gray-600">{link.description}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-400" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
