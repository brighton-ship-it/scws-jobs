'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JobStatusBadge, PriorityBadge, InvoiceStatusBadge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableEmpty } from '@/components/ui/table';
import { TeamMemberMultiSelect, AssignmentHistory, AssignedTeamAvatars } from '@/components/scheduling';
import { JobPhotoGallery } from '@/components/jobs/JobPhotoGallery';
import { JobPartsExpenses } from '@/components/jobs/JobPartsExpenses';
import { useAuth } from '@/contexts/AuthContext';
import type { JobPhoto, User } from '@/types/database';
import {
  ArrowLeft,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Clock,
  Users,
  Edit,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  Plus,
  ExternalLink,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  FileText,
  Wrench,
  History,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { MakeRecurringModal } from '@/components/jobs/MakeRecurringModal';
import { RecurringBadge } from '@/components/ui/badge';
import { OnMyWayButton } from '@/components/jobs/OnMyWayButton';
import { format, isPast, isToday } from 'date-fns';

// Job data type from API
interface JobData {
  id: string;
  job_type: string;
  status: string;
  priority?: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  estimated_duration: string | null;
  description: string | null;
  internal_notes: string | null;
  assigned_to: string | null;
  recurring_schedule_id?: string | null;
  created_at: string;
  completed_at: string | null;
  property?: {
    id: string;
    address: string;
    city: string;
    county?: string;
    zip?: string;
    access_notes?: string;
    customer?: {
      id: string;
      name: string;
      email: string;
      phone: string;
      billing_address?: string;
      notes?: string;
    };
  };
  assigned_user?: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    role: string;
  };
}

export default function JobDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [showProfitability, setShowProfitability] = useState(true);
  const [showAssignmentHistory, setShowAssignmentHistory] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const { user: currentUser } = useAuth();
  
  // Data state
  const [job, setJob] = useState<JobData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [relatedInvoices, setRelatedInvoices] = useState<any[]>([]);
  
  // State for photos
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  
  // Fetch job data
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        
        const [jobRes, usersRes, invoicesRes] = await Promise.all([
          fetch(`/api/jobs/${id}`),
          fetch('/api/users'),
          fetch(`/api/invoices?job_id=${id}`),
        ]);
        
        if (!jobRes.ok) {
          throw new Error('Job not found');
        }
        
        const [jobData, usersData, invoicesData] = await Promise.all([
          jobRes.json(),
          usersRes.json(),
          invoicesRes.json(),
        ]);
        
        setJob(jobData.job);
        
        // Ensure assigned_user is in the team members list
        let members = usersData.users || [];
        if (jobData.job?.assigned_user) {
          const assignedExists = members.some((m: User) => m.id === jobData.job.assigned_user.id);
          if (!assignedExists) {
            members = [...members, jobData.job.assigned_user];
          }
        }
        setTeamMembers(members);
        
        setRelatedInvoices(invoicesData.invoices || []);
      } catch (err) {
        console.error('Failed to fetch job:', err);
        setError(err instanceof Error ? err.message : 'Failed to load job');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);
  
  // Fetch photos
  useEffect(() => {
    const fetchPhotos = async () => {
      try {
        const res = await fetch(`/api/jobs/${id}/photos`);
        if (res.ok) {
          const data = await res.json();
          setPhotos(data.photos || []);
        }
      } catch (err) {
        console.error('Failed to fetch photos:', err);
      } finally {
        setPhotosLoading(false);
      }
    };
    fetchPhotos();
  }, [id]);

  // Handle assignment changes
  const handleAssignmentChange = async (newSelectedIds: string[]) => {
    if (!job || newSelectedIds.length === 0) return;
    
    // Update the assigned_to field with the first selected user
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to: newSelectedIds[0] }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setJob(data.job);
      }
    } catch (err) {
      console.error('Failed to update assignment:', err);
    }
  };

  // Handle mark complete
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);
  const handleMarkComplete = async () => {
    if (!job) return;
    
    setIsMarkingComplete(true);
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          status: 'completed',
          completed_at: new Date().toISOString(),
        }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setJob(data.job);
      } else {
        const error = await res.json();
        alert(error.error || 'Failed to mark complete');
      }
    } catch (err) {
      console.error('Failed to mark complete:', err);
      alert('Failed to mark job as complete');
    } finally {
      setIsMarkingComplete(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Loading job...</span>
      </div>
    );
  }
  
  if (error || !job) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Job not found</h2>
        <p className="text-gray-500 mt-2">{error || "The job you're looking for doesn't exist."}</p>
        <Link href="/jobs" className="text-green-600 hover:underline mt-4 inline-block">
          Back to Jobs
        </Link>
      </div>
    );
  }

  const property = job.property;
  const customer = property?.customer;
  const assignedUser = job.assigned_user;

  // Calculate derived status
  const getDerivedStatus = () => {
    if (job.status === 'invoiced') return 'invoiced';
    if (job.status === 'completed') return 'requires_invoicing';
    if (!job.scheduled_date || !job.assigned_to) return 'unscheduled';
    const schedDate = new Date(job.scheduled_date);
    if (isPast(schedDate) && !isToday(schedDate) && job.status !== 'completed') {
      return 'late';
    }
    return job.status;
  };

  // Mock profitability data (would come from job line items)
  const profitability = {
    totalPrice: 555,
    lineItemCost: 105,
    laborCost: 500,
    expenses: 73.50,
    profit: -123.50,
    margin: -22.3,
  };

  const derivedStatus = getDerivedStatus();
  const isLate = derivedStatus === 'late';

  return (
    <div className="space-y-6">
      {/* Header Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/jobs"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <JobStatusBadge status={derivedStatus} />
              {job.priority && job.priority !== 'normal' && (
                <PriorityBadge priority={job.priority} />
              )}
              {job.recurring_schedule_id && <RecurringBadge />}
              <span className="text-gray-500">Job #{job.id.slice(0, 8)}</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">{job.job_type}</h1>
          </div>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          {/* On My Way Button - sends SMS to customer */}
          {job.status !== 'completed' && job.status !== 'invoiced' && (
            <OnMyWayButton
              jobId={job.id}
              customerName={customer?.name || 'Customer'}
              customerPhone={customer?.phone || null}
              techName={currentUser?.name || 'Your technician'}
            />
          )}
          {isLate && (
            <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50">
              <AlertCircle className="h-4 w-4" />
              Show Late Visit
            </Button>
          )}
          <Button variant="outline" href={`/jobs/${job.id}/edit`}>
            <Edit className="h-4 w-4" />
            Edit
          </Button>
          <Button variant="outline">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Client & Property Section */}
          <Card>
            <CardContent className="py-6">
              <div className="grid gap-6 sm:grid-cols-2">
                {/* Client */}
                <div>
                  <h3 className="text-sm font-medium text-gray-500 uppercase mb-2">Client</h3>
                  <Link href={`/customers/${customer?.id}`} className="text-lg font-semibold text-green-600 hover:underline">
                    {customer?.name || 'Unknown Customer'}
                  </Link>
                  {customer?.phone && (
                    <div className="flex items-center gap-2 mt-2 text-gray-600">
                      <Phone className="h-4 w-4" />
                      <a href={`tel:${customer.phone}`} className="hover:underline">{customer.phone}</a>
                    </div>
                  )}
                  {customer?.email && (
                    <div className="flex items-center gap-2 mt-1 text-gray-600">
                      <Mail className="h-4 w-4" />
                      <a href={`mailto:${customer.email}`} className="hover:underline">{customer.email}</a>
                    </div>
                  )}
                </div>
                
                {/* Property */}
                <div>
                  <h3 className="text-sm font-medium text-gray-500 uppercase mb-2">Property</h3>
                  {property ? (
                    <>
                      <a 
                        href={`https://maps.google.com/?q=${encodeURIComponent(property.address + ', ' + property.city)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-2 text-green-600 hover:underline"
                      >
                        <MapPin className="h-4 w-4 mt-1 flex-shrink-0" />
                        <div>
                          <p className="font-medium">{property.address}</p>
                          <p>{property.city}, CA {property.zip}</p>
                        </div>
                        <ExternalLink className="h-3 w-3 mt-1" />
                      </a>
                      {property.access_notes && (
                        <p className="text-sm text-gray-500 mt-2">{property.access_notes}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-gray-500">No property assigned</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Profitability Panel - Collapsible */}
          <Card>
            <button
              onClick={() => setShowProfitability(!showProfitability)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-gray-400" />
                <span className="font-medium">Profitability</span>
                <span className={`text-sm px-2 py-0.5 rounded-full ${
                  profitability.profit >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {profitability.margin.toFixed(1)}% margin
                </span>
              </div>
              {showProfitability ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
            
            {showProfitability && (
              <CardContent className="pt-0 pb-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500">Total Price</p>
                    <p className="text-lg font-semibold">${profitability.totalPrice.toFixed(2)}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500">Line Item Cost</p>
                    <p className="text-lg font-semibold">${profitability.lineItemCost.toFixed(2)}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500">Labor Cost</p>
                    <p className="text-lg font-semibold">${profitability.laborCost.toFixed(2)}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500">Expenses</p>
                    <p className="text-lg font-semibold">${profitability.expenses.toFixed(2)}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg col-span-2 sm:col-span-1">
                    <p className="text-xs text-gray-500">Profit</p>
                    <p className={`text-lg font-bold ${profitability.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ${profitability.profit.toFixed(2)}
                    </p>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Photos Section */}
          <JobPhotoGallery
            jobId={id}
            photos={photos}
            loading={photosLoading}
            onPhotosChange={setPhotos}
          />

          {/* Parts & Expenses */}
          <JobPartsExpenses jobId={id} />

          {/* Job Description */}
          {job.description && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 whitespace-pre-wrap">{job.description}</p>
              </CardContent>
            </Card>
          )}

          {/* Internal Notes */}
          {job.internal_notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Internal Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 whitespace-pre-wrap">{job.internal_notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Related Invoices */}
          {relatedInvoices.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Invoices
                </CardTitle>
                <Button size="sm" variant="outline" href={`/invoices/new?job_id=${job.id}`}>
                  <Plus className="h-4 w-4" />
                  New Invoice
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableCell header>Invoice #</TableCell>
                      <TableCell header>Status</TableCell>
                      <TableCell header>Total</TableCell>
                      <TableCell header>Date</TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {relatedInvoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell>
                          <Link href={`/invoices/${inv.id}`} className="text-green-600 hover:underline font-medium">
                            #{inv.invoice_number}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <InvoiceStatusBadge status={inv.status} />
                        </TableCell>
                        <TableCell>${inv.total?.toFixed(2)}</TableCell>
                        <TableCell>{inv.issue_date ? format(new Date(inv.issue_date), 'MMM d, yyyy') : '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Schedule */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {job.scheduled_date ? (
                <>
                  <div className="flex items-center gap-2 text-gray-600">
                    <Calendar className="h-4 w-4" />
                    <span>{format(new Date(job.scheduled_date), 'EEEE, MMMM d, yyyy')}</span>
                  </div>
                  {job.scheduled_time && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Clock className="h-4 w-4" />
                      <span>{job.scheduled_time}</span>
                    </div>
                  )}
                  {job.estimated_duration && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Clock className="h-4 w-4" />
                      <span>Est. {job.estimated_duration}</span>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 italic">Not scheduled</p>
              )}
              
              <Button variant="outline" size="sm" className="w-full mt-2" href={`/schedule?job=${job.id}`}>
                <Calendar className="h-4 w-4" />
                Open in Calendar
              </Button>
            </CardContent>
          </Card>

          {/* Team Assignment */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-5 w-5" />
                Assigned Team
              </CardTitle>
              {!showAssignmentHistory && (
                <button
                  onClick={() => setShowAssignmentHistory(true)}
                  className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  <History className="h-3 w-3" />
                  History
                </button>
              )}
            </CardHeader>
            <CardContent>
              {showAssignmentHistory ? (
                <div className="space-y-4">
                  <button
                    onClick={() => setShowAssignmentHistory(false)}
                    className="text-sm text-green-600 hover:underline"
                  >
                    ← Back to assignment
                  </button>
                  <p className="text-sm text-gray-500">Assignment history not yet implemented with real data.</p>
                </div>
              ) : (
                <TeamMemberMultiSelect
                  members={teamMembers}
                  selectedIds={assignedUser ? [assignedUser.id] : []}
                  onChange={handleAssignmentChange}
                  placeholder="Assign team members..."
                />
              )}
            </CardContent>
          </Card>

          {/* Recurring */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Recurring
              </CardTitle>
            </CardHeader>
            <CardContent>
              {job.recurring_schedule_id ? (
                <div className="space-y-2">
                  <RecurringBadge />
                  <p className="text-sm text-gray-600">This job is part of a recurring schedule.</p>
                  <Button variant="outline" size="sm" className="w-full">
                    View Schedule
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-500">This is a one-time job.</p>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setShowRecurringModal(true)}>
                    <RefreshCw className="h-4 w-4" />
                    Make Recurring
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {job.status === 'scheduled' && (
                <Button 
                  className="w-full bg-green-600 hover:bg-green-700"
                  onClick={handleMarkComplete}
                  disabled={isMarkingComplete}
                >
                  {isMarkingComplete ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {isMarkingComplete ? 'Marking Complete...' : 'Mark Complete'}
                </Button>
              )}
              {job.status === 'completed' && (
                <Button className="w-full" href={`/invoices/new?job_id=${job.id}`}>
                  <FileText className="h-4 w-4" />
                  Create Invoice
                </Button>
              )}
              <Button variant="outline" className="w-full" href={`/quotes/new?property_id=${property?.id}`}>
                <Plus className="h-4 w-4" />
                Create Quote
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Make Recurring Modal */}
      <MakeRecurringModal
        isOpen={showRecurringModal}
        onClose={() => setShowRecurringModal(false)}
        jobId={job.id}
        jobType={job.job_type}
        propertyId={property?.id || ''}
        onSuccess={(scheduleId) => {
          setJob({ ...job, recurring_schedule_id: scheduleId });
          setShowRecurringModal(false);
        }}
      />
    </div>
  );
}
