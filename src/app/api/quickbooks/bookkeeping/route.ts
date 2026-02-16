import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getQuickBooksClient, getQuickBooksClientAdmin, withQBORetry } from '@/lib/quickbooks/service';
import { QuickBooksClient } from '@/lib/quickbooks/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds for retries

// Helper to execute QBO operation with automatic retry on 401
async function executeWithRetry<T>(
  isAdmin: boolean,
  operation: (client: QuickBooksClient) => Promise<T>
): Promise<T> {
  if (isAdmin) {
    // Use the retry wrapper for admin requests
    return withQBORetry(operation, 2);
  } else {
    // For regular users, single attempt
    const result = await getQuickBooksClient();
    if (!result) throw new Error('QuickBooks not connected');
    return operation(result.client);
  }
}

// Bookkeeping API - query QuickBooks data
export async function GET(request: NextRequest) {
  try {
    // Check for admin API key first
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
    const isAdmin = apiKey === process.env.ADMIN_API_KEY;

    if (!isAdmin) {
      // Regular user access - verify auth using session-aware client
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
    }

    const action = request.nextUrl.searchParams.get('action') || 'info';

    switch (action) {
      case 'info': {
        const data = await executeWithRetry(isAdmin, async (client) => {
          const info = await client.getCompanyInfo();
          // Get connection info separately
          const result = await getQuickBooksClientAdmin(false);
          return { info, connection: result?.connection };
        });
        return NextResponse.json({ 
          company: data.info,
          environment: data.connection?.environment,
          connectedAt: data.connection?.connected_at
        });
      }

      case 'accounts': {
        const accounts = await executeWithRetry(isAdmin, async (client) => {
          return client.query("SELECT * FROM Account WHERE Active = true MAXRESULTS 100");
        });
        return NextResponse.json({ accounts: accounts.QueryResponse?.Account || [] });
      }

      case 'bank_accounts': {
        const accounts = await executeWithRetry(isAdmin, async (client) => {
          return client.query("SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true");
        });
        return NextResponse.json({ accounts: accounts.QueryResponse?.Account || [] });
      }

      case 'recent_transactions': {
        const startDate = request.nextUrl.searchParams.get('start') || getDateNDaysAgo(30);
        const data = await executeWithRetry(isAdmin, async (client) => {
          const txns = await client.query(`SELECT * FROM Purchase WHERE TxnDate >= '${startDate}' ORDERBY TxnDate DESC MAXRESULTS 50`);
          const deposits = await client.query(`SELECT * FROM Deposit WHERE TxnDate >= '${startDate}' ORDERBY TxnDate DESC MAXRESULTS 50`);
          return { txns, deposits };
        });
        return NextResponse.json({ 
          purchases: data.txns.QueryResponse?.Purchase || [],
          deposits: data.deposits.QueryResponse?.Deposit || []
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
        const invoices = await executeWithRetry(isAdmin, (client) => client.query(query));
        return NextResponse.json({ invoices: invoices.QueryResponse?.Invoice || [] });
      }

      case 'bills': {
        const status = request.nextUrl.searchParams.get('status') || 'all';
        let query = "SELECT * FROM Bill";
        if (status === 'unpaid') {
          query += " WHERE Balance > '0'";
        }
        query += " ORDERBY TxnDate DESC MAXRESULTS 50";
        const bills = await executeWithRetry(isAdmin, (client) => client.query(query));
        return NextResponse.json({ bills: bills.QueryResponse?.Bill || [] });
      }

      case 'profit_loss': {
        const startParam = request.nextUrl.searchParams.get('start');
        const endParam = request.nextUrl.searchParams.get('end');
        const startDate = startParam || getStartOfYear();
        const endDate = endParam || getToday();
        
        console.log(`P&L Request - startParam: "${startParam}", startDate: "${startDate}", endDate: "${endDate}"`);
        console.log(`Param provided: ${startParam !== null}, Using default: ${startParam === null}`);
        
        const report = await executeWithRetry(isAdmin, (client) => {
          console.log(`Calling QBO report with start_date=${startDate}, end_date=${endDate}`);
          return client.getReport('ProfitAndLoss', { start_date: startDate, end_date: endDate });
        });
        return NextResponse.json({ report, debug: { startParam, startDate, endDate } });
      }

      case 'balance_sheet': {
        const asOf = request.nextUrl.searchParams.get('date') || getToday();
        const report = await executeWithRetry(isAdmin, (client) => 
          client.getReport('BalanceSheet', { date: asOf })
        );
        return NextResponse.json({ report });
      }

      case 'reconcile': {
        const accountId = request.nextUrl.searchParams.get('accountId');
        if (!accountId) {
          return NextResponse.json({ error: 'accountId required' }, { status: 400 });
        }
        // Get recent uncleared transactions for the account
        const data = await executeWithRetry(isAdmin, async (client) => {
          const purchases = await client.query(`SELECT * FROM Purchase WHERE AccountRef = '${accountId}' ORDERBY TxnDate DESC MAXRESULTS 100`);
          const deposits = await client.query(`SELECT * FROM Deposit WHERE DepositToAccountRef = '${accountId}' ORDERBY TxnDate DESC MAXRESULTS 100`);
          return { purchases, deposits };
        });
        return NextResponse.json({
          purchases: data.purchases.QueryResponse?.Purchase || [],
          deposits: data.deposits.QueryResponse?.Deposit || []
        });
      }

      case 'purchase': {
        // Get single purchase by ID (not cached like queries)
        const purchaseId = request.nextUrl.searchParams.get('id');
        if (!purchaseId) {
          return NextResponse.json({ error: 'id required' }, { status: 400 });
        }
        const purchaseResult = await executeWithRetry(isAdmin, (client) => client.getPurchase(purchaseId));
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
        const report = await executeWithRetry(isAdmin, (client) => 
          client.getReport('GeneralLedger', {
            start_date: startDate,
            end_date: endDate,
            account: acctId,
          })
        );
        
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

// POST handler for updates
export async function POST(request: NextRequest) {
  try {
    // Check for admin API key first
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
    const isAdmin = apiKey === process.env.ADMIN_API_KEY;

    if (!isAdmin) {
      // Regular user access - verify auth using session-aware client
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
    }

    const body = await request.json();
    const action = body.action;

    switch (action) {
      case 'update_purchase': {
        const { purchaseId, accountId, accountName } = body;
        if (!purchaseId || !accountId) {
          return NextResponse.json({ error: 'purchaseId and accountId required' }, { status: 400 });
        }

        const result = await executeWithRetry(isAdmin, async (client) => {
          // First get the current purchase
          const purchaseResult = await client.getPurchase(purchaseId);
          const purchase = purchaseResult.Purchase;
          
          if (!purchase) {
            throw new Error('Purchase not found');
          }

          // Update the account reference in the line items
          if (purchase.Line && purchase.Line.length > 0) {
            for (const line of purchase.Line) {
              if (line.AccountBasedExpenseLineDetail) {
                line.AccountBasedExpenseLineDetail.AccountRef = {
                  value: accountId,
                  name: accountName || undefined
                };
              }
            }
          }

          // Update the purchase
          return client.updatePurchase(purchase);
        });

        return NextResponse.json({ success: true, purchase: result });
      }

      case 'batch_update_purchases': {
        const { updates } = body;
        if (!updates || !Array.isArray(updates)) {
          return NextResponse.json({ error: 'updates array required' }, { status: 400 });
        }

        const results = await executeWithRetry(isAdmin, async (client) => {
          const outcomes = [];
          for (const update of updates) {
            try {
              const purchaseResult = await client.getPurchase(update.purchaseId);
              const purchase = purchaseResult.Purchase;
              
              if (!purchase) {
                outcomes.push({ purchaseId: update.purchaseId, success: false, error: 'Not found' });
                continue;
              }

              // Update account in line items
              if (purchase.Line) {
                for (const line of purchase.Line) {
                  if (line.AccountBasedExpenseLineDetail) {
                    line.AccountBasedExpenseLineDetail.AccountRef = {
                      value: update.accountId,
                      name: update.accountName || undefined
                    };
                  }
                }
              }

              const updated = await client.updatePurchase(purchase);
              outcomes.push({ purchaseId: update.purchaseId, success: true, newAccount: update.accountId });
            } catch (err) {
              outcomes.push({ 
                purchaseId: update.purchaseId, 
                success: false, 
                error: err instanceof Error ? err.message : 'Unknown error' 
              });
            }
          }
          return outcomes;
        });

        return NextResponse.json({ success: true, results });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('Bookkeeping POST error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update';
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
