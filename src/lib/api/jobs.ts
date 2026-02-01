// API functions for job operations
import { createClient } from '@/lib/supabase/client';
import type { Job, JobWithDetails } from '@/types/database';
import { 
  mockJobs, 
  getPropertyById, 
  getCustomerById, 
  getUserById,
  getWellInfoByPropertyId,
} from '@/lib/mock-data';

// Check if using mock data
const useMockData = !process.env.NEXT_PUBLIC_SUPABASE_URL || 
                    process.env.NEXT_PUBLIC_SUPABASE_URL === 'your-supabase-url';

// Get all jobs
export async function getJobs(filters?: {
  status?: string;
  assignedTo?: string;
  startDate?: string;
  endDate?: string;
}): Promise<Job[]> {
  if (useMockData) {
    let filtered = [...mockJobs];
    
    if (filters?.status) {
      filtered = filtered.filter(j => j.status === filters.status);
    }
    if (filters?.assignedTo) {
      filtered = filtered.filter(j => j.assigned_to === filters.assignedTo);
    }
    if (filters?.startDate) {
      filtered = filtered.filter(j => j.scheduled_date && j.scheduled_date >= filters.startDate!);
    }
    if (filters?.endDate) {
      filtered = filtered.filter(j => j.scheduled_date && j.scheduled_date <= filters.endDate!);
    }
    
    return filtered.sort((a, b) => {
      if (!a.scheduled_date) return 1;
      if (!b.scheduled_date) return -1;
      return a.scheduled_date.localeCompare(b.scheduled_date);
    });
  }

  const supabase = createClient();
  let query = supabase.from('jobs').select('*');

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  if (filters?.assignedTo) {
    query = query.eq('assigned_to', filters.assignedTo);
  }
  if (filters?.startDate) {
    query = query.gte('scheduled_date', filters.startDate);
  }
  if (filters?.endDate) {
    query = query.lte('scheduled_date', filters.endDate);
  }

  const { data, error } = await query.order('scheduled_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Get job by ID with full details
export async function getJob(id: string): Promise<JobWithDetails | null> {
  if (useMockData) {
    const job = mockJobs.find(j => j.id === id);
    if (!job) return null;
    
    const property = getPropertyById(job.property_id);
    if (!property) return null;
    
    const customer = getCustomerById(property.customer_id);
    const wellInfo = getWellInfoByPropertyId(property.id);
    const assignedUser = job.assigned_to ? getUserById(job.assigned_to) : null;

    return {
      ...job,
      property: {
        ...property,
        well_info: wellInfo || null,
        customer: customer,
      },
      assigned_user: assignedUser,
      line_items: [],
      photos: [],
    };
  }

  const supabase = createClient();
  const { data: job, error } = await supabase
    .from('jobs')
    .select(`
      *,
      property:properties (
        *,
        well_info (*),
        customer:customers (*)
      ),
      assigned_user:users (*),
      line_items:job_line_items (*),
      photos:job_photos (*)
    `)
    .eq('id', id)
    .single();

  if (error) throw error;
  return job;
}

// Create job
export async function createJob(data: Omit<Job, 'id' | 'created_at'>): Promise<Job> {
  if (useMockData) {
    const newJob: Job = {
      ...data,
      id: String(mockJobs.length + 1),
      created_at: new Date().toISOString(),
    };
    mockJobs.push(newJob);
    return newJob;
  }

  const supabase = createClient();
  const { data: job, error } = await supabase
    .from('jobs')
    .insert(data)
    .select()
    .single();

  if (error) throw error;
  return job;
}

// Update job
export async function updateJob(
  id: string, 
  data: Partial<Omit<Job, 'id' | 'created_at'>>
): Promise<Job> {
  if (useMockData) {
    const index = mockJobs.findIndex(j => j.id === id);
    if (index === -1) throw new Error('Job not found');
    
    mockJobs[index] = { ...mockJobs[index], ...data };
    return mockJobs[index];
  }

  const supabase = createClient();
  const { data: job, error } = await supabase
    .from('jobs')
    .update(data)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return job;
}

// Delete job
export async function deleteJob(id: string): Promise<void> {
  if (useMockData) {
    const index = mockJobs.findIndex(j => j.id === id);
    if (index !== -1) {
      mockJobs.splice(index, 1);
    }
    return;
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('jobs')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// Update job status
export async function updateJobStatus(id: string, status: Job['status']): Promise<Job> {
  const updateData: Partial<Job> = { status };
  
  if (status === 'completed') {
    updateData.completed_at = new Date().toISOString();
  }
  
  return updateJob(id, updateData);
}

// Get jobs for date range (for schedule)
export async function getJobsForDateRange(startDate: string, endDate: string): Promise<Job[]> {
  return getJobs({ startDate, endDate });
}

// Get jobs assigned to user
export async function getJobsForUser(userId: string): Promise<Job[]> {
  return getJobs({ assignedTo: userId });
}

// Get unassigned jobs
export async function getUnassignedJobs(): Promise<Job[]> {
  if (useMockData) {
    return mockJobs.filter(j => !j.assigned_to && j.status === 'scheduled');
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .is('assigned_to', null)
    .eq('status', 'scheduled')
    .order('scheduled_date');

  if (error) throw error;
  return data || [];
}

// Assign job to user
export async function assignJob(jobId: string, userId: string | null): Promise<Job> {
  return updateJob(jobId, { assigned_to: userId });
}
