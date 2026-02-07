import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, parseISO, format, differenceInMinutes } from 'date-fns';

type DateRange = 'today' | 'week' | 'month' | 'year' | 'custom';

function getDateRange(range: DateRange, startDate?: string, endDate?: string) {
  const now = new Date();
  
  switch (range) {
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now) };
    case 'week':
      return { start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfWeek(now, { weekStartsOn: 0 }) };
    case 'month':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'year':
      return { start: startOfYear(now), end: endOfYear(now) };
    case 'custom':
      if (startDate && endDate) {
        return { start: startOfDay(parseISO(startDate)), end: endOfDay(parseISO(endDate)) };
      }
      return { start: subDays(now, 30), end: now };
    default:
      return { start: startOfMonth(now), end: endOfMonth(now) };
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const searchParams = request.nextUrl.searchParams;
    
    const range = (searchParams.get('range') || 'month') as DateRange;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    
    const { start, end } = getDateRange(range, startDate, endDate);
    const startISO = start.toISOString();
    const endISO = end.toISOString();

    // Get all jobs in the date range
    const { data: jobs, error: jobError } = await supabase
      .from('jobs')
      .select(`
        id, 
        status, 
        job_type, 
        scheduled_date,
        created_at,
        completed_at,
        assigned_to,
        property:properties!inner (
          customer:customers (name)
        )
      `)
      .gte('scheduled_date', startISO.split('T')[0])
      .lte('scheduled_date', endISO.split('T')[0]);

    if (jobError) {
      console.error('Error fetching jobs:', jobError);
      return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
    }

    // Count by status
    const statusCounts = {
      scheduled: 0,
      in_progress: 0,
      completed: 0,
      invoiced: 0,
    };

    jobs?.forEach(job => {
      if (job.status in statusCounts) {
        statusCounts[job.status as keyof typeof statusCounts]++;
      }
    });

    // Count by job type
    const jobTypeCounts: Record<string, number> = {};
    jobs?.forEach(job => {
      const type = job.job_type || 'Other';
      jobTypeCounts[type] = (jobTypeCounts[type] || 0) + 1;
    });

    const byType = Object.entries(jobTypeCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Jobs by date for trend
    const jobsByDate: Record<string, { scheduled: number; completed: number }> = {};
    jobs?.forEach(job => {
      const date = job.scheduled_date;
      if (date) {
        if (!jobsByDate[date]) {
          jobsByDate[date] = { scheduled: 0, completed: 0 };
        }
        jobsByDate[date].scheduled++;
        if (job.status === 'completed' || job.status === 'invoiced') {
          jobsByDate[date].completed++;
        }
      }
    });

    const trend = Object.entries(jobsByDate)
      .map(([date, data]) => ({
        date,
        label: format(parseISO(date), 'MMM d'),
        scheduled: data.scheduled,
        completed: data.completed,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calculate completion rate
    const totalJobs = jobs?.length || 0;
    const completedJobs = statusCounts.completed + statusCounts.invoiced;
    const completionRate = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;

    // Get recent jobs for the table
    const { data: recentJobs, error: recentError } = await supabase
      .from('jobs')
      .select(`
        id,
        job_number,
        status,
        job_type,
        scheduled_date,
        completed_at,
        assigned_to,
        property:properties (
          address,
          customer:customers (name)
        ),
        assigned_user:team_members!jobs_assigned_to_fkey (name)
      `)
      .order('scheduled_date', { ascending: false })
      .limit(10);

    if (recentError) {
      console.error('Error fetching recent jobs:', recentError);
    }

    // Previous period comparison
    const periodDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const prevStart = subDays(start, periodDays);
    const prevEnd = subDays(end, periodDays);

    const { data: prevJobs } = await supabase
      .from('jobs')
      .select('id, status')
      .gte('scheduled_date', prevStart.toISOString().split('T')[0])
      .lte('scheduled_date', prevEnd.toISOString().split('T')[0]);

    const prevTotal = prevJobs?.length || 0;
    const jobsChange = prevTotal > 0 
      ? Math.round(((totalJobs - prevTotal) / prevTotal) * 100) 
      : 0;

    return NextResponse.json({
      summary: {
        total: totalJobs,
        scheduled: statusCounts.scheduled,
        inProgress: statusCounts.in_progress,
        completed: completedJobs,
        completionRate,
        jobsChange,
      },
      byStatus: [
        { name: 'Scheduled', value: statusCounts.scheduled, color: '#3B82F6' },
        { name: 'In Progress', value: statusCounts.in_progress, color: '#F59E0B' },
        { name: 'Completed', value: statusCounts.completed, color: '#10B981' },
        { name: 'Invoiced', value: statusCounts.invoiced, color: '#8B5CF6' },
      ],
      byType,
      trend,
      recentJobs: recentJobs?.map(job => ({
        id: job.id,
        jobNumber: job.job_number,
        status: job.status,
        type: job.job_type,
        scheduledDate: job.scheduled_date,
        completedAt: job.completed_at,
        customerName: (job.property as any)?.customer?.name || 'Unknown',
        address: (job.property as any)?.address || '',
        techName: (job.assigned_user as any)?.name || 'Unassigned',
      })) || [],
      dateRange: {
        start: startISO,
        end: endISO,
        range,
      },
    });
  } catch (error) {
    console.error('Jobs report error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
