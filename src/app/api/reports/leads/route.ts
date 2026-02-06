import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { LeadSource, LeadStage } from '@/types/database';

interface LeadSourceStats {
  lead_source: LeadSource;
  total_leads: number;
  quotes_sent: number;
  quotes_accepted: number;
  jobs_scheduled: number;
  jobs_completed: number;
  paid: number;
  total_revenue: number;
  conversion_rate: number;
}

/**
 * GET /api/reports/leads - Get lead source analytics
 * Query params:
 *   - start_date: Start of date range (ISO string)
 *   - end_date: End of date range (ISO string)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const searchParams = request.nextUrl.searchParams;
    
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    // Build base query for customers with lead sources
    let customerQuery = supabase
      .from('customers')
      .select('id, name, lead_source, lead_stage, created_at, quote_sent_at, quote_accepted_at, job_scheduled_at, job_completed_at, first_paid_at');

    if (startDate) {
      customerQuery = customerQuery.gte('created_at', startDate);
    }
    if (endDate) {
      customerQuery = customerQuery.lte('created_at', endDate);
    }

    const customerResult = await customerQuery;
    const customers = customerResult.data as Array<{
      id: string;
      name: string;
      lead_source: LeadSource | null;
      lead_stage: LeadStage | null;
      created_at: string;
      quote_sent_at: string | null;
      quote_accepted_at: string | null;
      job_scheduled_at: string | null;
      job_completed_at: string | null;
      first_paid_at: string | null;
    }> | null;

    if (customerResult.error) {
      return NextResponse.json(
        { error: 'Failed to fetch customers', details: customerResult.error.message },
        { status: 500 }
      );
    }

    // Get invoices for revenue calculation
    let invoiceQuery = supabase
      .from('invoices')
      .select('customer_id, total, status, paid_at');

    if (startDate) {
      invoiceQuery = invoiceQuery.gte('created_at', startDate);
    }
    if (endDate) {
      invoiceQuery = invoiceQuery.lte('created_at', endDate);
    }

    const invoiceResult = await invoiceQuery;
    const invoices = invoiceResult.data as Array<{
      customer_id: string;
      total: number;
      status: string;
      paid_at: string | null;
    }> | null;

    if (invoiceResult.error) {
      console.warn('Could not fetch invoices:', invoiceResult.error);
    }

    // Get lead source costs
    let costsQuery = supabase
      .from('lead_source_costs')
      .select('*');

    if (startDate) {
      costsQuery = costsQuery.gte('month', startDate.slice(0, 7) + '-01');
    }
    if (endDate) {
      costsQuery = costsQuery.lte('month', endDate.slice(0, 7) + '-01');
    }

    const costsResult = await costsQuery;
    const costs = costsResult.data as Array<{
      id: string;
      lead_source: LeadSource;
      month: string;
      cost: number;
      notes: string | null;
    }> | null;

    if (costsResult.error) {
      console.warn('Could not fetch costs:', costsResult.error);
    }

    // Calculate stats by lead source
    const leadSources: LeadSource[] = ['google_ads', 'organic_seo', 'referral', 'repeat_customer', 'phone', 'walk_in', 'website_form', 'other'];
    const stageOrder: LeadStage[] = ['lead', 'quote_sent', 'quote_accepted', 'job_scheduled', 'job_completed', 'paid'];

    const statsBySource: LeadSourceStats[] = leadSources.map(source => {
      const sourceCustomers = customers?.filter(c => c.lead_source === source) || [];
      const customerIds = sourceCustomers.map(c => c.id);
      
      // Calculate revenue from paid invoices
      const sourceInvoices = invoices?.filter(i => 
        customerIds.includes(i.customer_id) && i.status === 'paid'
      ) || [];
      const totalRevenue = sourceInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

      // Count by stage
      const stageAtLeast = (stage: LeadStage) => {
        const stageIndex = stageOrder.indexOf(stage);
        return sourceCustomers.filter(c => {
          const customerStageIndex = stageOrder.indexOf(c.lead_stage as LeadStage);
          return customerStageIndex >= stageIndex;
        }).length;
      };

      const totalLeads = sourceCustomers.length;
      const paid = sourceCustomers.filter(c => c.lead_stage === 'paid').length;

      return {
        lead_source: source,
        total_leads: totalLeads,
        quotes_sent: stageAtLeast('quote_sent'),
        quotes_accepted: stageAtLeast('quote_accepted'),
        jobs_scheduled: stageAtLeast('job_scheduled'),
        jobs_completed: stageAtLeast('job_completed'),
        paid,
        total_revenue: totalRevenue,
        conversion_rate: totalLeads > 0 ? Math.round((paid / totalLeads) * 100 * 10) / 10 : 0,
      };
    }).filter(s => s.total_leads > 0);

    // Calculate totals
    const totals = {
      total_leads: statsBySource.reduce((sum, s) => sum + s.total_leads, 0),
      quotes_sent: statsBySource.reduce((sum, s) => sum + s.quotes_sent, 0),
      quotes_accepted: statsBySource.reduce((sum, s) => sum + s.quotes_accepted, 0),
      jobs_scheduled: statsBySource.reduce((sum, s) => sum + s.jobs_scheduled, 0),
      jobs_completed: statsBySource.reduce((sum, s) => sum + s.jobs_completed, 0),
      paid: statsBySource.reduce((sum, s) => sum + s.paid, 0),
      total_revenue: statsBySource.reduce((sum, s) => sum + s.total_revenue, 0),
    };

    // Calculate costs by source
    const costsBySource: Record<string, number> = {};
    costs?.forEach(c => {
      costsBySource[c.lead_source] = (costsBySource[c.lead_source] || 0) + Number(c.cost);
    });

    // Get recent leads
    const recentLeads = customers
      ?.filter(c => c.lead_source)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20)
      .map(c => ({
        id: c.id,
        name: c.name,
        lead_source: c.lead_source,
        lead_stage: c.lead_stage,
        created_at: c.created_at,
      }));

    // Monthly trend data
    const monthlyData: Record<string, Record<LeadSource, number>> = {};
    customers?.forEach(c => {
      if (!c.lead_source) return;
      const month = c.created_at.slice(0, 7); // YYYY-MM
      if (!monthlyData[month]) {
        monthlyData[month] = {} as Record<LeadSource, number>;
      }
      monthlyData[month][c.lead_source as LeadSource] = (monthlyData[month][c.lead_source as LeadSource] || 0) + 1;
    });

    const monthlyTrend = Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, sources]) => ({
        month,
        ...sources,
        total: Object.values(sources).reduce((sum, v) => sum + v, 0),
      }));

    return NextResponse.json({
      stats_by_source: statsBySource,
      totals,
      costs_by_source: costsBySource,
      recent_leads: recentLeads,
      monthly_trend: monthlyTrend,
    });
  } catch (error) {
    console.error('Lead reports API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/reports/leads - Update lead source costs
 * Body: { lead_source, month, cost, notes? }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();

    const { lead_source, month, cost, notes } = body;

    if (!lead_source || !month || cost === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: lead_source, month, cost' },
        { status: 400 }
      );
    }

    // Upsert the cost record
    const { data, error } = await supabase
      .from('lead_source_costs')
      .upsert({
        lead_source,
        month: month.slice(0, 10), // Ensure YYYY-MM-DD format
        cost: Number(cost),
        notes: notes || null,
        updated_at: new Date().toISOString(),
      } as any, {
        onConflict: 'lead_source,month',
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving lead source cost:', error);
      return NextResponse.json(
        { error: 'Failed to save cost', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Lead costs API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
