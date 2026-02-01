'use client';


import { useState, useMemo } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  mockJobs,
  getFieldCrew,
} from '@/lib/mock-data';
import type { Job } from '@/types/database';
import {
  ChevronLeft,
  ChevronRight,
  Route,
  CalendarDays,
} from 'lucide-react';
import { format, addDays, subDays, isToday } from 'date-fns';
import Link from 'next/link';
import { DroppableColumn } from '@/components/scheduling/DroppableColumn';
import { DraggableJobCard } from '@/components/scheduling/DraggableJobCard';
import { JobCardOverlay } from '@/components/scheduling/JobCardOverlay';

export default function DispatchPage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  
  // In a real app, this would be state that persists to the database
  const [jobAssignments, setJobAssignments] = useState<Record<string, string | null>>(() => {
    const initial: Record<string, string | null> = {};
    mockJobs.forEach(job => {
      initial[job.id] = job.assigned_to;
    });
    return initial;
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const fieldCrew = useMemo(() => getFieldCrew(), []);
  const dateStr = format(selectedDate, 'yyyy-MM-dd');

  // Get jobs for the selected date
  const todaysJobs = useMemo(() => {
    return mockJobs.filter(job => 
      job.scheduled_date === dateStr && 
      (job.status === 'scheduled' || job.status === 'in_progress')
    );
  }, [dateStr]);

  // Get unassigned jobs for selected date
  const unassignedJobs = useMemo(() => {
    return todaysJobs.filter(job => !jobAssignments[job.id]);
  }, [todaysJobs, jobAssignments]);

  // Get jobs by crew member
  const getJobsForCrew = (userId: string) => {
    return todaysJobs
      .filter(job => jobAssignments[job.id] === userId)
      .sort((a, b) => {
        if (!a.scheduled_time) return 1;
        if (!b.scheduled_time) return -1;
        return a.scheduled_time.localeCompare(b.scheduled_time);
      });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const job = todaysJobs.find(j => j.id === event.active.id);
    if (job) setActiveJob(job);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveJob(null);
    const { active, over } = event;
    
    if (!over) return;

    const jobId = active.id as string;
    const overId = over.id as string;

    // Determine the target
    let newAssignee: string | null = null;
    
    if (overId === 'unassigned') {
      newAssignee = null;
    } else if (overId.startsWith('crew-')) {
      newAssignee = overId.replace('crew-', '');
    } else {
      // Dropped on another job - find its column
      const targetJob = todaysJobs.find(j => j.id === overId);
      if (targetJob) {
        newAssignee = jobAssignments[targetJob.id];
      }
    }

    // Update assignment
    setJobAssignments(prev => ({
      ...prev,
      [jobId]: newAssignee,
    }));
  };

  const goToPreviousDay = () => setSelectedDate(prev => subDays(prev, 1));
  const goToNextDay = () => setSelectedDate(prev => addDays(prev, 1));
  const goToToday = () => setSelectedDate(new Date());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Dispatch Board</h2>
          <p className="text-gray-600">Assign and manage today&apos;s jobs</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dispatch/routes">
            <Button variant="outline">
              <Route className="h-4 w-4" />
              Route Optimizer
            </Button>
          </Link>
          <Button href="/jobs/new">+ New Job</Button>
        </div>
      </div>

      {/* Date Navigation */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={goToPreviousDay}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronLeft className="h-5 w-5 text-gray-600" />
            </button>
            
            <div className="flex items-center gap-4">
              <CalendarDays className="h-5 w-5 text-gray-500" />
              <div className="text-center">
                <p className="text-lg font-semibold text-gray-900">
                  {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                </p>
                {isToday(selectedDate) && (
                  <Badge variant="info">Today</Badge>
                )}
              </div>
              {!isToday(selectedDate) && (
                <button
                  onClick={goToToday}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Go to Today
                </button>
              )}
            </div>

            <button
              onClick={goToNextDay}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronRight className="h-5 w-5 text-gray-600" />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-3xl font-bold text-gray-900">{todaysJobs.length}</p>
            <p className="text-sm text-gray-500">Total Jobs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-3xl font-bold text-red-600">{unassignedJobs.length}</p>
            <p className="text-sm text-gray-500">Unassigned</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-3xl font-bold text-blue-600">
              {todaysJobs.filter(j => j.status === 'scheduled').length}
            </p>
            <p className="text-sm text-gray-500">Scheduled</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-3xl font-bold text-yellow-600">
              {todaysJobs.filter(j => j.status === 'in_progress').length}
            </p>
            <p className="text-sm text-gray-500">In Progress</p>
          </CardContent>
        </Card>
      </div>

      {/* Dispatch Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Unassigned Jobs Column */}
          <div className="lg:col-span-1">
            <Card className="h-full">
              <CardHeader className="bg-gray-50 rounded-t-xl">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    Unassigned
                  </CardTitle>
                  <Badge variant="danger">{unassignedJobs.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-3 min-h-[400px]">
                <SortableContext
                  id="unassigned"
                  items={unassignedJobs.map(j => j.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <DroppableColumn id="unassigned">
                    {unassignedJobs.length === 0 ? (
                      <div className="text-center text-gray-400 py-8">
                        <p className="text-sm">No unassigned jobs</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {unassignedJobs.map(job => (
                          <DraggableJobCard key={job.id} job={job} />
                        ))}
                      </div>
                    )}
                  </DroppableColumn>
                </SortableContext>
              </CardContent>
            </Card>
          </div>

          {/* Crew Member Columns */}
          <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
            {fieldCrew.map(crewMember => {
              const crewJobs = getJobsForCrew(crewMember.id);
              return (
                <Card key={crewMember.id} className="h-full">
                  <CardHeader className="bg-blue-50 rounded-t-xl">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{crewMember.name}</CardTitle>
                        <p className="text-xs text-gray-500 mt-0.5">{crewMember.phone}</p>
                      </div>
                      <Badge variant="info">{crewJobs.length}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 min-h-[400px]">
                    <SortableContext
                      id={`crew-${crewMember.id}`}
                      items={crewJobs.map(j => j.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <DroppableColumn id={`crew-${crewMember.id}`}>
                        {crewJobs.length === 0 ? (
                          <div className="text-center text-gray-400 py-8 border-2 border-dashed border-gray-200 rounded-lg">
                            <p className="text-sm">Drop jobs here</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {crewJobs.map(job => (
                              <DraggableJobCard key={job.id} job={job} />
                            ))}
                          </div>
                        )}
                      </DroppableColumn>
                    </SortableContext>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeJob && <JobCardOverlay job={activeJob} />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
