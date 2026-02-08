'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Calendar, 
  User, 
  Phone, 
  AlertCircle, 
  CheckCircle2, 
  Clock,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  Settings,
  Plus,
} from 'lucide-react';
import { format, addWeeks, startOfWeek, isWeekend, isSameDay, parseISO } from 'date-fns';
import Link from 'next/link';

interface OnCallSlot {
  id?: string;
  slot_date: string;
  status: 'open' | 'filled' | 'completed';
  assigned_user?: {
    id: string;
    name: string;
    email: string;
    phone?: string;
  } | null;
  signups?: Array<{
    id: string;
    status: string;
    user: { id: string; name: string };
  }>;
  notes?: string;
}

interface Settings {
  availability_pay_daily: number;
  callout_multiplier: number;
  minimum_callout_hours: number;
  base_hourly_rate: number;
}

export default function OnCallPage() {
  const [slots, setSlots] = useState<OnCallSlot[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState('');

  const startDate = startOfWeek(addWeeks(new Date(), weekOffset));
  const endDate = addWeeks(startDate, 8);

  useEffect(() => {
    fetchData();
  }, [weekOffset]);

  const fetchData = async () => {
    try {
      const [slotsRes, settingsRes, usersRes] = await Promise.all([
        fetch(`/api/on-call/slots?start=${format(startDate, 'yyyy-MM-dd')}&end=${format(endDate, 'yyyy-MM-dd')}`),
        fetch('/api/on-call/settings'),
        fetch('/api/users?role=tech'),
      ]);

      if (slotsRes.ok) {
        const data = await slotsRes.json();
        setSlots(data.slots || []);
      }
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setSettings(data.settings);
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async (slotDate: string, userId: string) => {
    try {
      const res = await fetch('/api/on-call/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot_date: slotDate,
          user_id: userId,
          auto_approve: true,
        }),
      });

      if (res.ok) {
        fetchData();
        setAssigning(null);
        setSelectedUser('');
      }
    } catch (error) {
      console.error('Failed to assign:', error);
    }
  };

  const handleClear = async (slotId: string) => {
    if (!confirm('Remove this assignment?')) return;
    
    try {
      const res = await fetch(`/api/on-call/slots/${slotId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error('Failed to clear:', error);
    }
  };

  const getSlotForDate = (date: Date): OnCallSlot | undefined => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return slots.find(s => s.slot_date === dateStr);
  };

  // Group slots by week
  const weekends: Date[][] = [];
  let currentDate = startDate;
  while (currentDate < endDate) {
    const weekendDays: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(currentDate);
      day.setDate(day.getDate() + i);
      if (isWeekend(day)) {
        weekendDays.push(day);
      }
    }
    if (weekendDays.length > 0) {
      weekends.push(weekendDays);
    }
    currentDate = addWeeks(currentDate, 1);
  }

  // Stats
  const upcomingSlots = slots.filter(s => new Date(s.slot_date) >= new Date());
  const filledSlots = upcomingSlots.filter(s => s.status === 'filled' || s.assigned_user);
  const openSlots = upcomingSlots.filter(s => s.status === 'open' && !s.assigned_user);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1f3b4d]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">On-Call Schedule</h1>
          <p className="text-gray-600">Manage weekend on-call coverage</p>
        </div>
        <Link href="/settings/on-call">
          <Button variant="outline">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{filledSlots.length}</p>
                <p className="text-sm text-gray-500">Covered</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <AlertCircle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{openSlots.length}</p>
                <p className="text-sm text-gray-500">Need Coverage</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <DollarSign className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">${settings?.availability_pay_daily || 75}</p>
                <p className="text-sm text-gray-500">Daily Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Clock className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{settings?.callout_multiplier || 1.5}x</p>
                <p className="text-sm text-gray-500">Callout Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => setWeekOffset(w => w - 4)}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Earlier
        </Button>
        <span className="text-sm text-gray-600">
          {format(startDate, 'MMM d')} - {format(endDate, 'MMM d, yyyy')}
        </span>
        <Button variant="outline" onClick={() => setWeekOffset(w => w + 4)}>
          Later
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Schedule Grid */}
      <div className="space-y-4">
        {weekends.map((weekend, idx) => (
          <Card key={idx}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Week of {format(weekend[0], 'MMMM d')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {weekend.map(day => {
                  const slot = getSlotForDate(day);
                  const isPast = day < new Date();
                  const isToday = isSameDay(day, new Date());
                  
                  return (
                    <div
                      key={day.toISOString()}
                      className={`p-4 rounded-lg border-2 ${
                        slot?.assigned_user
                          ? 'border-green-200 bg-green-50'
                          : isPast
                          ? 'border-gray-200 bg-gray-50'
                          : 'border-amber-200 bg-amber-50'
                      } ${isToday ? 'ring-2 ring-blue-500' : ''}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-semibold text-gray-900">
                            {format(day, 'EEEE')}
                          </p>
                          <p className="text-sm text-gray-500">
                            {format(day, 'MMM d, yyyy')}
                          </p>
                        </div>
                        {slot?.assigned_user ? (
                          <Badge variant="success">Covered</Badge>
                        ) : isPast ? (
                          <Badge variant="secondary">Past</Badge>
                        ) : (
                          <Badge variant="warning">Open</Badge>
                        )}
                      </div>

                      {slot?.assigned_user ? (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-[#1f3b4d] flex items-center justify-center">
                              <User className="h-4 w-4 text-white" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{slot.assigned_user.name}</p>
                              {slot.assigned_user.phone && (
                                <p className="text-xs text-gray-500">{slot.assigned_user.phone}</p>
                              )}
                            </div>
                          </div>
                          {!isPast && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => slot.id && handleClear(slot.id)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      ) : !isPast ? (
                        assigning === format(day, 'yyyy-MM-dd') ? (
                          <div className="flex items-center gap-2">
                            <select
                              value={selectedUser}
                              onChange={(e) => setSelectedUser(e.target.value)}
                              className="flex-1 text-sm border rounded-lg px-2 py-1.5"
                            >
                              <option value="">Select tech...</option>
                              {users.map(u => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              onClick={() => selectedUser && handleAssign(format(day, 'yyyy-MM-dd'), selectedUser)}
                              disabled={!selectedUser}
                            >
                              Assign
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setAssigning(null); setSelectedUser(''); }}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => setAssigning(format(day, 'yyyy-MM-dd'))}
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Assign Tech
                          </Button>
                        )
                      ) : (
                        <p className="text-sm text-gray-400 italic">No coverage recorded</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
