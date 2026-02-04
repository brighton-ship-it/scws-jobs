import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getQuickBooksClient, getQuickBooksClientAdmin, withQBORetry } from '@/lib/quickbooks/service';
import { QuickBooksClient } from '@/lib/quickbooks/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Allow up to 30 seconds for retries

// Bookkeeping API - query QuickBooks data
export async function GET(request: NextRequest) {
  try {
    // Check for admin API key first
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
    const isAdmin = apiKey === process.env.ADMIN_API_KEY;

    // For admin access, always force token refresh for reliability
    const forceRefresh = isAdmin && request.nextUrl.searchParams.get('fresh') !== 'false';
    
    let result;
    
    if (isAdmin) {
      // Admin access - use service-level auth with fresh token
      result = await getQuickBooksClientAdmin(forceRefresh);
    } else {
      // Regular user access
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      result = await getQuickBooksClient();
    }

    if (!result) {
      return NextResponse.json({ error: 'QuickBooks not connected' }, { status: 400 });
    }

    const { client, connection } = result;
    const action = request.nextUrl.searchParams.get('action') || 'info';

    switch (action) {
      case 'info': {
        const info = await client.getCompanyInfo();
        return NextResponse.json({ 
          company: info,
          environment: connection.environment,
          connectedAt: connection.connected_at
        });
      }

      case 'accounts': {
        const accounts = await client.query("SELECT * FROM Account WHERE Active = true MAXRESULTS 100");
        return NextResponse.json({ accounts: accounts.QueryResponse?.Account || [] });
      }

      case 'bank_accounts': {
        const accounts = await client.query("SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true");
        return NextResponse.json({ accounts: accounts.QueryResponse?.Account || [] });
      }

      case 'recent_transactions': {
        const startDate = request.nextUrl.searchParams.get('start') || getDateNDaysAgo(30);
        const txns = await client.query(`SELECT * FROM Purchase WHERE TxnDate >= '${startDate}' ORDERBY TxnDate DESC MAXRESULTS 50`);
        const deposits = await client.query(`SELECT * FROM Deposit WHERE TxnDate >= '${startDate}' ORDERBY TxnDate DESC MAXRESULTS 50`);
        return NextResponse.json({ 
          purchases: txns.QueryResponse?.Purchase || [],
          deposits: deposits.QueryResponse?.Deposit || []
        });
      }

      case 'invoices': {
        const status = request.nextUrl.searchParams.get('status') || 'all';
        let query = "SELECT * FROM Invoice";
        if (status === 'unpaid') {
          query += " WHERE Balance > '0'";
        } else if (status === 'paid') {
          query += " WHERE Balance = '0'";
        }
        query += " ORDERBY TxnDate DESC MAXRESULTS 50";
        const invoices = await client.query(query);
        return NextResponse.json({ invoices: invoices.QueryResponse?.Invoice || [] });
      }

      case 'bills': {
        const status = request.nextUrl.searchParams.get('status') || 'all';
        let query = "SELECT * FROM Bill";
        if (status === 'unpaid') {
          query += " WHERE Balance > '0'";
        }
        query += " ORDERBY TxnDate DESC MAXRESULTS 50";
        const bills = await client.query(query);
        return NextResponse.json({ bills: bills.QueryResponse?.Bill || [] });
      }

      case 'profit_loss': {
        const startDate = request.nextUrl.searchParams.get('start') || getStartOfYear();
        const endDate = request.nextUrl.searchParams.get('end') || getToday();
        const report = await client.getReport('ProfitAndLoss', { start_date: startDate, end_date: endDate });
        return NextResponse.json({ report });
      }

      case 'balance_sheet': {
        const asOf = request.nextUrl.searchParams.get('date') || getToday();
        const report = await client.getReport('BalanceSheet', { date: asOf });
        return NextResponse.json({ report });
      }

      case 'reconcile': {
        const accountId = request.nextUrl.searchParams.get('accountId');
        if (!accountId) {
          return NextResponse.json({ error: 'accountId required' }, { status: 400 });
        }
        // Get recent uncleared transactions for the account
        const txns = await client.query(`SELECT * FROM Purchase WHERE AccountRef = '${accountId}' ORDERBY TxnDate DESC MAXRESULTS 100`);
        const deposits = await client.query(`SELECT * FROM Deposit WHERE DepositToAccountRef = '${accountId}' ORDERBY TxnDate DESC MAXRESULTS 100`);
        return NextResponse.json({
          purchases: txns.QueryResponse?.Purchase || [],
          deposits: deposits.QueryResponse?.Deposit || []
        });
      }

      case 'purchase': {
        // Get single purchase by ID (not cached like queries)
        const purchaseId = request.nextUrl.searchParams.get('id');
        if (!purchaseId) {
          return NextResponse.json({ error: 'id required' }, { status: 400 });
        }
        const purchaseResult = await client.getPurchase(purchaseId);
        return NextResponse.json(purchaseResult);
      }

      case 'transactions_by_account': {
        const acctId = request.nextUrl.searchParams.get('account_id');
        const startDate = request.nextUrl.searchParams.get('start') || '2020-01-01';
        const endDate = request.nextUrl.searchParams.get('end') || getToday();
        
        if (!acctId) {
          return NextResponse.json({ error: 'account_id required' }, { status: 400 });
        }

        // Use GeneralLedger report to get all transactions for an account
        const report = await client.getReport('GeneralLedger', {
          start_date: startDate,
          end_date: endDate,
          account: acctId,
        });
        
        // Parse the report rows into transactions
        const transactions: Array<{date: string, type: string, num: string, name: string, memo: string, amount: number, balance: number}> = [];
        
        const rows = report?.Rows?.Row || [];
        for (const section of rows) {
          if (section.Rows?.Row) {
            for (const row of section.Rows.Row) {
              if (row.type === 'Data' && row.ColData) {
                const cols = row.ColData;
                transactions.push({
                  date: cols[0]?.value || '',
                  type: cols[1]?.value || '',
                  num: cols[2]?.value || '',
                  name: cols[3]?.value || '',
                  memo: cols[4]?.value || '',
                  amount: parseFloat(cols[5]?.value || '0'),
                  balance: parseFloat(cols[6]?.value || '0'),
                });
              }
            }
          }
        }
        
        return NextResponse.json({ 
          account_id: acctId,
          start: startDate,
          end: endDate,
          transactions,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('Bookkeeping API error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch data';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function getStartOfYear(): string {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}
