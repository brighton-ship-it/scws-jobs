'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import {
  Clock,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Play,
  Square,
  Trash2,
  Home,
  Search,
  MoreHorizontal,
} from 'lucide-react';
import Link from 'next/link';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, parseISO, addWeeks, subWeeks } from 'date-fns';

interface TimeEntry {
  id: number;
  clockIn: string;
  clockOut: string;
  userId: string;
}

export default function TechTimesheetPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [selectedWeek, setSelectedWeek] = useState(new Date());
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [clockInTime, setClockInTime] = useState<Date | null>(null);

  // Load time entries and clock-in state
  useEffect(() => {
    const savedEntries = localStorage.getItem('tech_time_entries');
    const savedClockIn = localStorage.getItem('tech_clock_in');
    
    if (savedEntries) {
      setEntries(JSON.parse(savedEntries));
    }
    if (savedClockIn) {
      const parsed = JSON.parse(savedClockIn);
      setIsClockedIn(true);
      setClockInTime(new Date(parsed.time));
    }
  }, []);

  const weekStart = startOfWeek(selectedWeek, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 0 });
  const daysInWeek = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Filter entries for the selected week
  const weekEntries = useMemo(() => {
    return entries.filter(entry => {
      const entryDate = parseISO(entry.clockIn);
      return entryDate >= weekStart && entryDate <= weekEnd;
    });
  }, [entries, weekStart, weekEnd]);

  // Group entries by day
  const entriesByDay = useMemo(() => {
    const grouped: Record<string, TimeEntry[]> = {};
    daysInWeek.forEach(day => {
      const dayKey = format(day, 'yyyy-MM-dd');
      grouped[dayKey] = weekEntries.filter(entry => 
        isSameDay(parseISO(entry.clockIn), day)
      );
    });
    return grouped;
  }, [weekEntries, daysInWeek]);

  // Calculate total hours for the week
  const totalWeekHours = useMemo(() => {
    return weekEntries.reduce((total, entry) => {
      const start = new Date(entry.clockIn);
      const end = new Date(entry.clockOut);
      return total + (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    }, 0);
  }, [weekEntries]);

  const calculateDuration = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diff = (endDate.getTime() - startDate.getTime()) / 1000;
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const calculateDayTotal = (dayEntries: TimeEntry[]) => {
    const totalSeconds = dayEntries.reduce((total, entry) => {
      const start = new Date(entry.clockIn);
      const end = new Date(entry.clockOut);
      return total + (end.getTime() - start.getTime()) / 1000;
    }, 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const handleDeleteEntry = (entryId: number) => {
    const updatedEntries = entries.filter(e => e.id !== entryId);
    setEntries(updatedEntries);
    localStorage.setItem('tech_time_entries', JSON.stringify(updatedEntries));
  };

  const handleClockToggle = () => {
    if (isClockedIn && clockInTime) {
      // Clock out
      localStorage.removeItem('tech_clock_in');
      const newEntry: TimeEntry = {
        id: Date.now(),
        clockIn: clockInTime.toISOString(),
        clockOut: new Date().toISOString(),
        userId: user?.id || '',
      };
      const updatedEntries = [...entries, newEntry];
      setEntries(updatedEntries);
      localStorage.setItem('tech_time_entries', JSON.stringify(updatedEntries));
      setIsClockedIn(false);
      setClockInTime(null);
    } else {
      // Clock in
      const now = new Date();
      localStorage.setItem('tech_clock_in', JSON.stringify({ time: now.toISOString() }));
      setIsClockedIn(true);
      setClockInTime(now);
    }
  };

  return (
    <div className="p-4 pb-24 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#1f3b4d]">Timesheet</h1>
        <p className="text-sm text-gray-500">Track your work hours</p>
      </div>

      {/* Quick Clock In/Out */}
      <Card className="bg-gradient-to-r from-[#1f3b4d] to-[#2d4f63]">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="text-white">
              <p className="text-sm opacity-80">
                {isClockedIn ? 'Currently Working' : 'Not Clocked In'}
              </p>
              {isClockedIn && clockInTime && (
                <p className="text-sm opacity-60">
                  Since {format(clockInTime, 'h:mm a')}
                </p>
              )}
            </div>
            <Button
              onClick={handleClockToggle}
              className={`h-12 px-6 ${
                isClockedIn 
                  ? 'bg-red-500 hover:bg-red-600' 
                  : 'bg-[#4e9271] hover:bg-[#3d7a5d]'
              }`}
            >
              {isClockedIn ? (
                <>
                  <Square className="h-5 w-5 mr-2 fill-current" />
                  Clock Out
                </>
              ) : (
                <>
                  <Play className="h-5 w-5 mr-2" />
                  Clock In
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Week Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setSelectedWeek(subWeeks(selectedWeek, 1))}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          <ChevronLeft className="h-5 w-5 text-gray-600" />
        </button>
        <div className="text-center">
          <p className="font-semibold text-gray-900">
            {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
          </p>
          <p className="text-sm text-gray-500">
            Week Total: <span className="font-medium text-[#4e9271]">{totalWeekHours.toFixed(1)} hours</span>
          </p>
        </div>
        <button
          onClick={() => setSelectedWeek(addWeeks(selectedWeek, 1))}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          <ChevronRight className="h-5 w-5 text-gray-600" />
        </button>
      </div>

      {/* Daily Entries */}
      <div className="space-y-3">
        {daysInWeek.map((day) => {
          const dayKey = format(day, 'yyyy-MM-dd');
          const dayEntries = entriesByDay[dayKey] || [];
          const isToday = isSameDay(day, new Date());
          const isPast = day < new Date() && !isToday;
          
          return (
            <Card 
              key={dayKey} 
              className={`${isToday ? 'ring-2 ring-[#4e9271]' : ''} ${
                dayEntries.length === 0 && isPast ? 'opacity-50' : ''
              }`}
            >
              <CardContent className="py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center ${
                      isToday ? 'bg-[#4e9271] text-white' : 'bg-gray-100 text-gray-600'
                    }`}>
                      <span className="text-sm font-medium">{format(day, 'd')}</span>
                    </div>
                    <div>
                      <p className={`font-medium ${isToday ? 'text-[#4e9271]' : 'text-gray-900'}`}>
                        {format(day, 'EEEE')}
                        {isToday && <span className="ml-2 text-xs font-normal">(Today)</span>}
                      </p>
                      <p className="text-xs text-gray-500">{format(day, 'MMM d')}</p>
                    </div>
                  </div>
                  {dayEntries.length > 0 && (
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">{calculateDayTotal(dayEntries)}</p>
                      <p className="text-xs text-gray-500">{dayEntries.length} entries</p>
                    </div>
                  )}
                </div>

                {dayEntries.length > 0 && (
                  <div className="space-y-2 mt-3 pt-3 border-t">
                    {dayEntries.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Clock className="h-4 w-4 text-gray-400" />
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {format(parseISO(entry.clockIn), 'h:mm a')} - {format(parseISO(entry.clockOut), 'h:mm a')}
                            </p>
                            <p className="text-xs text-gray-500">
                              {calculateDuration(entry.clockIn, entry.clockOut)}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteEntry(entry.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {dayEntries.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-2">No hours logged</p>
                )}
              </CardContent>
            </Card>
          );
        })}
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
          <Link href="/tech/timesheet" className="flex flex-col items-center py-2 text-[#1f3b4d]">
            <Clock className="h-5 w-5" />
            <span className="text-xs mt-1 font-medium">Timesheet</span>
          </Link>
          <Link href="/tech/search" className="flex flex-col items-center py-2 text-gray-400">
            <Search className="h-5 w-5" />
            <span className="text-xs mt-1">Search</span>
          </Link>
          <Link href="/tech/more" className="flex flex-col items-center py-2 text-gray-400">
            <MoreHorizontal className="h-5 w-5" />
            <span className="text-xs mt-1">More</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
