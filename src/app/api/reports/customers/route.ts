export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, parseISO } from 'date-fns';

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

    // Get new customers in date range
    const { data: newCustomers, error: newCustError } = await supabase
      .from('customers')
      .select('id, name, created_at')
      .gte('created_at', startISO)
      .lte('created_at', endISO);

    if (newCustError) {
      console.error('Error fetching new customers:', newCustError);
    }

    // Get total customer count
    const { count: totalCustomers } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true });

    // Get customers with invoices (for top customers by revenue)
    const { data: invoiceData, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        customer_id,
        total,
        amount_paid,
        status,
        customer:customers (
          id,
          name,
          email,
          phone
        )
      `)
      .gte('issue_date', startISO.split('T')[0])
      .lte('issue_date', endISO.split('T')[0]);

    if (invoiceError) {
      console.error('Error fetching invoice data:', invoiceError);
    }

    // Calculate customer revenue
    const customerRevenue: Record<string, {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      totalInvoiced: number;
      totalPaid: number;
      invoiceCount: number;
    }> = {};

    invoiceData?.forEach(inv => {
      const customer = inv.customer as any;
      if (customer) {
        if (!customerRevenue[customer.id]) {
          customerRevenue[customer.id] = {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            totalInvoiced: 0,
            totalPaid: 0,
            invoiceCount: 0,
          };
        }
        customerRevenue[customer.id].totalInvoiced += inv.total || 0;
        customerRevenue[customer.id].totalPaid += inv.amount_paid || 0;
        customerRevenue[customer.id].invoiceCount++;
      }
    });

    // Top customers by revenue
    const topCustomers = Object.values(customerRevenue)
      .sort((a, b) => b.totalPaid - a.totalPaid)
      .slice(0, 10)
      .map(c => ({
        ...c,
        outstanding: c.totalInvoiced - c.totalPaid,
      }));

    // Get job counts per customer for repeat customer detection
    const { data: jobData, error: jobError } = await supabase
      .from('jobs')
      .select(`
        property:properties (
          customer_id
        )
      `)
      .gte('scheduled_date', startISO.split('T')[0])
      .lte('scheduled_date', endISO.split('T')[0]);

    if (jobError) {
      console.error('Error fetching job data:', jobError);
    }

    // Count jobs per customer
    const jobsPerCustomer: Record<string, number> = {};
    jobData?.forEach(job => {
      const customerId = (job.property as any)?.customer_id;
      if (customerId) {
        jobsPerCustomer[customerId] = (jobsPerCustomer[customerId] || 0) + 1;
      }
    });

    // Repeat customers = more than 1 job in period
    const repeatCustomers = Object.values(jobsPerCustomer).filter(count => count > 1).length;
    const activeCustomers = Object.keys(jobsPerCustomer).length;

    // Previous period comparison for new customers
    const periodDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const prevStart = subDays(start, periodDays);
    const prevEnd = subDays(end, periodDays);

    const { data: prevNewCustomers } = await supabase
      .from('customers')
      .select('id')
      .gte('created_at', prevStart.toISOString())
      .lte('created_at', prevEnd.toISOString());

    const newCustomerCount = newCustomers?.length || 0;
    const prevNewCustomerCount = prevNewCustomers?.length || 0;
    const newCustomerChange = prevNewCustomerCount > 0
      ? Math.round(((newCustomerCount - prevNewCustomerCount) / prevNewCustomerCount) * 100)
      : 0;

    return NextResponse.json({
      summary: {
        totalCustomers: totalCustomers || 0,
        newCustomers: newCustomerCount,
        activeCustomers,
        repeatCustomers,
        repeatRate: activeCustomers > 0 ? Math.round((repeatCustomers / activeCustomers) * 100) : 0,
        newCustomerChange,
      },
      topCustomers,
      newCustomersList: newCustomers?.map(c => ({
        id: c.id,
        name: c.name,
        createdAt: c.created_at,
      })) || [],
      dateRange: {
        start: startISO,
        end: endISO,
        range,
      },
    });
  } catch (error) {
    console.error('Customer report error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
