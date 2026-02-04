import { NextRequest, NextResponse } from 'next/server';
import { getQuickBooksClientAdmin } from '@/lib/quickbooks/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
    if (apiKey !== process.env.ADMIN_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await getQuickBooksClientAdmin();
    if (!result) {
      return NextResponse.json({ error: 'QuickBooks not connected' }, { status: 400 });
    }

    const { client } = result;
    const account = request.nextUrl.searchParams.get('account') || 'Job Supplies';
    const startDate = request.nextUrl.searchParams.get('start') || '2026-01-01';
    const endDate = request.nextUrl.searchParams.get('end') || '2026-12-31';

    // Get all purchases
    const purchases = await client.query(
      `SELECT * FROM Purchase WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}' ORDERBY TxnDate DESC MAXRESULTS 500`
    );

    const purchaseList = purchases?.QueryResponse?.Purchase || [];
    
    // Filter by account in line items
    const filtered: Array<{
      date: string;
      vendor: string;
      amount: number;
      memo: string;
      account: string;
    }> = [];

    for (const p of purchaseList) {
      const lines = p.Line || [];
      for (const line of lines) {
        const detail = line.AccountBasedExpenseLineDetail;
        if (detail) {
          const acctName = detail.AccountRef?.name || '';
          if (acctName.toLowerCase().includes(account.toLowerCase())) {
            filtered.push({
              date: p.TxnDate,
              vendor: p.EntityRef?.name || 'Unknown',
              amount: parseFloat(line.Amount) || 0,
              memo: line.Description || p.PrivateNote || '',
              account: acctName,
            });
          }
        }
      }
    }

    // Sort by amount descending
    filtered.sort((a, b) => b.amount - a.amount);

    const total = filtered.reduce((sum, item) => sum + item.amount, 0);

    return NextResponse.json({
      account,
      startDate,
      endDate,
      count: filtered.length,
      total,
      transactions: filtered.slice(0, 100),
    });

  } catch (error) {
    console.error('Expenses query error:', error);
    const message = error instanceof Error ? error.message : 'Failed to query';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
