import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, parseISO, format } from 'date-fns';

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
      // Default to last 30 days if no dates provided
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

    // Get all invoices in the date range
    const { data: invoices, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, total, amount_paid, status, issue_date, paid_at')
      .gte('issue_date', startISO.split('T')[0])
      .lte('issue_date', endISO.split('T')[0]);

    if (invoiceError) {
      console.error('Error fetching invoices:', invoiceError);
      return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
    }

    // Calculate metrics
    const totalInvoiced = invoices?.reduce((sum, inv) => sum + (inv.total || 0), 0) || 0;
    const totalPaid = invoices?.reduce((sum, inv) => sum + (inv.amount_paid || 0), 0) || 0;
    const outstandingBalance = totalInvoiced - totalPaid;
    
    const paidInvoices = invoices?.filter(inv => inv.status === 'paid') || [];
    const overdueInvoices = invoices?.filter(inv => inv.status === 'overdue') || [];
    const pendingInvoices = invoices?.filter(inv => inv.status === 'sent' || inv.status === 'viewed') || [];

    // Get payments within date range for trend data
    const { data: payments, error: paymentError } = await supabase
      .from('payments')
      .select('amount, payment_date')
      .gte('payment_date', startISO.split('T')[0])
      .lte('payment_date', endISO.split('T')[0])
      .order('payment_date', { ascending: true });

    if (paymentError) {
      console.error('Error fetching payments:', paymentError);
    }

    // Group payments by date for trend chart
    const revenueByDate: Record<string, number> = {};
    payments?.forEach(payment => {
      const date = payment.payment_date;
      revenueByDate[date] = (revenueByDate[date] || 0) + payment.amount;
    });

    const revenueTrend = Object.entries(revenueByDate)
      .map(([date, amount]) => ({
        date,
        amount,
        label: format(parseISO(date), 'MMM d'),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calculate previous period for comparison
    const periodDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const prevStart = subDays(start, periodDays);
    const prevEnd = subDays(end, periodDays);

    const { data: prevInvoices } = await supabase
      .from('invoices')
      .select('total, amount_paid')
      .gte('issue_date', prevStart.toISOString().split('T')[0])
      .lte('issue_date', prevEnd.toISOString().split('T')[0]);

    const prevTotalPaid = prevInvoices?.reduce((sum, inv) => sum + (inv.amount_paid || 0), 0) || 0;
    const revenueChange = prevTotalPaid > 0 
      ? Math.round(((totalPaid - prevTotalPaid) / prevTotalPaid) * 100) 
      : 0;

    return NextResponse.json({
      summary: {
        totalInvoiced,
        totalPaid,
        outstandingBalance,
        invoiceCount: invoices?.length || 0,
        paidCount: paidInvoices.length,
        overdueCount: overdueInvoices.length,
        pendingCount: pendingInvoices.length,
        revenueChange,
      },
      trend: revenueTrend,
      dateRange: {
        start: startISO,
        end: endISO,
        range,
      },
    });
  } catch (error) {
    console.error('Revenue report error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
