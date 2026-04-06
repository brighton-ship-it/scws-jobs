import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { startOfMonth, endOfMonth, format, subMonths, parseISO } from 'date-fns';

// Constants for margin calculations
const LOADED_RATE_MULTIPLIER = 1.3;
const TRUCK_COST_PER_DAY = 80;
const PARTS_COST_RATIO = 0.5;

// Type definitions for DB rows (until migration is applied)
interface JobRow {
  id: string;
  job_type: string;
  scheduled_date: string | null;
  crew_lead_id: string | null;
  crew_helper_id: string | null;
  crew_type: string | null;
  assigned_to: string | null;
}

interface InvoiceRow {
  id: string;
  job_id: string | null;
  total: number | null;
}

interface InvoiceItemRow {
  invoice_id: string;
  item_type: string | null;
  total: number | null;
}

interface TeamMemberRow {
  id: string;
  name: string;
  hourly_rate: number | null;
  tech_type: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await request.json().catch(() => ({}));
    
    // Default to last 12 months if no month specified
    const monthsToRecalc = body.months || 12;
    const specificMonth = body.month; // YYYY-MM format
    
    let months: Date[] = [];
    
    if (specificMonth) {
      months = [parseISO(`${specificMonth}-01`)];
    } else {
      // Generate last N months
      const now = new Date();
      for (let i = 0; i < monthsToRecalc; i++) {
        months.push(subMonths(now, i));
      }
    }

    // Get all active field team members
    const { data: teamMembers, error: teamError } = await supabase
      .from('team_members')
      .select('id, name, hourly_rate, tech_type')
      .eq('active', true)
      .in('tech_type', ['service', 'pump_lead', 'mixed', 'driller', 'helper']) as unknown as { data: TeamMemberRow[] | null; error: any };

    if (teamError) {
      console.error('Error fetching team members:', teamError);
      return NextResponse.json({ error: 'Failed to fetch team members' }, { status: 500 });
    }

    const results: { month: string; updated: number; errors: string[] }[] = [];

    for (const monthDate of months) {
      const monthKey = format(monthDate, 'yyyy-MM');
      const monthStart = format(startOfMonth(monthDate), 'yyyy-MM-dd');
      const monthEnd = format(endOfMonth(monthDate), 'yyyy-MM-dd');
      const monthFirst = format(startOfMonth(monthDate), 'yyyy-MM-dd');
      
      let updated = 0;
      const errors: string[] = [];

      // Get all completed jobs for this month
      const { data: jobs, error: jobsError } = await supabase
        .from('jobs')
        .select(`
          id,
          job_type,
          scheduled_date,
          crew_lead_id,
          crew_helper_id,
          crew_type,
          assigned_to
        `)
        .gte('scheduled_date', monthStart)
        .lte('scheduled_date', monthEnd)
        .in('status', ['completed', 'invoiced']) as unknown as { data: JobRow[] | null; error: any };

      if (jobsError) {
        errors.push(`Failed to fetch jobs: ${jobsError.message}`);
        results.push({ month: monthKey, updated: 0, errors });
        continue;
      }

      // Get invoices for these jobs
      const typedJobs = (jobs || []) as JobRow[];
      const jobIds = typedJobs.map(j => j.id);
      const { data: invoicesData } = await supabase
        .from('invoices')
        .select('id, job_id, total')
        .in('job_id', jobIds.length > 0 ? jobIds : ['00000000-0000-0000-0000-000000000000']);
      const invoices = (invoicesData || []) as InvoiceRow[];

      // Get invoice items
      const invoiceIds = invoices.map(i => i.id);
      const { data: invoiceItemsData } = await supabase
        .from('invoice_items')
        .select('invoice_id, item_type, total')
        .in('invoice_id', invoiceIds.length > 0 ? invoiceIds : ['00000000-0000-0000-0000-000000000000']);
      const invoiceItems = (invoiceItemsData || []) as InvoiceItemRow[];

      // Build invoice lookup
      const invoiceByJob: Record<string, { total: number; partsRevenue: number; laborRevenue: number }> = {};
      invoices.forEach(inv => {
        if (!inv.job_id) return;
        const items = invoiceItems.filter(item => item.invoice_id === inv.id);
        const partsRevenue = items
          .filter(item => item.item_type === 'part')
          .reduce((sum, item) => sum + (item.total || 0), 0);
        const laborRevenue = items
          .filter(item => item.item_type === 'labor' || item.item_type === 'service')
          .reduce((sum, item) => sum + (item.total || 0), 0);
        
        invoiceByJob[inv.job_id] = {
          total: inv.total || 0,
          partsRevenue,
          laborRevenue: laborRevenue || (inv.total || 0) - partsRevenue,
        };
      });

      // Calculate and upsert performance for each team member
      const typedTeamMembers = (teamMembers || []) as TeamMemberRow[];
      for (const member of typedTeamMembers) {
        const memberJobs = typedJobs.filter(j => 
          j.crew_lead_id === member.id || 
          (j.crew_lead_id === null && j.assigned_to === member.id)
        );

        const helperJobs = typedJobs.filter(j => j.crew_helper_id === member.id);

        let revenue = 0;
        let partsRevenue = 0;
        let laborRevenue = 0;

        memberJobs.forEach(job => {
          const inv = invoiceByJob[job.id];
          if (inv) {
            revenue += inv.total;
            partsRevenue += inv.partsRevenue;
            laborRevenue += inv.laborRevenue;
          }
        });

        const workDates = new Set([
          ...memberJobs.map(j => j.scheduled_date),
          ...helperJobs.map(j => j.scheduled_date),
        ].filter(Boolean));
        const daysWorked = workDates.size;
        const visits = memberJobs.length + helperJobs.length;

        // Skip if no activity
        if (visits === 0 && revenue === 0) continue;

        // Upsert performance record
        const performanceRecord = {
            team_member_id: member.id,
            month: monthFirst,
            visits,
            unique_jobs: memberJobs.length,
            revenue,
            parts_revenue: partsRevenue,
            labor_revenue: laborRevenue,
            days_worked: daysWorked,
            sourced_followups: 0, // TODO: Calculate from diagnostic chains
            sourced_revenue: 0,
            updated_at: new Date().toISOString(),
          };
        const { error: upsertError } = await supabase
          .from('tech_performance_monthly')
          .upsert(performanceRecord as any, {
            onConflict: 'team_member_id,month',
          });

        if (upsertError) {
          errors.push(`Failed to upsert ${member.name}: ${upsertError.message}`);
        } else {
          updated++;
        }
      }

      results.push({ month: monthKey, updated, errors });
    }

    return NextResponse.json({
      success: true,
      results,
      totalUpdated: results.reduce((sum, r) => sum + r.updated, 0),
    });
  } catch (error) {
    console.error('Recalc error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
