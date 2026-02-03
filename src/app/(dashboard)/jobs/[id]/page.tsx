'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { JobStatusBadge, PriorityBadge, InvoiceStatusBadge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableEmpty } from '@/components/ui/Table';
import { TeamMemberMultiSelect, AssignmentHistory, AssignedTeamAvatars } from '@/components/scheduling';
import {
  mockJobs,
  mockInvoices,
  getPropertyById,
  getCustomerById,
  getUserById,
  getWellInfoByPropertyId,
  getJobAssignments,
  getAssignedUsersForJob,
  getAllTeamMembers,
  assignUserToJob,
  unassignUserFromJob,
} from '@/lib/mock-data';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Clock,
  User,
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
} from 'lucide-react';
import { OnMyWayButton } from '@/components/jobs/OnMyWayButton';
import { format, isPast, isToday } from 'date-fns';

// Mock line items for the job
const mockLineItems = [
  { id: '1', description: 'Labor - Standard Rate', quantity: 3, cost: 60, price: 125, total: 375 },
  { id: '2', description: 'Service Call Fee', quantity: 1, cost: 0, price: 95, total: 95 },
  { id: '3', description: 'Misc. Parts & Materials', quantity: 1, cost: 45, price: 85, total: 85 },
];

// Mock labor entries
const mockLabor = [
  { id: '1', user: 'Mike Thompson', date: '2024-01-30', hours: 2.5, rate: 125, total: 312.50, notes: 'Initial diagnosis' },
  { id: '2', user: 'Carlos Rivera', date: '2024-01-31', hours: 1.5, rate: 125, total: 187.50, notes: 'Parts replacement' },
];

// Mock expenses
const mockExpenses = [
  { id: '1', description: 'Pump gasket kit', amount: 45.00, date: '2024-01-30', reimbursable: true },
  { id: '2', description: 'Pipe fittings', amount: 28.50, date: '2024-01-31', reimbursable: true },
];

// Mock visits
const mockVisits = [
  { id: 'v1', date: '2024-01-30', time: '09:00', status: 'completed', assignedTo: 'Mike Thompson', description: 'Initial inspection' },
  { id: 'v2', date: '2024-01-31', time: '14:00', status: 'completed', assignedTo: 'Carlos Rivera', description: 'Parts replacement' },
  { id: 'v3', date: '2024-02-05', time: '10:00', status: 'upcoming', assignedTo: 'Mike Thompson', description: 'Follow-up check' },
];

export default function JobDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [showProfitability, setShowProfitability] = useState(true);
  const [showAssignmentHistory, setShowAssignmentHistory] = useState(false);
  const { user: currentUser } = useAuth();
  
  const job = mockJobs.find(j => j.id === id);
  
  // State for assignments
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [assignments, setAssignments] = useState(job ? getJobAssignments(id) : []);
  const teamMembers = getAllTeamMembers();
  
  // Initialize assigned user IDs
  useEffect(() => {
    if (job) {
      const assignedUsers = getAssignedUsersForJob(id);
      setAssignedUserIds(assignedUsers.map(u => u.id));
      setAssignments(getJobAssignments(id));
    }
  }, [id, job]);

  // Handle assignment changes
  const handleAssignmentChange = (newSelectedIds: string[]) => {
    const added = newSelectedIds.filter(id => !assignedUserIds.includes(id));
    const removed = assignedUserIds.filter(id => !newSelectedIds.includes(id));
    
    // Add new assignments
    added.forEach(userId => {
      assignUserToJob(id, userId, currentUser?.id || null, null);
      console.log(`Job ${id} assigned to user ${userId}`);
    });
    
    // Remove assignments
    removed.forEach(userId => {
      unassignUserFromJob(id, userId);
      console.log(`Job ${id} unassigned from user ${userId}`);
    });
    
    setAssignedUserIds(newSelectedIds);
    setAssignments(getJobAssignments(id));
  };
  
  if (!job) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Job not found</h2>
        <p className="text-gray-500 mt-2">The job you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/jobs" className="text-green-600 hover:underline mt-4 inline-block">
          Back to Jobs
        </Link>
      </div>
    );
  }

  const property = getPropertyById(job.property_id);
  const customer = property ? getCustomerById(property.customer_id) : null;
  const assignedUser = job.assigned_to ? getUserById(job.assigned_to) : null;
  const wellInfo = property ? getWellInfoByPropertyId(property.id) : null;

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

  // Mock profitability data
  const profitability = {
    totalPrice: 555,
    lineItemCost: 105,
    laborCost: 500,
    expenses: 73.50,
    profit: -123.50,
    margin: -22.3,
  };

  // Related invoices
  const relatedInvoices = mockInvoices.filter(inv => inv.job_id === job.id);

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
              <span className="text-gray-500">Job #{job.id}</span>
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
              <div className="flex items-center gap-3">
                <DollarSign className="h-5 w-5 text-gray-500" />
                <span className="font-semibold text-gray-900">Profitability</span>
                <span className={`text-sm font-medium ${profitability.margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {profitability.margin >= 0 ? '+' : ''}{profitability.margin.toFixed(1)}% margin
                </span>
              </div>
              {showProfitability ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
            </button>
            
            {showProfitability && (
              <CardContent className="pt-0 pb-6">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-center">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 uppercase">Total Price</p>
                    <p className="text-lg font-bold text-gray-900">${profitability.totalPrice.toFixed(2)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 uppercase">Line Item Cost</p>
                    <p className="text-lg font-bold text-red-600">-${profitability.lineItemCost.toFixed(2)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 uppercase">Labor</p>
                    <p className="text-lg font-bold text-red-600">-${profitability.laborCost.toFixed(2)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 uppercase">Expenses</p>
                    <p className="text-lg font-bold text-red-600">-${profitability.expenses.toFixed(2)}</p>
                  </div>
                  <div className={`rounded-lg p-3 ${profitability.profit >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                    <p className="text-xs text-gray-500 uppercase">Profit</p>
                    <p className={`text-lg font-bold ${profitability.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {profitability.profit >= 0 ? '' : '-'}${Math.abs(profitability.profit).toFixed(2)}
                    </p>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Line Items Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Line Items</CardTitle>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4" />
                New Line Item
              </Button>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableCell header>Product / Service</TableCell>
                  <TableCell header className="text-center">Qty</TableCell>
                  <TableCell header className="text-right">Cost</TableCell>
                  <TableCell header className="text-right">Price</TableCell>
                  <TableCell header className="text-right">Total</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockLineItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="font-medium text-gray-900">{item.description}</p>
                    </TableCell>
                    <TableCell className="text-center">{item.quantity}</TableCell>
                    <TableCell className="text-right text-gray-500">${item.cost.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${item.price.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">${item.total.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Labor Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-gray-400" />
                Labor
              </CardTitle>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4" />
                New Time Entry
              </Button>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableCell header>Team Member</TableCell>
                  <TableCell header>Date</TableCell>
                  <TableCell header className="text-center">Hours</TableCell>
                  <TableCell header className="text-right">Rate</TableCell>
                  <TableCell header className="text-right">Total</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockLabor.length === 0 ? (
                  <TableEmpty message="No time entries" />
                ) : (
                  mockLabor.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <p className="font-medium text-gray-900">{entry.user}</p>
                        {entry.notes && <p className="text-sm text-gray-500">{entry.notes}</p>}
                      </TableCell>
                      <TableCell>{format(new Date(entry.date), 'MMM d, yyyy')}</TableCell>
                      <TableCell className="text-center">{entry.hours}</TableCell>
                      <TableCell className="text-right">${entry.rate.toFixed(2)}/hr</TableCell>
                      <TableCell className="text-right font-medium">${entry.total.toFixed(2)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          {/* Expenses Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-gray-400" />
                Expenses
              </CardTitle>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4" />
                New Expense
              </Button>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableCell header>Description</TableCell>
                  <TableCell header>Date</TableCell>
                  <TableCell header className="text-center">Reimbursable</TableCell>
                  <TableCell header className="text-right">Amount</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockExpenses.length === 0 ? (
                  <TableEmpty message="No expenses" />
                ) : (
                  mockExpenses.map((expense) => (
                    <TableRow key={expense.id}>
                      <TableCell className="font-medium text-gray-900">{expense.description}</TableCell>
                      <TableCell>{format(new Date(expense.date), 'MMM d, yyyy')}</TableCell>
                      <TableCell className="text-center">
                        {expense.reimbursable ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">${expense.amount.toFixed(2)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          {/* Visits Section */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gray-400" />
                Visits
              </CardTitle>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4" />
                New Visit
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {mockVisits.map((visit) => {
                const isComplete = visit.status === 'completed';
                const visitDate = new Date(visit.date);
                const isOverdue = !isComplete && isPast(visitDate) && !isToday(visitDate);
                
                return (
                  <div 
                    key={visit.id}
                    className={`flex items-center gap-4 p-4 rounded-lg border ${
                      isOverdue ? 'border-red-200 bg-red-50' : 'border-gray-200'
                    }`}
                  >
                    <input 
                      type="checkbox" 
                      checked={isComplete}
                      readOnly
                      className="h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">
                          {format(visitDate, 'MMM d, yyyy')} at {visit.time}
                        </p>
                        {isOverdue && (
                          <span className="text-xs font-medium text-red-600 bg-red-100 px-2 py-0.5 rounded">
                            OVERDUE
                          </span>
                        )}
                        {isComplete && (
                          <span className="text-xs font-medium text-green-600 bg-green-100 px-2 py-0.5 rounded">
                            COMPLETED
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">{visit.description}</p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <User className="h-4 w-4" />
                        {visit.assignedTo}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Invoices Section */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-gray-400" />
                Invoices
              </CardTitle>
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Create Invoice
              </Button>
            </CardHeader>
            {relatedInvoices.length === 0 ? (
              <CardContent>
                <p className="text-gray-500 text-center py-4">No invoices yet</p>
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableCell header>Invoice</TableCell>
                    <TableCell header>Due Date</TableCell>
                    <TableCell header>Status</TableCell>
                    <TableCell header className="text-right">Balance</TableCell>
                    <TableCell header className="text-right">Total</TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relatedInvoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <Link href={`/invoices/${invoice.id}`} className="font-medium text-green-600 hover:underline">
                          #{invoice.invoice_number}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {invoice.due_date ? format(new Date(invoice.due_date), 'MMM d, yyyy') : '—'}
                      </TableCell>
                      <TableCell>
                        <InvoiceStatusBadge status={invoice.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        ${(invoice.total - invoice.amount_paid).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${invoice.total.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          {/* Internal Notes */}
          <Card>
            <CardHeader>
              <CardTitle>Internal Notes</CardTitle>
              <p className="text-sm text-gray-500">Internal notes will only be seen by your team</p>
            </CardHeader>
            <CardContent>
              <textarea
                className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                placeholder="Add notes for your team..."
                defaultValue={job.internal_notes || ''}
              />
              <div className="mt-3 flex items-center gap-4">
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4" />
                  Attach File
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Sidebar - Job Details */}
        <div className="space-y-6">
          {/* Team Assignment Card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-gray-500" />
                  Team Assignment
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAssignmentHistory(!showAssignmentHistory)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  <History className="h-3.5 w-3.5 mr-1" />
                  History
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Multi-select dropdown */}
              <TeamMemberMultiSelect
                teamMembers={teamMembers.filter(m => m.role === 'field')}
                selectedIds={assignedUserIds}
                onChange={handleAssignmentChange}
                placeholder="Assign team members..."
              />
              
              {/* Show all team members option */}
              {assignedUserIds.length === 0 && (
                <p className="text-xs text-gray-500">
                  Select one or more field technicians to assign to this job.
                </p>
              )}
              
              {/* Assignment History */}
              {showAssignmentHistory && (
                <div className="border-t pt-4 mt-4">
                  <p className="text-sm font-medium text-gray-700 mb-3">Assignment History</p>
                  <AssignmentHistory assignments={assignments} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Job Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Job Type</p>
                <p className="font-medium text-gray-900">One-off</p>
              </div>
              
              {job.scheduled_date && (
                <div>
                  <p className="text-sm text-gray-500">Scheduled</p>
                  <p className="font-medium text-gray-900">
                    {format(new Date(job.scheduled_date), 'MMM d, yyyy')}
                    {job.scheduled_time && ` at ${job.scheduled_time}`}
                  </p>
                </div>
              )}
              
              {job.estimated_duration && (
                <div>
                  <p className="text-sm text-gray-500">Estimated Duration</p>
                  <p className="font-medium text-gray-900">{job.estimated_duration}</p>
                </div>
              )}
              
              {/* Assigned Team Members */}
              <div>
                <p className="text-sm text-gray-500 mb-2">Assigned To</p>
                {assignedUserIds.length > 0 ? (
                  <AssignedTeamAvatars 
                    users={teamMembers.filter(m => assignedUserIds.includes(m.id))} 
                    showNames={true}
                    size="md"
                  />
                ) : (
                  <p className="text-gray-400 italic text-sm">Not assigned</p>
                )}
              </div>
              
              <div>
                <p className="text-sm text-gray-500">Created</p>
                <p className="font-medium text-gray-900">
                  {format(new Date(job.created_at), 'MMM d, yyyy')}
                </p>
              </div>

              {wellInfo && (
                <>
                  <div className="border-t pt-4 mt-4">
                    <p className="text-sm font-semibold text-gray-700 uppercase">Well Info</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Well Depth</p>
                    <p className="font-medium text-gray-900">{wellInfo.well_depth} ft</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Pump Model</p>
                    <p className="font-medium text-gray-900">{wellInfo.pump_model}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Pump HP</p>
                    <p className="font-medium text-gray-900">{wellInfo.pump_hp} HP</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardContent className="py-4 space-y-2">
              <Button className="w-full justify-start" variant="outline">
                <Calendar className="h-4 w-4" />
                Schedule Visit
              </Button>
              <Button className="w-full justify-start" variant="outline">
                <FileText className="h-4 w-4" />
                Create Invoice
              </Button>
              <Button className="w-full justify-start" variant="outline">
                <Mail className="h-4 w-4" />
                Email Client
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
