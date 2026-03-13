'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/feedback/Toaster';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TeamMemberMultiSelect } from './TeamMemberMultiSelect';
import type { JobType } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import type { Job, JobPriority } from '@/types/database';
import {
  Search,
  User,
  Users,
  Calendar,
  FileText,
  Repeat,
  Loader2,
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
  initialData?: {
    customer_id?: string;
    customer_name?: string;
    property_id?: string;
    address?: string;
    city?: string;
    job_type?: string;
    description?: string;
    notes?: string;
    quote_id?: string;
    request_id?: string;
  };
}

export function JobForm({ job, mode, initialData }: JobFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [customerProperties, setCustomerProperties] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingCustomer, setIsLoadingCustomer] = useState(false);
  const [showNewProperty, setShowNewProperty] = useState(false);
  const [newPropertyAddress, setNewPropertyAddress] = useState('');
  const [newPropertyCity, setNewPropertyCity] = useState('');
  const [newPropertyZip, setNewPropertyZip] = useState('');
  const [isSavingProperty, setIsSavingProperty] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false);
  
  // Google Places autocomplete
  const searchAddress = useCallback(async (query: string) => {
    if (query.length < 3) { setAddressSuggestions([]); return; }
    try {
      const res = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setAddressSuggestions(data.predictions || []);
        setShowAddressSuggestions(true);
      }
    } catch (err) {
      console.error('Address search failed:', err);
    }
  }, []);

  const selectAddress = useCallback(async (placeId: string, description: string) => {
    setShowAddressSuggestions(false);
    try {
      const res = await fetch(`/api/places/details?place_id=${placeId}`);
      if (res.ok) {
        const data = await res.json();
        const result = data.result;
        if (result) {
          setNewPropertyAddress(result.address || description.split(',')[0]);
          setNewPropertyCity(result.city || '');
          setNewPropertyZip(result.zip || '');
        }
      }
    } catch (err) {
      // Fallback: parse from description
      const parts = description.split(',').map((s: string) => s.trim());
      setNewPropertyAddress(parts[0] || '');
      setNewPropertyCity(parts[1] || '');
    }
  }, []);

  // Debounced address search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (newPropertyAddress && showNewProperty) {
        searchAddress(newPropertyAddress);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [newPropertyAddress, showNewProperty, searchAddress]);
  
  // State for team assignments (multiple)
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  
  // Job types from Supabase
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [isLoadingJobTypes, setIsLoadingJobTypes] = useState(true);
  
  // Team members from Supabase
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [isLoadingTeam, setIsLoadingTeam] = useState(true);
  
  // Fetch team members and job types on mount
  useEffect(() => {
    const fetchTeamMembers = async () => {
      try {
        const res = await fetch('/api/users');
        if (res.ok) {
          const data = await res.json();
          setTeamMembers(data.users || []);
        }
      } catch (error) {
        console.error('Failed to fetch team members:', error);
      } finally {
        setIsLoadingTeam(false);
      }
    };
    
    const fetchJobTypes = async () => {
      try {
        const res = await fetch('/api/job-types');
        if (res.ok) {
          const data = await res.json();
          setJobTypes(data.jobTypes || []);
        }
      } catch (error) {
        console.error('Failed to fetch job types:', error);
      } finally {
        setIsLoadingJobTypes(false);
      }
    };
    
    fetchTeamMembers();
    fetchJobTypes();
    
    // Fetch assigned users if editing
    if (job?.assigned_to) {
      setAssignedUserIds([job.assigned_to]);
    }
  }, [job]);

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
      customer_id: initialData?.customer_id || '',
      property_id: initialData?.property_id || job?.property_id || '',
      job_type: initialData?.job_type || job?.job_type || '',
      scheduled_date: job?.scheduled_date || prefilledDate || '',
      scheduled_time: job?.scheduled_time || '',
      estimated_duration: job?.estimated_duration || '',
      assigned_to: job?.assigned_to || '',
      priority: job?.priority || 'normal',
      description: initialData?.description || job?.description || '',
      internal_notes: initialData?.notes || job?.internal_notes || '',
      is_recurring: false,
      recurring_frequency: undefined,
      recurring_day_of_week: undefined,
      recurring_day_of_month: undefined,
    },
  });

  // Fetch customer by ID (for pre-populating from quote)
  const fetchCustomerById = useCallback(async (customerId: string) => {
    setIsLoadingCustomer(true);
    try {
      const res = await fetch(`/api/customers/${customerId}`);
      if (res.ok) {
        const data = await res.json();
        const customer = data.customer;
        setSelectedCustomer(customer);
        setSelectedCustomerId(customer.id);
        setCustomerSearch(customer.name);
        setValue('customer_id', customer.id);
        // Set properties from customer
        if (customer.properties && customer.properties.length > 0) {
          setCustomerProperties(customer.properties);
          // Auto-select first property if not already set
          if (initialData?.property_id) {
            setValue('property_id', initialData.property_id);
          } else {
            setValue('property_id', customer.properties[0].id);
          }
        } else {
          setCustomerProperties([]);
        }
      }
    } catch (error) {
      console.error('Failed to fetch customer:', error);
    } finally {
      setIsLoadingCustomer(false);
    }
  }, [setValue, initialData?.property_id]);

  // Search customers
  const searchCustomers = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(query)}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.customers || []);
      }
    } catch (error) {
      console.error('Failed to search customers:', error);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (customerSearch && !selectedCustomer) {
        searchCustomers(customerSearch);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearch, selectedCustomer, searchCustomers]);

  // If initialData has customer_id, fetch the customer
  useEffect(() => {
    if (initialData?.customer_id && !selectedCustomer) {
      fetchCustomerById(initialData.customer_id);
    }
    if (initialData?.job_type) {
      setValue('job_type', initialData.job_type);
    }
    if (initialData?.description) {
      setValue('description', initialData.description);
    }
    if (initialData?.notes) {
      setValue('internal_notes', initialData.notes);
    }
  }, [initialData, setValue, fetchCustomerById, selectedCustomer]);

  const watchJobType = watch('job_type');
  const watchIsRecurring = watch('is_recurring');
  const watchFrequency = watch('recurring_frequency');

  // Auto-fill duration when job type changes
  useEffect(() => {
    if (watchJobType && jobTypes.length > 0) {
      const jobType = jobTypes.find(jt => jt.name === watchJobType);
      if (jobType?.default_duration) {
        setValue('estimated_duration', jobType.default_duration);
      }
    }
  }, [watchJobType, setValue, jobTypes]);

  // customerProperties is now managed via state when selecting a customer

  // Handle selecting a customer from dropdown
  const handleCustomerSelect = async (customer: any) => {
    setSelectedCustomerId(customer.id);
    setSelectedCustomer(customer);
    setCustomerSearch(customer.name);
    setValue('customer_id', customer.id);
    setValue('property_id', ''); // Reset property when customer changes
    setShowCustomerDropdown(false);
    setSearchResults([]);
    
    // Fetch customer with properties
    try {
      const res = await fetch(`/api/customers/${customer.id}`);
      if (res.ok) {
        const data = await res.json();
        const fullCustomer = data.customer;
        if (fullCustomer.properties && fullCustomer.properties.length > 0) {
          setCustomerProperties(fullCustomer.properties);
          // Auto-select first property
          setValue('property_id', fullCustomer.properties[0].id);
        } else {
          setCustomerProperties([]);
        }
      }
    } catch (error) {
      console.error('Failed to fetch customer properties:', error);
    }
  };

  const onSubmit = async (data: JobFormData) => {
    try {
      const payload = {
        property_id: data.property_id,
        job_type: data.job_type,
        scheduled_date: data.scheduled_date || null,
        scheduled_time: data.scheduled_time || null,
        estimated_duration: data.estimated_duration || null,
        description: data.description || null,
        internal_notes: data.internal_notes || null,
        priority: data.priority,
        assigned_to: assignedUserIds.length > 0 ? assignedUserIds[0] : null, // Primary assignee
      };

      let res;
      if (mode === 'create') {
        res = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else if (job) {
        res = await fetch(`/api/jobs/${job.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (!res?.ok) {
        const error = await res?.json();
        throw new Error(error?.error || 'Failed to save job');
      }

      router.push('/jobs');
    } catch (error) {
      toast.error('Failed to save job', error instanceof Error ? error.message : undefined);
    }
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
                  // If user types after selecting, reset selection
                  if (selectedCustomer && e.target.value !== selectedCustomer.name) {
                    setSelectedCustomer(null);
                    setSelectedCustomerId('');
                    setCustomerProperties([]);
                    setValue('customer_id', '');
                    setValue('property_id', '');
                  }
                }}
                onFocus={() => !selectedCustomer && setShowCustomerDropdown(true)}
                placeholder="Search customers..."
                className="w-full h-10 pl-10 pr-4 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              {isLoadingCustomer && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-blue-500" />
              )}
            </div>
            
            {/* Customer Dropdown */}
            {showCustomerDropdown && !selectedCustomer && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {isSearching ? (
                  <div className="px-4 py-3 flex items-center gap-2 text-gray-500 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </div>
                ) : searchResults.length > 0 ? (
                  searchResults.map(customer => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => handleCustomerSelect(customer)}
                      className="w-full px-4 py-2 text-left hover:bg-gray-50 border-b last:border-0"
                    >
                      <p className="font-medium text-gray-900">{customer.name}</p>
                      <p className="text-sm text-gray-500">{customer.email} · {customer.phone}</p>
                    </button>
                  ))
                ) : customerSearch.length >= 2 ? (
                  <p className="px-4 py-3 text-gray-500 text-sm">No customers found</p>
                ) : (
                  <p className="px-4 py-3 text-gray-500 text-sm">Type at least 2 characters to search...</p>
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
            {customerProperties.length === 0 && selectedCustomerId && !showNewProperty && (
              <p className="mt-1 text-sm text-gray-500">No properties found for this customer</p>
            )}
            {errors.property_id && (
              <p className="mt-1 text-sm text-red-500">{errors.property_id.message}</p>
            )}
            
            {/* Add New Property */}
            {selectedCustomerId && !showNewProperty && (
              <button
                type="button"
                onClick={() => setShowNewProperty(true)}
                className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                + Add new address
              </button>
            )}
            {showNewProperty && (
              <div className="mt-3 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                <p className="text-sm font-medium text-gray-700">New Property Address</p>
                <div className="relative">
                  <input
                    type="text"
                    value={newPropertyAddress}
                    onChange={(e) => setNewPropertyAddress(e.target.value)}
                    onFocus={() => addressSuggestions.length > 0 && setShowAddressSuggestions(true)}
                    placeholder="Start typing an address..."
                    className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    autoComplete="off"
                  />
                  {showAddressSuggestions && addressSuggestions.length > 0 && (
                    <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {addressSuggestions.map((suggestion: any) => (
                        <button
                          key={suggestion.place_id}
                          type="button"
                          onClick={() => selectAddress(suggestion.place_id, suggestion.description)}
                          className="w-full px-4 py-2.5 text-left hover:bg-gray-50 border-b last:border-0 text-sm"
                        >
                          <p className="font-medium text-gray-900">{suggestion.structured_formatting?.main_text || suggestion.description.split(',')[0]}</p>
                          <p className="text-xs text-gray-500">{suggestion.structured_formatting?.secondary_text || suggestion.description}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={newPropertyCity}
                    onChange={(e) => setNewPropertyCity(e.target.value)}
                    placeholder="City"
                    className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    value={newPropertyZip}
                    onChange={(e) => setNewPropertyZip(e.target.value)}
                    placeholder="ZIP code"
                    className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!newPropertyAddress || !newPropertyCity || isSavingProperty}
                    onClick={async () => {
                      setIsSavingProperty(true);
                      try {
                        const res = await fetch(`/api/customers/${selectedCustomerId}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            add_property: {
                              address: newPropertyAddress,
                              city: newPropertyCity,
                              zip: newPropertyZip,
                              county: 'San Diego',
                              customer_id: selectedCustomerId,
                            }
                          }),
                        });
                        if (res.ok) {
                          // Refetch customer to get updated properties
                          const custRes = await fetch(`/api/customers/${selectedCustomerId}`);
                          if (custRes.ok) {
                            const data = await custRes.json();
                            const props = data.customer.properties || [];
                            setCustomerProperties(props);
                            // Select the newly added property (last one)
                            const newProp = props.find((p: any) => 
                              p.address === newPropertyAddress && p.city === newPropertyCity
                            ) || props[props.length - 1];
                            if (newProp) setValue('property_id', newProp.id);
                          }
                          setShowNewProperty(false);
                          setNewPropertyAddress('');
                          setNewPropertyCity('');
                          setNewPropertyZip('');
                          toast.success('Property added');
                        } else {
                          toast.error('Failed to add property');
                        }
                      } catch (err) {
                        toast.error('Failed to add property');
                      } finally {
                        setIsSavingProperty(false);
                      }
                    }}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isSavingProperty ? 'Saving...' : 'Add Property'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowNewProperty(false); setNewPropertyAddress(''); setNewPropertyCity(''); setNewPropertyZip(''); }}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
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
              disabled={isLoadingJobTypes}
              className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">{isLoadingJobTypes ? 'Loading...' : 'Select job type...'}</option>
              {jobTypes.map(jt => (
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
            {isLoadingTeam ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading team...
              </div>
            ) : (
              <TeamMemberMultiSelect
                teamMembers={teamMembers}
                selectedIds={assignedUserIds}
                onChange={setAssignedUserIds}
                placeholder="Select team members to assign..."
              />
            )}
            <p className="text-xs text-gray-500 mt-1">
              You can assign multiple team members to this job.
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
