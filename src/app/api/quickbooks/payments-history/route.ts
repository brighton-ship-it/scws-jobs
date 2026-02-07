import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getQuickBooksClient } from '@/lib/quickbooks/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const result = await getQuickBooksClient();
    if (!result) {
      return NextResponse.json({ error: 'QuickBooks not connected' }, { status: 400 });
    }

    const { client } = result;
    const year = request.nextUrl.searchParams.get('year') || '2024';

    // Get P&L for the specified year to find merchant fees
    const pl = await client.getReport('ProfitAndLoss', { 
      start_date: `${year}-01-01`, 
      end_date: `${year}-12-31` 
    });

    // Get all payments for the year
    const payments = await client.query(
      `SELECT * FROM Payment WHERE TxnDate >= '${year}-01-01' AND TxnDate <= '${year}-12-31' ORDERBY TxnDate DESC MAXRESULTS 500`
    );

    // Get sales receipts (often used for CC transactions)
    const salesReceipts = await client.query(
      `SELECT * FROM SalesReceipt WHERE TxnDate >= '${year}-01-01' AND TxnDate <= '${year}-12-31' ORDERBY TxnDate DESC MAXRESULTS 500`
    );

    // Extract fee info from P&L
    function extractFees(report: any): Record<string, number> {
      const fees: Record<string, number> = {};
      
      function searchRows(rows: any[]) {
        if (!rows) return;
        for (const row of rows) {
          if (row.ColData) {
            const name = row.ColData[0]?.value || '';
            const value = parseFloat(row.ColData[1]?.value) || 0;
            if (name.toLowerCase().includes('fee') || 
                name.toLowerCase().includes('merchant') ||
                name.toLowerCase().includes('processing') ||
                name.toLowerCase().includes('quickbooks payment')) {
              fees[name] = value;
            }
          }
          if (row.Rows?.Row) searchRows(row.Rows.Row);
        }
      }
      
      searchRows(report?.Rows?.Row || []);
      return fees;
    }

    const feeItems = extractFees(pl);
    
    // Calculate totals
    const paymentList = payments?.QueryResponse?.Payment || [];
    const salesReceiptList = salesReceipts?.QueryResponse?.SalesReceipt || [];
    
    const paymentTotal = paymentList.reduce((sum: number, p: any) => sum + (parseFloat(p.TotalAmt) || 0), 0);
    const salesReceiptTotal = salesReceiptList.reduce((sum: number, sr: any) => sum + (parseFloat(sr.TotalAmt) || 0), 0);

    return NextResponse.json({
      year,
      payments: {
        count: paymentList.length,
        total: paymentTotal,
        sample: paymentList.slice(0, 10).map((p: any) => ({
          date: p.TxnDate,
          amount: p.TotalAmt,
          method: p.PaymentMethodRef?.name || 'Unknown'
        }))
      },
      salesReceipts: {
        count: salesReceiptList.length,
        total: salesReceiptTotal
      },
      merchantFees: feeItems,
      totalFees: Object.values(feeItems).reduce((a: number, b: number) => a + b, 0)
    });

  } catch (error) {
    console.error('Payment history error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch data';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
