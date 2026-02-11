'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import {
  Home,
  Calendar,
  Clock,
  Search,
  MoreHorizontal,
  ChevronLeft,
  Phone,
  MessageSquare,
  FileText,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

export default function TechHelpPage() {
  const helpItems = [
    { 
      icon: Phone, 
      label: 'Call Office', 
      description: '(760) 440-8520',
      href: 'tel:7604408520',
      color: 'bg-green-100 text-green-600'
    },
    { 
      icon: MessageSquare, 
      label: 'Text Office', 
      description: 'Send a quick message',
      href: 'sms:7608237963',
      color: 'bg-blue-100 text-blue-600'
    },
    { 
      icon: FileText, 
      label: 'Equipment Manuals', 
      description: 'Pump specs & guides',
      href: '#',
      disabled: true,
      color: 'bg-purple-100 text-purple-600'
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white px-4 pt-6 pb-4 border-b flex items-center gap-3">
        <Link href="/tech/more" className="p-2 -ml-2 rounded-full hover:bg-gray-100">
          <ChevronLeft className="h-5 w-5 text-gray-600" />
        </Link>
        <h1 className="text-xl font-bold text-[#1f3b4d]">Help & Support</h1>
      </div>

      <div className="p-4 space-y-4">
        {/* Contact Options */}
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-500 px-1">Contact</h2>
          {helpItems.map((item) => {
            const Icon = item.icon;
            
            if (item.disabled) {
              return (
                <Card key={item.label} className="opacity-50">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${item.color}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <span className="font-medium text-gray-900">{item.label}</span>
                        <p className="text-sm text-gray-500">Coming soon</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            }
            
            return (
              <a key={item.label} href={item.href}>
                <Card className="hover:bg-gray-50 active:bg-gray-100">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${item.color}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <span className="font-medium text-gray-900">{item.label}</span>
                        <p className="text-sm text-gray-500">{item.description}</p>
                      </div>
                      <ExternalLink className="h-5 w-5 text-gray-400" />
                    </div>
                  </CardContent>
                </Card>
              </a>
            );
          })}
        </div>

        {/* Quick Tips */}
        <Card>
          <CardContent className="py-4">
            <h3 className="font-medium text-gray-900 mb-3">Quick Tips</h3>
            <ul className="text-sm text-gray-600 space-y-2">
              <li>• <strong>Clock in</strong> when you arrive at first job</li>
              <li>• <strong>Take photos</strong> before and after each job</li>
              <li>• <strong>Add notes</strong> for anything the office should know</li>
              <li>• <strong>Mark complete</strong> when job is done</li>
            </ul>
          </CardContent>
        </Card>

        {/* Emergency */}
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4">
            <h3 className="font-medium text-red-800 mb-2">🚨 Emergency?</h3>
            <p className="text-sm text-red-700 mb-3">
              For urgent safety issues or after-hours emergencies:
            </p>
            <a 
              href="tel:7604408520" 
              className="inline-block px-4 py-2 bg-red-600 text-white rounded-lg font-medium text-sm"
            >
              Call Brighton Direct
            </a>
          </CardContent>
        </Card>
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
