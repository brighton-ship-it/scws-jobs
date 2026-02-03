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
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  mockJobs,
  getFieldCrew,
  getPropertyById,
  getCustomerById,
} from '@/lib/mock-data';
import type { Job } from '@/types/database';
import {
  ChevronLeft,
  ChevronRight,
  Route,
  CalendarDays,
  Map,
  List,
  Users,
} from 'lucide-react';
import { format, addDays, subDays, isToday } from 'date-fns';
import Link from 'next/link';
import { DroppableColumn } from '@/components/scheduling/DroppableColumn';
import { DraggableJobCard } from '@/components/scheduling/DraggableJobCard';
import { JobCardOverlay } from '@/components/scheduling/JobCardOverlay';
import { DispatchMap, isGoogleMapsConfigured } from '@/components/maps';
import { useTechLocations } from '@/hooks/useTechLocations';

type ViewMode = 'board' | 'map';

export default function DispatchPage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();
  
  // Real-time tech locations
  const { locations: techLocations, isLoading: locationsLoading } = useTechLocations({
    realtime: true,
  });
  
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

  // Build jobs with property info for map
  const jobsWithProperties = useMemo(() => {
    return todaysJobs.map(job => {
      const property = getPropertyById(job.property_id);
      const customer = property ? getCustomerById(property.customer_id) : null;
      return {
        job,
        property: property!,
        customerName: customer?.name || 'Unknown Customer',
      };
    }).filter(item => item.property);
  }, [todaysJobs]);

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
          {/* View Toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('board')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'board'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <List className="h-4 w-4" />
              Board
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'map'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Map className="h-4 w-4" />
              Map
            </button>
          </div>
          
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-3xl font-bold text-purple-600">
              {techLocations.length}
            </p>
            <p className="text-sm text-gray-500 flex items-center justify-center gap-1">
              <Users className="h-3 w-3" />
              Techs Online
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Map View */}
      {viewMode === 'map' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Map className="h-4 w-4" />
                Today&apos;s Jobs & Tech Locations
              </CardTitle>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>{jobsWithProperties.length} jobs</span>
                {techLocations.length > 0 && (
                  <>
                    <span>·</span>
                    <span>{techLocations.length} techs tracking</span>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <DispatchMap
              jobs={jobsWithProperties}
              techLocations={techLocations}
              selectedJobId={selectedJobId}
              onJobSelect={setSelectedJobId}
              height="600px"
              showTechLocations={true}
            />
          </CardContent>
        </Card>
      )}

      {/* Dispatch Board */}
      {viewMode === 'board' && (
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
                const isOnline = techLocations.some(loc => loc.tech_id === crewMember.id);
                
                return (
                  <Card key={crewMember.id} className="h-full">
                    <CardHeader className="bg-blue-50 rounded-t-xl">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            {crewMember.name}
                            {isOnline && (
                              <span className="w-2 h-2 rounded-full bg-green-500" title="Location sharing active" />
                            )}
                          </CardTitle>
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
      )}
    </div>
  );
}
