'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JobStatusBadge, PriorityBadge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft,
  MapPin,
  Phone,
  Mail,
  Navigation,
  Clock,
  Calendar,
  User,
  FileText,
  Camera,
  Send,
  CheckCircle2,
  AlertTriangle,
  Droplets,
  Gauge,
  X,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import Image from 'next/image';

interface JobNote {
  id: number;
  text: string;
  timestamp: string;
  userId: string;
  userName: string;
}

interface JobPhoto {
  id: number;
  url: string;
  caption: string;
  timestamp: string;
}

export default function TechJobDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [notes, setNotes] = useState<JobNote[]>([]);
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [newNote, setNewNote] = useState('');
  const [showAddNote, setShowAddNote] = useState(false);
  const [showWellInfo, setShowWellInfo] = useState(false);
  const [jobStatus, setJobStatus] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Fetch job from API
  useEffect(() => {
    const fetchJob = async () => {
      try {
        const res = await fetch(`/api/jobs/${id}`);
        if (res.ok) {
          const data = await res.json();
          setJob(data.job);
          setJobStatus(data.job?.status || 'scheduled');
        }
      } catch (err) {
        console.error('Failed to fetch job:', err);
      } finally {
        setLoading(false);
      }
    };
    if (id) fetchJob();
  }, [id]);

  // Property and customer come from API join
  const property = job?.property;
  const customer = property?.customer;
  const wellInfo = null; // TODO: fetch well info if needed

  // Load saved notes and photos from localStorage
  useEffect(() => {
    if (!id) return;
    const savedNotes = localStorage.getItem(`job_notes_${id}`);
    const savedPhotos = localStorage.getItem(`job_photos_${id}`);
    const savedStatus = localStorage.getItem(`job_status_${id}`);
    
    if (savedNotes) setNotes(JSON.parse(savedNotes));
    if (savedPhotos) setPhotos(JSON.parse(savedPhotos));
    if (savedStatus) setJobStatus(savedStatus);
    else if (job) setJobStatus(job.status);
  }, [id, job]);

  if (!job || !property || !customer) {
    return (
      <div className="p-4">
        <Button variant="ghost" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="h-5 w-5 mr-2" />
          Back
        </Button>
        <Card>
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-amber-500" />
            <h3 className="font-medium text-gray-900">Job Not Found</h3>
          </CardContent>
        </Card>
      </div>
    );
  }

  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    `${property.address}, ${property.city || ''} ${property.zip || ''}`
  )}`;

  const handleAddNote = () => {
    if (!newNote.trim() || !user) return;
    
    const note: JobNote = {
      id: Date.now(),
      text: newNote.trim(),
      timestamp: new Date().toISOString(),
      userId: user.id,
      userName: user.name,
    };
    
    const updatedNotes = [...notes, note];
    setNotes(updatedNotes);
    localStorage.setItem(`job_notes_${id}`, JSON.stringify(updatedNotes));
    setNewNote('');
    setShowAddNote(false);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const photo: JobPhoto = {
          id: Date.now() + Math.random(),
          url: event.target?.result as string,
          caption: '',
          timestamp: new Date().toISOString(),
        };
        
        const updatedPhotos = [...photos, photo];
        setPhotos(updatedPhotos);
        localStorage.setItem(`job_photos_${id}`, JSON.stringify(updatedPhotos));
      };
      reader.readAsDataURL(file);
    });
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDeletePhoto = (photoId: number) => {
    const updatedPhotos = photos.filter(p => p.id !== photoId);
    setPhotos(updatedPhotos);
    localStorage.setItem(`job_photos_${id}`, JSON.stringify(updatedPhotos));
  };

  const handleStatusChange = (newStatus: string) => {
    setJobStatus(newStatus);
    localStorage.setItem(`job_status_${id}`, newStatus);
  };

  const handleMarkComplete = async () => {
    setIsSubmitting(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    handleStatusChange('completed');
    setIsSubmitting(false);
  };

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#1f3b4d] text-white p-4 safe-area-inset-top">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 -ml-2 rounded-full hover:bg-white/10">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-lg truncate">{job.job_type}</h1>
            <p className="text-sm opacity-80 truncate">{customer.name}</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Status & Actions */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <JobStatusBadge status={jobStatus || job.status} />
                {job.priority && job.priority !== 'normal' && (
                  <PriorityBadge priority={job.priority} />
                )}
              </div>
              {job.job_number && (
                <span className="text-sm text-gray-500">#{job.job_number}</span>
              )}
            </div>
            
            {/* Status buttons */}
            <div className="flex gap-2">
              {jobStatus !== 'in_progress' && jobStatus !== 'completed' && (
                <Button 
                  variant="primary" 
                  className="flex-1 h-12 text-base"
                  onClick={() => handleStatusChange('in_progress')}
                >
                  Start Job
                </Button>
              )}
              {jobStatus === 'in_progress' && (
                <Button 
                  variant="success" 
                  className="flex-1 h-12 text-base"
                  onClick={handleMarkComplete}
                  loading={isSubmitting}
                  leftIcon={<CheckCircle2 className="h-5 w-5" />}
                >
                  Mark Complete
                </Button>
              )}
              {jobStatus === 'completed' && (
                <div className="flex-1 flex items-center justify-center h-12 bg-emerald-50 rounded-lg text-emerald-700 font-medium">
                  <CheckCircle2 className="h-5 w-5 mr-2" />
                  Completed
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Schedule Info */}
        <Card>
          <CardContent className="py-4">
            <div className="grid grid-cols-2 gap-4">
              {job.scheduled_date && (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center">
                    <Calendar className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Date</p>
                    <p className="font-medium">{format(parseISO(job.scheduled_date), 'MMM d, yyyy')}</p>
                  </div>
                </div>
              )}
              {job.scheduled_time && (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-amber-50 flex items-center justify-center">
                    <Clock className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Time</p>
                    <p className="font-medium">{job.scheduled_time}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Customer & Address */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4 text-gray-400" />
              Customer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div>
              <p className="font-semibold text-gray-900">{customer.name}</p>
            </div>
            
            {/* Address with map link */}
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-gray-700">{property.address}</p>
                <p className="text-gray-500 text-sm">
                  {property.city}{property.zip ? `, ${property.zip}` : ''}
                </p>
              </div>
            </div>
            
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 bg-blue-50 text-blue-700 rounded-lg font-medium active:bg-blue-100"
            >
              <Navigation className="h-5 w-5" />
              Open in Maps
            </a>

            {/* Contact buttons */}
            <div className="flex gap-2">
              {customer.phone && (
                <a
                  href={`tel:${customer.phone}`}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-50 text-green-700 rounded-lg font-medium active:bg-green-100"
                >
                  <Phone className="h-5 w-5" />
                  Call
                </a>
              )}
              {customer.email && (
                <a
                  href={`mailto:${customer.email}`}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-purple-50 text-purple-700 rounded-lg font-medium active:bg-purple-100"
                >
                  <Mail className="h-5 w-5" />
                  Email
                </a>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Well Info (collapsible) */}
        {wellInfo && (
          <Card>
            <button 
              onClick={() => setShowWellInfo(!showWellInfo)}
              className="w-full px-5 py-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <Droplets className="h-5 w-5 text-blue-500" />
                <span className="font-semibold text-gray-900">Well Information</span>
              </div>
              {showWellInfo ? (
                <ChevronUp className="h-5 w-5 text-gray-400" />
              ) : (
                <ChevronDown className="h-5 w-5 text-gray-400" />
              )}
            </button>
            {showWellInfo && (
              <CardContent className="pt-0 border-t">
                <div className="grid grid-cols-2 gap-4 pt-4">
                  {wellInfo.well_depth && (
                    <div>
                      <p className="text-xs text-gray-500">Well Depth</p>
                      <p className="font-medium">{wellInfo.well_depth} ft</p>
                    </div>
                  )}
                  {wellInfo.casing_diameter && (
                    <div>
                      <p className="text-xs text-gray-500">Casing</p>
                      <p className="font-medium">{wellInfo.casing_diameter}" dia</p>
                    </div>
                  )}
                  {wellInfo.pump_depth && (
                    <div>
                      <p className="text-xs text-gray-500">Pump Depth</p>
                      <p className="font-medium">{wellInfo.pump_depth} ft</p>
                    </div>
                  )}
                  {wellInfo.pump_hp && (
                    <div>
                      <p className="text-xs text-gray-500">Pump HP</p>
                      <p className="font-medium">{wellInfo.pump_hp} HP</p>
                    </div>
                  )}
                  {wellInfo.static_water_level && (
                    <div>
                      <p className="text-xs text-gray-500">Static Water Level</p>
                      <p className="font-medium">{wellInfo.static_water_level} ft</p>
                    </div>
                  )}
                  {wellInfo.pump_model && (
                    <div>
                      <p className="text-xs text-gray-500">Pump Model</p>
                      <p className="font-medium">{wellInfo.pump_model}</p>
                    </div>
                  )}
                </div>
                {wellInfo.notes && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-xs text-gray-500 mb-1">Notes</p>
                    <p className="text-sm text-gray-700">{wellInfo.notes}</p>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        )}

        {/* Job Description & Notes */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-gray-400" />
              Job Details
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {job.description && (
              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-1">Description</p>
                <p className="text-gray-700">{job.description}</p>
              </div>
            )}
            
            {property.access_notes && (
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                <p className="text-xs font-medium text-amber-800 mb-1">Access Notes</p>
                <p className="text-sm text-amber-900">{property.access_notes}</p>
              </div>
            )}

            {job.internal_notes && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-xs font-medium text-gray-500 mb-1">Internal Notes</p>
                <p className="text-sm text-gray-700">{job.internal_notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tech Notes */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Notes</CardTitle>
              <button
                onClick={() => setShowAddNote(!showAddNote)}
                className="flex items-center gap-1 text-sm text-[#4e9271] font-medium"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {showAddNote && (
              <div className="mb-4 space-y-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note about this job..."
                  className="w-full p-3 border rounded-lg resize-none text-sm focus:ring-2 focus:ring-[#4e9271]/20 focus:border-[#4e9271]"
                  rows={3}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button 
                    variant="primary" 
                    className="flex-1 bg-[#4e9271] hover:bg-[#3d7a5d]"
                    onClick={handleAddNote}
                    disabled={!newNote.trim()}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Save Note
                  </Button>
                  <Button variant="outline" onClick={() => { setShowAddNote(false); setNewNote(''); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {notes.length === 0 && !showAddNote ? (
              <p className="text-sm text-gray-500 text-center py-4">No notes yet</p>
            ) : (
              <div className="space-y-3">
                {notes.map((note) => (
                  <div key={note.id} className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-700">{note.text}</p>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-gray-400">
                        {note.userName} • {format(new Date(note.timestamp), 'MMM d, h:mm a')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Photos */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Camera className="h-4 w-4 text-gray-400" />
                Photos ({photos.length})
              </CardTitle>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 text-sm text-[#4e9271] font-medium"
              >
                <Camera className="h-4 w-4" />
                Add
              </button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handlePhotoUpload}
              className="hidden"
            />

            {photos.length === 0 ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-8 border-2 border-dashed border-gray-200 rounded-lg text-center hover:border-[#4e9271] hover:bg-[#4e9271]/5 transition-colors"
              >
                <Camera className="h-10 w-10 mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-500">Tap to add photos</p>
              </button>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo) => (
                  <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden group">
                    <img
                      src={photo.url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => handleDeletePhoto(photo.id)}
                      className="absolute top-1 right-1 p-1.5 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center hover:border-[#4e9271] transition-colors"
                >
                  <Plus className="h-6 w-6 text-gray-400" />
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
