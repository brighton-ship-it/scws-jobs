import { NextRequest, NextResponse } from 'next/server';
import { withQBORetry } from '@/lib/quickbooks/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Get date range from query params or default to current year
    const startDate = request.nextUrl.searchParams.get('start') || '2026-01-01';
    const endDate = request.nextUrl.searchParams.get('end') || new Date().toISOString().split('T')[0];

    const data = await withQBORetry(async (client) => {
      // Query all invoices in date range
      const invoiceQuery = `SELECT * FROM Invoice WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}'`;
      const invoiceResult = await client.query(invoiceQuery);
      const invoices = invoiceResult.QueryResponse?.Invoice || [];

      // Query all payments in date range
      const paymentQuery = `SELECT * FROM Payment WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}'`;
      const paymentResult = await client.query(paymentQuery);
      const payments = paymentResult.QueryResponse?.Payment || [];

      // Calculate totals
      let totalInvoiced = 0;
      let totalPaid = 0;
      let totalOpen = 0;
      let paidCount = 0;
      let openCount = 0;
      let pastDueCount = 0;
      let pastDueAmount = 0;

      const now = new Date();

      for (const inv of invoices) {
        const total = inv.TotalAmt || 0;
        const balance = inv.Balance || 0;
        totalInvoiced += total;
        
        if (balance === 0) {
          totalPaid += total;
          paidCount++;
        } else {
          totalOpen += balance;
          openCount++;
          
          // Check if past due
          if (inv.DueDate && new Date(inv.DueDate) < now) {
            pastDueCount++;
            pastDueAmount += balance;
          }
        }
      }

      // Total payments collected
      let paymentsCollected = 0;
      for (const pmt of payments) {
        paymentsCollected += pmt.TotalAmt || 0;
      }

      return {
        dateRange: { start: startDate, end: endDate },
        summary: {
          totalInvoiced: totalInvoiced.toFixed(2),
          paymentsCollected: paymentsCollected.toFixed(2),
          openBalance: totalOpen.toFixed(2),
          invoiceCount: invoices.length,
          paidInvoices: paidCount,
          openInvoices: openCount,
          pastDueInvoices: pastDueCount,
          pastDueAmount: pastDueAmount.toFixed(2),
        },
        // Top 10 open invoices for reference
        topOpenInvoices: invoices
          .filter((inv: any) => inv.Balance > 0)
          .sort((a: any, b: any) => b.Balance - a.Balance)
          .slice(0, 10)
          .map((inv: any) => ({
            id: inv.Id,
            docNumber: inv.DocNumber,
            customer: inv.CustomerRef?.name,
            date: inv.TxnDate,
            dueDate: inv.DueDate,
            total: inv.TotalAmt,
            balance: inv.Balance,
            status: inv.DueDate && new Date(inv.DueDate) < now ? 'past_due' : 'open',
          })),
      };
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('Invoice summary error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch invoices';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
