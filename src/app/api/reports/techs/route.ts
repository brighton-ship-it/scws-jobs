import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, parseISO, differenceInMinutes } from 'date-fns';

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
    const supabase = createServiceClient();
    const searchParams = request.nextUrl.searchParams;
    
    const range = (searchParams.get('range') || 'month') as DateRange;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    
    const { start, end } = getDateRange(range, startDate, endDate);
    const startISO = start.toISOString();
    const endISO = end.toISOString();

    // Get all techs (field users)
    const { data: techs, error: techError } = await supabase
      .from('users')
      .select('id, name, role')
      .in('role', ['field', 'admin']);

    if (techError) {
      console.error('Error fetching techs:', techError);
      return NextResponse.json({ error: 'Failed to fetch technicians' }, { status: 500 });
    }

    // Get jobs with tech assignments in date range
    const { data: jobs, error: jobError } = await supabase
      .from('jobs')
      .select(`
        id,
        status,
        job_type,
        assigned_to,
        scheduled_date,
        scheduled_time,
        completed_at,
        created_at
      `)
      .gte('scheduled_date', startISO.split('T')[0])
      .lte('scheduled_date', endISO.split('T')[0])
      .not('assigned_to', 'is', null);

    if (jobError) {
      console.error('Error fetching jobs:', jobError);
      return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
    }

    // Also get job assignments for multi-tech jobs
    const { data: assignments, error: assignmentError } = await supabase
      .from('job_assignments')
      .select('job_id, user_id');

    // Build tech stats
    const techStats: Record<string, {
      name: string;
      totalJobs: number;
      completedJobs: number;
      scheduledJobs: number;
      inProgressJobs: number;
      avgCompletionMinutes: number[];
    }> = {};

    // Initialize tech stats
    techs?.forEach(tech => {
      techStats[tech.id] = {
        name: tech.name,
        totalJobs: 0,
        completedJobs: 0,
        scheduledJobs: 0,
        inProgressJobs: 0,
        avgCompletionMinutes: [],
      };
    });

    // Process jobs
    jobs?.forEach(job => {
      const techId = job.assigned_to;
      if (techId && techStats[techId]) {
        techStats[techId].totalJobs++;
        
        if (job.status === 'completed' || job.status === 'invoiced') {
          techStats[techId].completedJobs++;
          
          // Calculate completion time if we have both dates
          if (job.completed_at && job.scheduled_date && job.scheduled_time) {
            const scheduledDateTime = parseISO(`${job.scheduled_date}T${job.scheduled_time}`);
            const completedDateTime = parseISO(job.completed_at);
            const minutes = differenceInMinutes(completedDateTime, scheduledDateTime);
            if (minutes > 0 && minutes < 1440) { // Ignore unrealistic times (> 24 hours)
              techStats[techId].avgCompletionMinutes.push(minutes);
            }
          }
        } else if (job.status === 'scheduled') {
          techStats[techId].scheduledJobs++;
        } else if (job.status === 'in_progress') {
          techStats[techId].inProgressJobs++;
        }
      }
    });

    // Also count from job_assignments
    if (!assignmentError && assignments) {
      const jobMap = new Map(jobs?.map(j => [j.id, j]) || []);
      assignments.forEach(a => {
        const job = jobMap.get(a.job_id);
        if (job && techStats[a.user_id] && a.user_id !== job.assigned_to) {
          // Only count if this is an additional assignment, not the primary
          techStats[a.user_id].totalJobs++;
          if (job.status === 'completed' || job.status === 'invoiced') {
            techStats[a.user_id].completedJobs++;
          }
        }
      });
    }

    // Calculate final stats
    const techPerformance = Object.entries(techStats)
      .filter(([_, stats]) => stats.totalJobs > 0)
      .map(([id, stats]) => {
        const avgMinutes = stats.avgCompletionMinutes.length > 0
          ? Math.round(stats.avgCompletionMinutes.reduce((a, b) => a + b, 0) / stats.avgCompletionMinutes.length)
          : null;
        
        return {
          id,
          name: stats.name,
          totalJobs: stats.totalJobs,
          completedJobs: stats.completedJobs,
          scheduledJobs: stats.scheduledJobs,
          inProgressJobs: stats.inProgressJobs,
          completionRate: Math.round((stats.completedJobs / stats.totalJobs) * 100),
          avgCompletionTime: avgMinutes ? `${Math.floor(avgMinutes / 60)}h ${avgMinutes % 60}m` : 'N/A',
          avgCompletionMinutes: avgMinutes,
        };
      })
      .sort((a, b) => b.completedJobs - a.completedJobs);

    // Leaderboard data for chart
    const leaderboard = techPerformance.slice(0, 10).map(t => ({
      name: t.name.split(' ')[0], // First name only for chart
      jobs: t.completedJobs,
      fullName: t.name,
    }));

    // Summary stats
    const totalJobsAssigned = jobs?.length || 0;
    const totalCompleted = jobs?.filter(j => j.status === 'completed' || j.status === 'invoiced').length || 0;
    const activeTechs = techPerformance.filter(t => t.totalJobs > 0).length;

    return NextResponse.json({
      summary: {
        activeTechs,
        totalJobsAssigned,
        totalCompleted,
        avgJobsPerTech: activeTechs > 0 ? Math.round(totalJobsAssigned / activeTechs) : 0,
      },
      techPerformance,
      leaderboard,
      dateRange: {
        start: startISO,
        end: endISO,
        range,
      },
    });
  } catch (error) {
    console.error('Tech report error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
