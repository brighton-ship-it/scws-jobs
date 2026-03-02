import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET - Dashboard stats with accurate counts (no pagination limits)
export async function GET() {
  try {
    const supabase = createServiceClient();

    // Run all queries in parallel
    const [
      // Requests
      pendingRequestsRes,
      confirmedRequestsRes,
      // Quotes by status with totals
      acceptedQuotesRes,
      draftQuotesRes,
      declinedQuotesRes,
      // Jobs by status
      completedJobsRes,
      activeJobsRes,
      urgentJobsRes,
      // Invoices by status with amounts
      sentInvoicesRes,
      draftInvoicesRes,
    ] = await Promise.all([
      // Requests - get pending with created_at for overdue calculation
      supabase.from('booking_requests').select('id, created_at').eq('status', 'pending'),
      supabase.from('booking_requests').select('id', { count: 'exact', head: true }).eq('status', 'confirmed'),
      
      // Quotes - need totals
      supabase.from('quotes').select('total').eq('status', 'accepted'),
      supabase.from('quotes').select('total').eq('status', 'draft'),
      supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('status', 'declined'),
      
      // Jobs
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).in('status', ['scheduled', 'in_progress']),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).in('priority', ['urgent', 'high']),
      
      // Invoices - need amounts and due_date
      supabase.from('invoices').select('total, amount_paid, due_date').eq('status', 'sent'),
      supabase.from('invoices').select('total').eq('status', 'draft'),
    ]);

    // Calculate request stats
    const pendingRequests = pendingRequestsRes.data || [];
    const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;
    const overdueRequests = pendingRequests.filter(r => 
      r.created_at && new Date(r.created_at).getTime() < fortyEightHoursAgo
    );

    // Calculate quote totals
    const acceptedQuotesData = acceptedQuotesRes.data || [];
    const draftQuotesData = draftQuotesRes.data || [];

    const quotesApprovedCount = acceptedQuotesData.length;
    const quotesApprovedAmount = acceptedQuotesData.reduce((sum, q) => sum + (Number(q.total) || 0), 0);
    const quotesDraftCount = draftQuotesData.length;
    const quotesDraftAmount = draftQuotesData.reduce((sum, q) => sum + (Number(q.total) || 0), 0);

    // Calculate invoice amounts
    const sentInvoicesData = sentInvoicesRes.data || [];
    const draftInvoicesData = draftInvoicesRes.data || [];
    const now = new Date();
    const overdueInvoicesData = sentInvoicesData.filter(inv => {
      if (!inv.due_date) return false;
      return new Date(inv.due_date) < now;
    });

    const invoicesAwaitingPaymentCount = sentInvoicesData.length;
    const invoicesAwaitingPaymentAmount = sentInvoicesData.reduce(
      (sum, inv) => sum + ((Number(inv.total) || 0) - (Number(inv.amount_paid) || 0)), 0
    );
    const invoicesDraftCount = draftInvoicesData.length;
    const invoicesDraftAmount = draftInvoicesData.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);
    const invoicesPastDueCount = overdueInvoicesData.length;
    const invoicesPastDueAmount = overdueInvoicesData.reduce(
      (sum, inv) => sum + ((Number(inv.total) || 0) - (Number(inv.amount_paid) || 0)), 0
    );

    return NextResponse.json({
      requests: {
        new: pendingRequests.length,
        assessmentsComplete: confirmedRequestsRes.count || 0,
        overdue: overdueRequests.length,
      },
      quotes: {
        approved: quotesApprovedCount,
        approvedAmount: quotesApprovedAmount,
        draft: quotesDraftCount,
        draftAmount: quotesDraftAmount,
        changesRequested: declinedQuotesRes.count || 0,
      },
      jobs: {
        requiresInvoicing: completedJobsRes.count || 0,
        active: activeJobsRes.count || 0,
        actionRequired: urgentJobsRes.count || 0,
      },
      invoices: {
        awaitingPayment: invoicesAwaitingPaymentCount,
        awaitingPaymentAmount: invoicesAwaitingPaymentAmount,
        draft: invoicesDraftCount,
        draftAmount: invoicesDraftAmount,
        pastDue: invoicesPastDueCount,
        pastDueAmount: invoicesPastDueAmount,
      },
    });
  } catch (error) {
    console.error('Dashboard stats API error:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard stats' }, { status: 500 });
  }
}
