'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Phone,
  User,
  AlertCircle,
} from 'lucide-react';
import { format, addWeeks, startOfWeek, isWeekend, isBefore, parseISO } from 'date-fns';
import Link from 'next/link';

interface OnCallSlot {
  id?: string;
  slot_date: string;
  status: 'open' | 'filled' | 'completed';
  assigned_user?: {
    id: string;
    name: string;
    phone?: string;
  } | null;
}

interface Settings {
  availability_pay_daily: number;
  callout_multiplier: number;
}

export default function TechOnCallPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [slots, setSlots] = useState<OnCallSlot[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState<string | null>(null);

  const startDate = startOfWeek(new Date());
  const endDate = addWeeks(startDate, 8);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [slotsRes, settingsRes] = await Promise.all([
        fetch(`/api/on-call/slots?start=${format(startDate, 'yyyy-MM-dd')}&end=${format(endDate, 'yyyy-MM-dd')}`),
        fetch('/api/on-call/settings'),
      ]);

      if (slotsRes.ok) {
        const data = await slotsRes.json();
        setSlots(data.slots || []);
      }
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setSettings(data.settings);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (slotDate: string) => {
    if (!user) return;
    setSigning(slotDate);

    try {
      const res = await fetch('/api/on-call/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot_date: slotDate,
          user_id: user.id,
          auto_approve: true,
        }),
      });

      if (res.ok) {
        fetchData();
      } else {
        const error = await res.json();
        alert(error.error || 'Failed to sign up');
      }
    } catch (error) {
      console.error('Failed to sign up:', error);
    } finally {
      setSigning(null);
    }
  };

  const handleCancel = async (slotId: string) => {
    if (!confirm('Cancel your on-call signup?')) return;

    try {
      const res = await fetch(`/api/on-call/slots/${slotId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error('Failed to cancel:', error);
    }
  };

  // Filter to only weekend slots
  const weekendSlots = slots.filter(s => {
    const date = parseISO(s.slot_date);
    return isWeekend(date) && !isBefore(date, new Date());
  });

  // My assignments
  const mySlots = weekendSlots.filter(s => s.assigned_user?.id === user?.id);
  const openSlots = weekendSlots.filter(s => !s.assigned_user);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1f3b4d]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-[#1f3b4d] text-white p-4 safe-area-inset-top">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 -ml-2 rounded-full hover:bg-white/10">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="font-bold text-lg">On-Call Schedule</h1>
            <p className="text-sm opacity-80">Sign up for weekend shifts</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Pay Info */}
        {settings && (
          <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
            <CardContent className="py-4">
              <div className="flex items-center gap-3 mb-2">
                <DollarSign className="h-5 w-5 text-green-600" />
                <span className="font-semibold text-green-900">On-Call Pay</span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-green-700">Daily Rate</p>
                  <p className="text-xl font-bold text-green-900">${settings.availability_pay_daily}</p>
                </div>
                <div>
                  <p className="text-green-700">Callout Rate</p>
                  <p className="text-xl font-bold text-green-900">{settings.callout_multiplier}x</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* My Shifts */}
        {mySlots.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                My On-Call Shifts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {mySlots.map(slot => (
                <div
                  key={slot.slot_date}
                  className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200"
                >
                  <div>
                    <p className="font-semibold text-green-900">
                      {format(parseISO(slot.slot_date), 'EEEE, MMM d')}
                    </p>
                    <p className="text-sm text-green-700">You're on call</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => slot.id && handleCancel(slot.id)}
                    className="text-red-600 hover:bg-red-50"
                  >
                    Cancel
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Available Slots */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              Available Weekends
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {openSlots.length === 0 ? (
              <div className="text-center py-6 text-gray-500">
                <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-green-300" />
                <p>All upcoming weekends are covered!</p>
              </div>
            ) : (
              openSlots.map(slot => (
                <div
                  key={slot.slot_date}
                  className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200"
                >
                  <div>
                    <p className="font-semibold text-amber-900">
                      {format(parseISO(slot.slot_date), 'EEEE, MMM d')}
                    </p>
                    <div className="flex items-center gap-1 text-sm text-amber-700">
                      <AlertCircle className="h-3 w-3" />
                      Needs coverage
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSignup(slot.slot_date)}
                    disabled={signing === slot.slot_date}
                    className="bg-[#4e9271] hover:bg-[#3d7a5d]"
                  >
                    {signing === slot.slot_date ? 'Signing up...' : 'Sign Up'}
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Covered Slots */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-gray-500">Covered Weekends</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {weekendSlots
              .filter(s => s.assigned_user && s.assigned_user.id !== user?.id)
              .map(slot => (
                <div
                  key={slot.slot_date}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {format(parseISO(slot.slot_date), 'EEEE, MMM d')}
                    </p>
                    <div className="flex items-center gap-1 text-sm text-gray-500">
                      <User className="h-3 w-3" />
                      {slot.assigned_user?.name}
                    </div>
                  </div>
                  <Badge variant="secondary">Covered</Badge>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-2 safe-area-pb">
        <div className="flex items-center justify-center">
          <Link href="/tech" className="text-[#4e9271] font-medium text-sm">
            ← Back to Home
          </Link>
        </div>
      </nav>
    </div>
  );
}
