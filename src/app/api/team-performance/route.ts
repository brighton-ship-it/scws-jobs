import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { startOfMonth, endOfMonth, parseISO, format, differenceInBusinessDays, eachDayOfInterval, isWeekend } from 'date-fns';

// Constants for margin calculations
const LOADED_RATE_MULTIPLIER = 1.3; // 30% burden on top of hourly rate
const TRUCK_COST_PER_DAY = 80;
const PARTS_COST_RATIO = 0.5; // 50% of parts revenue is cost

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  hourly_rate: number | null;
  tech_type: string | null;
  active: boolean;
}

interface JobRow {
  id: string;
  job_type: string;
  status: string;
  scheduled_date: string | null;
  completed_at: string | null;
  crew_lead_id: string | null;
  crew_helper_id: string | null;
  crew_type: string | null;
  assigned_to: string | null;
}

interface InvoiceRow {
  id: string;
  job_id: string | null;
  total: number | null;
  status: string;
}

interface InvoiceItemRow {
  invoice_id: string;
  item_type: string | null;
  total: number | null;
}

interface PerformanceData {
  teamMember: TeamMember;
  visits: number;
  uniqueJobs: number;
  revenue: number;
  partsRevenue: number;
  laborRevenue: number;
  daysWorked: number;
  revenuePerDay: number;
  visitsPerDay: number;
  avgTicket: number;
  laborCost: number;
  partsCost: number;
  truckCost: number;
  totalCost: number;
  profit: number;
  margin: number;
  crewType: 'solo' | 'two_man' | 'mixed';
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const searchParams = request.nextUrl.searchParams;
    
    const monthParam = searchParams.get('month'); // YYYY-MM format
    const teamMemberId = searchParams.get('team_member_id');
    const startDateParam = searchParams.get('start_date');
    const endDateParam = searchParams.get('end_date');
    
    // Determine date range
    let startDate: Date;
    let endDate: Date;
    
    if (startDateParam && endDateParam) {
      startDate = parseISO(startDateParam);
      endDate = parseISO(endDateParam);
    } else if (monthParam) {
      const monthDate = parseISO(`${monthParam}-01`);
      startDate = startOfMonth(monthDate);
      endDate = endOfMonth(monthDate);
    } else {
      // Default to current month
      const now = new Date();
      startDate = startOfMonth(now);
      endDate = endOfMonth(now);
    }
    
    const startISO = format(startDate, 'yyyy-MM-dd');
    const endISO = format(endDate, 'yyyy-MM-dd');

    // Get all active team members with tech info
    let teamQuery = supabase
      .from('team_members')
      .select('id, name, email, role, hourly_rate, tech_type, active')
      .eq('active', true)
      .in('tech_type', ['service', 'pump_lead', 'mixed', 'driller', 'helper']);

    if (teamMemberId) {
      teamQuery = teamQuery.eq('id', teamMemberId);
    }

    const { data: teamMembers, error: teamError } = await teamQuery as unknown as { data: TeamMember[] | null; error: any };

    if (teamError) {
      console.error('Error fetching team members:', teamError);
      return NextResponse.json({ error: 'Failed to fetch team members' }, { status: 500 });
    }

    // Get completed jobs in date range with crew info and invoice totals
    const { data: jobs, error: jobsError } = await supabase
      .from('jobs')
      .select(`
        id,
        job_type,
        status,
        scheduled_date,
        completed_at,
        crew_lead_id,
        crew_helper_id,
        crew_type,
        assigned_to
      `)
      .gte('scheduled_date', startISO)
      .lte('scheduled_date', endISO)
      .in('status', ['completed', 'invoiced']) as unknown as { data: JobRow[] | null; error: any };

    if (jobsError) {
      console.error('Error fetching jobs:', jobsError);
      return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
    }

    // Get job IDs for invoice lookup
    const jobIds = (jobs as JobRow[])?.map(j => j.id) || [];

    // Get invoices for these jobs
    const { data: invoices, error: invoicesError } = await supabase
      .from('invoices')
      .select(`
        id,
        job_id,
        total,
        status
      `)
      .in('job_id', jobIds.length > 0 ? jobIds : ['00000000-0000-0000-0000-000000000000']) as unknown as { data: InvoiceRow[] | null; error: any };

    if (invoicesError) {
      console.error('Error fetching invoices:', invoicesError);
    }

    // Get invoice items to split parts vs labor
    const invoiceIds = (invoices as InvoiceRow[])?.map(i => i.id) || [];
    const { data: invoiceItems, error: itemsError } = await supabase
      .from('invoice_items')
      .select('invoice_id, item_type, total')
      .in('invoice_id', invoiceIds.length > 0 ? invoiceIds : ['00000000-0000-0000-0000-000000000000']) as unknown as { data: InvoiceItemRow[] | null; error: any };

    if (itemsError) {
      console.error('Error fetching invoice items:', itemsError);
    }

    // Build invoice lookup by job_id
    const invoiceByJob: Record<string, { total: number; partsRevenue: number; laborRevenue: number }> = {};
    (invoices as InvoiceRow[])?.forEach(inv => {
      if (!inv.job_id) return;
      
      const items = (invoiceItems as InvoiceItemRow[])?.filter(item => item.invoice_id === inv.id) || [];
      const partsRevenue = items
        .filter(item => item.item_type === 'part')
        .reduce((sum, item) => sum + (item.total || 0), 0);
      const laborRevenue = items
        .filter(item => item.item_type === 'labor' || item.item_type === 'service')
        .reduce((sum, item) => sum + (item.total || 0), 0);
      
      invoiceByJob[inv.job_id] = {
        total: inv.total || 0,
        partsRevenue,
        laborRevenue: laborRevenue || (inv.total || 0) - partsRevenue, // Default rest to labor
      };
    });

    // Calculate performance for each team member
    const performanceData: PerformanceData[] = [];

    const typedJobs = jobs as JobRow[] || [];
    
    for (const member of teamMembers || []) {
      // Find jobs where this member was crew lead (gets revenue credit)
      const memberJobs = typedJobs.filter(j => 
        j.crew_lead_id === member.id || 
        (j.crew_lead_id === null && j.assigned_to === member.id) // Fallback to old field
      );

      // Find jobs where this member was helper (no revenue credit, but counts for visits)
      const helperJobs = typedJobs.filter(j => j.crew_helper_id === member.id);

      // Calculate metrics
      let totalRevenue = 0;
      let totalPartsRevenue = 0;
      let totalLaborRevenue = 0;
      let soloCount = 0;
      let twoManCount = 0;

      memberJobs.forEach(job => {
        const inv = invoiceByJob[job.id];
        if (inv) {
          totalRevenue += inv.total;
          totalPartsRevenue += inv.partsRevenue;
          totalLaborRevenue += inv.laborRevenue;
        }
        
        if (job.crew_type === 'solo' || !job.crew_helper_id) {
          soloCount++;
        } else {
          twoManCount++;
        }
      });

      // Unique scheduled dates = days worked
      const workDates = new Set([
        ...memberJobs.map(j => j.scheduled_date),
        ...helperJobs.map(j => j.scheduled_date),
      ].filter(Boolean));
      const daysWorked = workDates.size;

      // Total visits (lead jobs + helper jobs)
      const visits = memberJobs.length + helperJobs.length;

      // Calculate costs
      const hourlyRate = member.hourly_rate || 25; // Default if not set
      const loadedRate = hourlyRate * LOADED_RATE_MULTIPLIER;
      
      // Estimate 8 hours per day worked
      const laborCost = daysWorked * 8 * loadedRate;
      const partsCost = totalPartsRevenue * PARTS_COST_RATIO;
      const truckCost = daysWorked * TRUCK_COST_PER_DAY;
      
      // For two-man jobs, add helper labor cost (estimate average helper rate)
      const helperDays = twoManCount > 0 ? Math.ceil(twoManCount / 2) : 0; // Rough estimate
      const helperLaborCost = helperDays * 8 * (25 * LOADED_RATE_MULTIPLIER);
      
      const totalCost = laborCost + partsCost + truckCost + helperLaborCost;
      const profit = totalRevenue - totalCost;
      const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

      // Derived metrics
      const revenuePerDay = daysWorked > 0 ? totalRevenue / daysWorked : 0;
      const visitsPerDay = daysWorked > 0 ? visits / daysWorked : 0;
      const avgTicket = memberJobs.length > 0 ? totalRevenue / memberJobs.length : 0;

      // Determine primary crew type
      let crewType: 'solo' | 'two_man' | 'mixed' = 'solo';
      if (twoManCount > soloCount) {
        crewType = 'two_man';
      } else if (twoManCount > 0) {
        crewType = 'mixed';
      }

      performanceData.push({
        teamMember: member as TeamMember,
        visits,
        uniqueJobs: memberJobs.length,
        revenue: totalRevenue,
        partsRevenue: totalPartsRevenue,
        laborRevenue: totalLaborRevenue,
        daysWorked,
        revenuePerDay,
        visitsPerDay,
        avgTicket,
        laborCost,
        partsCost,
        truckCost,
        totalCost,
        profit,
        margin,
        crewType,
      });
    }

    // Sort by revenue descending
    performanceData.sort((a, b) => b.revenue - a.revenue);

    // Calculate summary stats
    const totalRevenue = performanceData.reduce((sum, p) => sum + p.revenue, 0);
    const totalVisits = performanceData.reduce((sum, p) => sum + p.visits, 0);
    const totalProfit = performanceData.reduce((sum, p) => sum + p.profit, 0);
    const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const avgTicket = totalVisits > 0 ? totalRevenue / totalVisits : 0;

    // Crew type breakdown
    const soloJobs = typedJobs.filter(j => j.crew_type === 'solo' || !j.crew_helper_id).length;
    const twoManJobs = typedJobs.filter(j => j.crew_type === 'two_man' || j.crew_helper_id).length;

    return NextResponse.json({
      summary: {
        totalRevenue,
        totalVisits,
        totalProfit,
        avgMargin,
        avgTicket,
        techCount: performanceData.length,
        soloJobs,
        twoManJobs,
      },
      performance: performanceData,
      dateRange: {
        start: startISO,
        end: endISO,
      },
    });
  } catch (error) {
    console.error('Team performance error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
