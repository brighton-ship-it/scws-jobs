'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  CheckCircle2, 
  Clock, 
  FileText, 
  PenLine, 
  Send, 
  Calendar,
  DollarSign,
  MapPin,
  Search,
  RefreshCw,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';

// Pipeline stages
const STAGES = [
  { id: 'deposit', label: 'Deposit Paid', icon: DollarSign, color: 'bg-yellow-500' },
  { id: 'site_visit', label: 'Site Visit', icon: MapPin, color: 'bg-blue-500' },
  { id: 'permit_prep', label: 'Permit Prep', icon: FileText, color: 'bg-purple-500' },
  { id: 'customer_signature', label: 'Customer Signature', icon: PenLine, color: 'bg-orange-500' },
  { id: 'submitted', label: 'Submitted to County', icon: Send, color: 'bg-indigo-500' },
  { id: 'approved', label: 'County Approved', icon: CheckCircle2, color: 'bg-green-500' },
  { id: 'scheduled', label: 'Scheduled', icon: Calendar, color: 'bg-emerald-600' },
];

interface DrillingProject {
  id: string;
  quote_number: string;
  customer_name: string;
  property_address: string;
  total: number;
  quote_date: string;
  stage: string;
  deposit_amount?: number;
  deposit_date?: string;
  site_visit_date?: string;
  permit_submitted_date?: string;
  county_tracking_number?: string;
  county_approved_date?: string;
  scheduled_date?: string;
  notes?: string;
  days_in_stage: number;
}

export default function DrillingPipelinePage() {
  const [projects, setProjects] = useState<DrillingProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState<DrillingProject | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/drilling');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const syncFromJobber = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/drilling/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Synced ${data.imported} new projects from Jobber`);
        fetchProjects();
      } else {
        toast.error('Could not sync with Jobber');
      }
    } catch {
      toast.error('Could not connect to Jobber');
    } finally {
      setSyncing(false);
    }
  };

  const updateStage = async (projectId: string, newStage: string) => {
    // Optimistic update
    setProjects(prev => prev.map(p => 
      p.id === projectId ? { ...p, stage: newStage, days_in_stage: 0 } : p
    ));

    if (selectedProject?.id === projectId) {
      setSelectedProject(prev => prev ? { ...prev, stage: newStage, days_in_stage: 0 } : null);
    }

    try {
      const res = await fetch(`/api/drilling/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage })
      });
      if (!res.ok) {
        fetchProjects();
      }
    } catch (error) {
      console.error('Failed to update stage:', error);
      fetchProjects();
    }
  };

  const moveProject = (project: DrillingProject, direction: 'next' | 'prev') => {
    const currentIdx = STAGES.findIndex(s => s.id === project.stage);
    const newIdx = direction === 'next' ? currentIdx + 1 : currentIdx - 1;
    
    if (newIdx >= 0 && newIdx < STAGES.length) {
      updateStage(project.id, STAGES[newIdx].id);
    }
  };

  const getProjectsByStage = (stageId: string) => {
    let filtered = projects.filter(p => p.stage === stageId);
    if (searchTerm) {
      filtered = filtered.filter(p => 
        p.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.quote_number.includes(searchTerm)
      );
    }
    return filtered;
  };

  const totalValue = projects.reduce((sum, p) => sum + p.total, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">Drilling Pipeline</h1>
          <p className="text-muted-foreground">
            {projects.length} active projects · ${totalValue.toLocaleString()} total value
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 w-64"
            />
          </div>
          <Button onClick={syncFromJobber} disabled={syncing} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            Sync Jobber
          </Button>
        </div>
      </div>

      {/* Pipeline Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
        {STAGES.map((stage, stageIdx) => {
          const stageProjects = getProjectsByStage(stage.id);
          const stageValue = stageProjects.reduce((sum, p) => sum + p.total, 0);
          
          return (
            <div key={stage.id} className="space-y-3">
              {/* Stage Header */}
              <div className={`${stage.color} text-white rounded-lg p-3`}>
                <div className="flex items-center gap-2">
                  <stage.icon className="h-4 w-4" />
                  <span className="font-medium text-sm">{stage.label}</span>
                </div>
                <div className="mt-1 text-xs opacity-90">
                  {stageProjects.length} · ${stageValue.toLocaleString()}
                </div>
              </div>

              {/* Projects in Stage */}
              <div className="space-y-2 min-h-[200px]">
                {stageProjects.map((project) => (
                  <Card 
                    key={project.id} 
                    className={`transition-shadow hover:shadow-md ${
                      project.days_in_stage > 14 ? 'border-red-300' : ''
                    }`}
                  >
                    <CardContent className="p-3">
                      <div 
                        className="cursor-pointer"
                        onClick={() => setSelectedProject(project)}
                      >
                        <div className="font-medium text-sm truncate">
                          {project.customer_name}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          #{project.quote_number}
                        </div>
                        <div className="text-sm font-semibold text-green-600 mt-1">
                          ${project.total.toLocaleString()}
                        </div>
                        {project.days_in_stage > 7 && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                            <Clock className="h-3 w-3" />
                            {project.days_in_stage} days
                          </div>
                        )}
                      </div>
                      
                      {/* Quick move buttons */}
                      <div className="flex justify-between mt-2 pt-2 border-t">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          disabled={stageIdx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveProject(project, 'prev');
                          }}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          disabled={stageIdx === STAGES.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveProject(project, 'next');
                          }}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Project Detail Modal */}
      {selectedProject && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedProject(null)}
        >
          <Card 
            className="w-full max-w-2xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{selectedProject.customer_name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Quote #{selectedProject.quote_number}
                </p>
              </div>
              <Button variant="ghost" onClick={() => setSelectedProject(null)}>
                ✕
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Project Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Property</label>
                  <p className="text-sm">{selectedProject.property_address || 'Not specified'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Total</label>
                  <p className="text-lg font-semibold text-green-600">
                    ${selectedProject.total.toLocaleString()}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Quote Date</label>
                  <p className="text-sm">{new Date(selectedProject.quote_date).toLocaleDateString()}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Days in Stage</label>
                  <p className="text-sm">{selectedProject.days_in_stage} days</p>
                </div>
              </div>

              {/* Stage Progress */}
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Move to Stage
                </label>
                <div className="flex flex-wrap gap-2">
                  {STAGES.map((stage, idx) => {
                    const currentIdx = STAGES.findIndex(s => s.id === selectedProject.stage);
                    const isComplete = idx < currentIdx;
                    const isCurrent = stage.id === selectedProject.stage;
                    
                    return (
                      <Button
                        key={stage.id}
                        variant={isCurrent ? "default" : isComplete ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => updateStage(selectedProject.id, stage.id)}
                        className={isCurrent ? stage.color + ' text-white' : ''}
                      >
                        {isComplete && <CheckCircle2 className="h-3 w-3 mr-1" />}
                        {stage.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Stage-specific fields */}
              {selectedProject.county_tracking_number && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-indigo-600" />
                    <span>County Tracking #: {selectedProject.county_tracking_number}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
