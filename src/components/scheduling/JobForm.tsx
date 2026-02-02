'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TeamMemberMultiSelect } from './TeamMemberMultiSelect';
import {
  mockCustomers,
  mockProperties,
  mockJobTypes,
  mockUsers,
  getPropertiesByCustomerId,
  getFieldCrew,
  getAssignedUsersForJob,
  assignUserToJob,
  unassignUserFromJob,
} from '@/lib/mock-data';
import { useAuth } from '@/contexts/AuthContext';
import type { Job, JobPriority } from '@/types/database';
import {
  Search,
  User,
  Users,
  Calendar,
  FileText,
  Repeat,
} from 'lucide-react';

const jobSchema = z.object({
  customer_id: z.string().min(1, 'Customer is required'),
  property_id: z.string().min(1, 'Property is required'),
  job_type: z.string().min(1, 'Job type is required'),
  scheduled_date: z.string().optional(),
  scheduled_time: z.string().optional(),
  estimated_duration: z.string().optional(),
  assigned_to: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  description: z.string().optional(),
  internal_notes: z.string().optional(),
  is_recurring: z.boolean(),
  recurring_frequency: z.enum(['weekly', 'monthly', 'quarterly', 'annual']).optional(),
  recurring_day_of_week: z.number().optional(),
  recurring_day_of_month: z.number().optional(),
});

type JobFormData = z.infer<typeof jobSchema>;

interface JobFormProps {
  job?: Job;
  mode: 'create' | 'edit';
}

export function JobForm({ job, mode }: JobFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user: currentUser } = useAuth();
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState(job?.property_id ? 
    mockProperties.find(p => p.id === job.property_id)?.customer_id : '');
  
  // State for team assignments (multiple)
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>(() => {
    if (job) {
      return getAssignedUsersForJob(job.id).map(u => u.id);
    }
    return [];
  });
  
  const fieldCrew = getFieldCrew();

  // Get pre-filled date from URL params (from calendar click)
  const prefilledDate = searchParams.get('date');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<JobFormData>({
    resolver: zodResolver(jobSchema),
    defaultValues: {
      customer_id: selectedCustomerId || '',
      property_id: job?.property_id || '',
      job_type: job?.job_type || '',
      scheduled_date: job?.scheduled_date || prefilledDate || '',
      scheduled_time: job?.scheduled_time || '',
      estimated_duration: job?.estimated_duration || '',
      assigned_to: job?.assigned_to || '',
      priority: job?.priority || 'normal',
      description: job?.description || '',
      internal_notes: job?.internal_notes || '',
      is_recurring: false,
      recurring_frequency: undefined,
      recurring_day_of_week: undefined,
      recurring_day_of_month: undefined,
    },
  });

  const watchJobType = watch('job_type');
  const watchIsRecurring = watch('is_recurring');
  const watchFrequency = watch('recurring_frequency');

  // Auto-fill duration when job type changes
  useEffect(() => {
    if (watchJobType) {
      const jobType = mockJobTypes.find(jt => jt.name === watchJobType);
      if (jobType?.default_duration) {
        setValue('estimated_duration', jobType.default_duration);
      }
    }
  }, [watchJobType, setValue]);

  // Get available properties for selected customer
  const customerProperties = useMemo(() => {
    if (!selectedCustomerId) return [];
    return getPropertiesByCustomerId(selectedCustomerId);
  }, [selectedCustomerId]);

  // Filter customers for search
  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return mockCustomers.slice(0, 5);
    const search = customerSearch.toLowerCase();
    return mockCustomers.filter(c => 
      c.name.toLowerCase().includes(search) ||
      c.email?.toLowerCase().includes(search) ||
      c.phone?.includes(search)
    ).slice(0, 10);
  }, [customerSearch]);

  const handleCustomerSelect = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setValue('customer_id', customerId);
    setValue('property_id', ''); // Reset property when customer changes
    setShowCustomerDropdown(false);
    const customer = mockCustomers.find(c => c.id === customerId);
    if (customer) setCustomerSearch(customer.name);
  };

  const onSubmit = async (data: JobFormData) => {
    // Handle team assignments
    if (job) {
      // Get current assignments
      const currentAssignedIds = getAssignedUsersForJob(job.id).map(u => u.id);
      
      // Find additions and removals
      const toAdd = assignedUserIds.filter(id => !currentAssignedIds.includes(id));
      const toRemove = currentAssignedIds.filter(id => !assignedUserIds.includes(id));
      
      // Apply changes
      toAdd.forEach(userId => {
        assignUserToJob(job.id, userId, currentUser?.id || null);
        console.log(`Assigned user ${userId} to job ${job.id}`);
      });
      
      toRemove.forEach(userId => {
        unassignUserFromJob(job.id, userId);
        console.log(`Unassigned user ${userId} from job ${job.id}`);
      });
    }
    
    // TODO: Implement actual save to Supabase
    alert(mode === 'create' ? 'Job created!' : 'Job updated!');
    router.push('/jobs');
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Customer Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" />
            Customer & Property
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Customer Search */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer *
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setShowCustomerDropdown(true);
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                placeholder="Search customers..."
                className="w-full h-10 pl-10 pr-4 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            
            {/* Customer Dropdown */}
            {showCustomerDropdown && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredCustomers.map(customer => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => handleCustomerSelect(customer.id)}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 border-b last:border-0"
                  >
                    <p className="font-medium text-gray-900">{customer.name}</p>
                    <p className="text-sm text-gray-500">{customer.email} · {customer.phone}</p>
                  </button>
                ))}
                {filteredCustomers.length === 0 && (
                  <p className="px-4 py-3 text-gray-500 text-sm">No customers found</p>
                )}
              </div>
            )}
            {errors.customer_id && (
              <p className="mt-1 text-sm text-red-500">{errors.customer_id.message}</p>
            )}
          </div>

          {/* Property Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Property *
            </label>
            <select
              {...register('property_id')}
              disabled={!selectedCustomerId}
              className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              <option value="">Select a property...</option>
              {customerProperties.map(property => (
                <option key={property.id} value={property.id}>
                  {property.address}, {property.city}
                </option>
              ))}
            </select>
            {customerProperties.length === 0 && selectedCustomerId && (
              <p className="mt-1 text-sm text-gray-500">No properties found for this customer</p>
            )}
            {errors.property_id && (
              <p className="mt-1 text-sm text-red-500">{errors.property_id.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Job Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Job Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Job Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Job Type *
            </label>
            <select
              {...register('job_type')}
              className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select job type...</option>
              {mockJobTypes.map(jt => (
                <option key={jt.id} value={jt.name}>
                  {jt.name} ({jt.default_duration})
                </option>
              ))}
            </select>
            {errors.job_type && (
              <p className="mt-1 text-sm text-red-500">{errors.job_type.message}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              {...register('description')}
              rows={3}
              placeholder="Describe the job..."
              className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Internal Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Internal Notes
            </label>
            <textarea
              {...register('internal_notes')}
              rows={2}
              placeholder="Notes for the team (not visible to customer)..."
              className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Priority
            </label>
            <div className="flex gap-2">
              {(['low', 'normal', 'high', 'urgent'] as JobPriority[]).map(p => (
                <label
                  key={p}
                  className={`
                    flex-1 py-2 px-3 rounded-lg border text-center cursor-pointer transition-colors
                    ${watch('priority') === p 
                      ? p === 'urgent' ? 'bg-red-100 border-red-300 text-red-700'
                        : p === 'high' ? 'bg-orange-100 border-orange-300 text-orange-700'
                        : 'bg-blue-100 border-blue-300 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }
                  `}
                >
                  <input
                    type="radio"
                    value={p}
                    {...register('priority')}
                    className="sr-only"
                  />
                  <span className="text-sm font-medium capitalize">{p}</span>
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Scheduling */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Scheduling
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date
              </label>
              <input
                type="date"
                {...register('scheduled_date')}
                className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Time
              </label>
              <input
                type="time"
                {...register('scheduled_time')}
                className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Duration */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Est. Duration
              </label>
              <select
                {...register('estimated_duration')}
                className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select...</option>
                <option value="30 minutes">30 minutes</option>
                <option value="1 hour">1 hour</option>
                <option value="2 hours">2 hours</option>
                <option value="3 hours">3 hours</option>
                <option value="4 hours">4 hours</option>
                <option value="5 hours">5 hours</option>
                <option value="6 hours">6 hours</option>
                <option value="All day">All day</option>
              </select>
            </div>
          </div>

          {/* Assign To (Multiple Team Members) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
              <Users className="h-4 w-4" />
              Assign Team Members
            </label>
            <TeamMemberMultiSelect
              teamMembers={fieldCrew}
              selectedIds={assignedUserIds}
              onChange={setAssignedUserIds}
              placeholder="Select team members to assign..."
            />
            <p className="text-xs text-gray-500 mt-1">
              You can assign multiple field technicians to this job.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Recurring Options */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Repeat className="h-4 w-4" />
            Repeat Options
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              {...register('is_recurring')}
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">Create as recurring job</span>
          </label>

          {watchIsRecurring && (
            <div className="pl-8 space-y-4 border-l-2 border-blue-200">
              {/* Frequency */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Repeat Every
                </label>
                <select
                  {...register('recurring_frequency')}
                  className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select frequency...</option>
                  <option value="weekly">Week</option>
                  <option value="monthly">Month</option>
                  <option value="quarterly">Quarter (3 months)</option>
                  <option value="annual">Year</option>
                </select>
              </div>

              {/* Day of Week (for weekly) */}
              {watchFrequency === 'weekly' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Day of Week
                  </label>
                  <select
                    {...register('recurring_day_of_week', { valueAsNumber: true })}
                    className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value={1}>Monday</option>
                    <option value={2}>Tuesday</option>
                    <option value={3}>Wednesday</option>
                    <option value={4}>Thursday</option>
                    <option value={5}>Friday</option>
                    <option value={6}>Saturday</option>
                    <option value={0}>Sunday</option>
                  </select>
                </div>
              )}

              {/* Day of Month (for monthly/quarterly/annual) */}
              {(watchFrequency === 'monthly' || watchFrequency === 'quarterly' || watchFrequency === 'annual') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Day of Month
                  </label>
                  <select
                    {...register('recurring_day_of_month', { valueAsNumber: true })}
                    className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    {Array.from({ length: 28 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{i + 1}</option>
                    ))}
                    <option value={-1}>Last day of month</option>
                  </select>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form Actions */}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Job' : 'Update Job'}
        </Button>
      </div>
    </form>
  );
}
