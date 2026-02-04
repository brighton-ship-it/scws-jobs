import { NextRequest, NextResponse } from 'next/server';
import { getQuickBooksClientAdmin } from '@/lib/quickbooks/service';

export const dynamic = 'force-dynamic';

// Categorization rules
const DEPOSIT_RULES = [
  { pattern: /jobber/i, account: 'Services Revenue', memo: 'Jobber payment' },
  { pattern: /octopusapp|stax/i, account: 'Services Revenue', memo: 'Stax payment' },
  { pattern: /mobile.*deposit/i, account: 'Services Revenue', memo: 'Mobile deposit' },
  { pattern: /atm.*deposit/i, account: 'Services Revenue', memo: 'ATM deposit' },
  { pattern: /online transfer from chk/i, account: 'Owner Contribution', memo: 'Internal transfer' },
];

const EXPENSE_RULES = [
  // Fuel vendors
  { pattern: /flyers energy/i, account: 'Car & Truck:Fuel', accountId: '16', vendor: 'Flyers Energy LLC' },
  { pattern: /ccrc lodging/i, account: 'Car & Truck:Fuel', accountId: '16', vendor: 'CCRC Lodging' },
  { pattern: /shell oil|shell service/i, account: 'Car & Truck:Fuel', accountId: '16', vendor: 'Shell' },
  { pattern: /chevron/i, account: 'Car & Truck:Fuel', accountId: '16', vendor: 'Chevron' },
  { pattern: /arco/i, account: 'Car & Truck:Fuel', accountId: '16', vendor: 'Arco' },
  { pattern: /76 station/i, account: 'Car & Truck:Fuel', accountId: '16', vendor: '76' },
  
  // Job supplies
  { pattern: /ewater|e-water/i, account: 'Job Supplies', accountId: '17', vendor: 'eWater Solutions' },
  { pattern: /headwater/i, account: 'Job Supplies', accountId: '17', vendor: 'Headwater Companies' },
  { pattern: /western hydro/i, account: 'Job Supplies', accountId: '17', vendor: 'Western Hydro' },
  { pattern: /mitchell lewis/i, account: 'Job Supplies', accountId: '17', vendor: 'Mitchell Lewis' },
  { pattern: /preferred pump/i, account: 'Job Supplies', accountId: '17', vendor: 'Preferred Pump' },
  { pattern: /hole products/i, account: 'Job Supplies', accountId: '17', vendor: 'Hole Products' },
  
  // Insurance
  { pattern: /federated insurance/i, account: 'INSURANCE:Liability & Workers comp Insurance', accountId: '69', vendor: 'Federated Insurance' },
  { pattern: /blue shield/i, account: 'INSURANCE:Health Insurance', accountId: '70', vendor: 'Blue Shield' },
  
  // Utilities & communications
  { pattern: /verizon/i, account: 'Phone & Communications', vendor: 'Verizon' },
  { pattern: /sdg&?e|san diego gas/i, account: 'Utilities', vendor: 'SDG&E' },
  { pattern: /anza gas/i, account: 'Utilities', vendor: 'Anza Gas Service' },
  
  // Marketing
  { pattern: /google/i, account: 'Advertising & Marketing', vendor: 'Google' },
  { pattern: /yelp/i, account: 'Advertising & Marketing', vendor: 'Yelp Inc' },
  
  // Software
  { pattern: /twilio/i, account: 'Software & Subscriptions', vendor: 'Twilio' },
  { pattern: /anthropic/i, account: 'Software & Subscriptions', vendor: 'Anthropic' },
  
  // Other
  { pattern: /payroll|adp|gusto/i, account: 'Payroll Expenses', vendor: 'Payroll' },
  { pattern: /bank.*fee|service fee|maintenance fee/i, account: 'Bank Charges & Fees', vendor: 'Bank of America' },
  { pattern: /home depot/i, account: 'Materials & Supplies', vendor: 'Home Depot' },
  { pattern: /amazon/i, account: 'Office Supplies', vendor: 'Amazon' },
];

// POST - Apply categorization to a specific transaction
export async function POST(request: NextRequest) {
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
    const body = await request.json();
    const { purchaseId, accountId, accountName } = body;

    if (!purchaseId || !accountId) {
      return NextResponse.json({ error: 'purchaseId and accountId required' }, { status: 400 });
    }

    // Get the existing purchase
    const purchaseResult = await client.getPurchase(purchaseId);
    const purchase = purchaseResult.Purchase;

    if (!purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }

    // Update the account on each line
    for (const line of purchase.Line || []) {
      if (line.DetailType === 'AccountBasedExpenseLineDetail' && line.AccountBasedExpenseLineDetail) {
        line.AccountBasedExpenseLineDetail.AccountRef = {
          value: accountId,
          name: accountName || undefined
        };
      }
    }

    // Update the purchase
    const updated = await client.updatePurchase(purchase);

    return NextResponse.json({
      success: true,
      purchaseId,
      newAccountId: accountId,
      newAccountName: accountName,
      updated
    });

  } catch (error) {
    console.error('Categorization update error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET - Analyze and suggest categorizations
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
    const dryRun = request.nextUrl.searchParams.get('dry_run') !== 'false';
    const days = parseInt(request.nextUrl.searchParams.get('days') || '30');

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString().split('T')[0];

    // Get recent uncategorized/all transactions
    const purchases = await client.query(
      `SELECT * FROM Purchase WHERE TxnDate >= '${startStr}' ORDERBY TxnDate DESC MAXRESULTS 200`
    );
    const deposits = await client.query(
      `SELECT * FROM Deposit WHERE TxnDate >= '${startStr}' ORDERBY TxnDate DESC MAXRESULTS 100`
    );

    const purchaseList = purchases?.QueryResponse?.Purchase || [];
    const depositList = deposits?.QueryResponse?.Deposit || [];

    const suggestions: Array<{
      type: string;
      id: string;
      date: string;
      amount: number;
      description: string;
      currentAccount: string;
      suggestedAccount: string;
      rule: string;
    }> = [];

    // Analyze deposits
    for (const dep of depositList) {
      const desc = JSON.stringify(dep).toLowerCase();
      for (const rule of DEPOSIT_RULES) {
        if (rule.pattern.test(desc)) {
          suggestions.push({
            type: 'deposit',
            id: dep.Id,
            date: dep.TxnDate,
            amount: dep.TotalAmt,
            description: dep.PrivateNote || 'Deposit',
            currentAccount: dep.DepositToAccountRef?.name || 'Unknown',
            suggestedAccount: rule.account,
            rule: rule.memo,
          });
          break;
        }
      }
    }

    // Analyze expenses
    for (const purch of purchaseList) {
      const desc = (purch.EntityRef?.name || '') + ' ' + (purch.PrivateNote || '');
      for (const rule of EXPENSE_RULES) {
        if (rule.pattern.test(desc)) {
          const currentAccount = purch.AccountRef?.name || purch.Line?.[0]?.AccountBasedExpenseLineDetail?.AccountRef?.name || 'Unknown';
          if (currentAccount.toLowerCase() !== rule.account.toLowerCase()) {
            suggestions.push({
              type: 'expense',
              id: purch.Id,
              date: purch.TxnDate,
              amount: purch.TotalAmt,
              description: purch.EntityRef?.name || 'Expense',
              currentAccount,
              suggestedAccount: rule.account,
              rule: rule.vendor,
            });
          }
          break;
        }
      }
    }

    return NextResponse.json({
      dryRun,
      analyzedPurchases: purchaseList.length,
      analyzedDeposits: depositList.length,
      suggestionsCount: suggestions.length,
      suggestions: suggestions.slice(0, 50), // Limit response size
      message: dryRun 
        ? 'Dry run - no changes made. Set dry_run=false to apply.' 
        : 'Changes applied.',
    });

  } catch (error) {
    console.error('Categorization error:', error);
    const message = error instanceof Error ? error.message : 'Failed to categorize';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
