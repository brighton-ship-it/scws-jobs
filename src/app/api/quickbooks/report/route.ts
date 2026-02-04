import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getQuickBooksClient } from '@/lib/quickbooks/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const result = await getQuickBooksClient();
    if (!result) {
      return NextResponse.json({ error: 'QuickBooks not connected' }, { status: 400 });
    }

    const { client, connection } = result;
    const format = request.nextUrl.searchParams.get('format') || 'html';

    // Get company info
    const companyInfo = await client.getCompanyInfo();

    // Get 2025 P&L
    const pl2025 = await client.getReport('ProfitAndLoss', { 
      start_date: '2025-01-01', 
      end_date: '2025-12-31' 
    });

    // Get last 3 months P&L
    const pl3mo = await client.getReport('ProfitAndLoss', { 
      start_date: '2025-11-01', 
      end_date: '2026-01-31' 
    });

    // Extract payment fees from P&L
    function extractFees(report: any): { jobberFees: number; qbFees: number; bankFees: number; totalFees: number } {
      let jobberFees = 0, qbFees = 0, bankFees = 0;
      
      function searchRows(rows: any[]) {
        if (!rows) return;
        for (const row of rows) {
          if (row.ColData) {
            const name = row.ColData[0]?.value?.toLowerCase() || '';
            const value = parseFloat(row.ColData[1]?.value) || 0;
            if (name.includes('jobber') && name.includes('fee')) jobberFees = value;
            if (name.includes('quickbooks') && name.includes('fee')) qbFees = value;
            if (name.includes('bank') && name.includes('charge')) bankFees = value;
          }
          if (row.Rows?.Row) searchRows(row.Rows.Row);
          if (row.Summary?.ColData) {
            const name = row.Summary.ColData[0]?.value?.toLowerCase() || '';
            const value = parseFloat(row.Summary.ColData[1]?.value) || 0;
            if (name.includes('jobber') && name.includes('fee')) jobberFees = value;
          }
        }
      }
      
      searchRows(report?.Rows?.Row || []);
      return { jobberFees, qbFees, bankFees, totalFees: jobberFees + qbFees + bankFees };
    }

    const fees2025 = extractFees(pl2025);
    const fees3mo = extractFees(pl3mo);

    // Estimate volume from fees (assuming 2.9% rate)
    const feeRate = 0.029;
    const volume2025 = fees2025.jobberFees / feeRate;
    const volume3mo = fees3mo.jobberFees / feeRate;
    const monthlyAvg = volume2025 / 12;

    const reportDate = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', month: 'long', day: 'numeric' 
    });

    if (format === 'json') {
      return NextResponse.json({
        company: companyInfo.CompanyName,
        reportDate,
        annual2025: {
          ccVolume: volume2025,
          fees: fees2025,
          monthlyAverage: monthlyAvg,
        },
        last3Months: {
          period: 'Nov 2025 - Jan 2026',
          ccVolume: volume3mo,
          fees: fees3mo,
          monthlyAverage: volume3mo / 3,
        },
        currentRate: '2.9%',
        potentialSavings: {
          at2percent: fees2025.totalFees - (volume2025 * 0.02),
          at1_5percent: fees2025.totalFees - (volume2025 * 0.015),
        }
      });
    }

    // Generate HTML report
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Credit Card Processing Report - ${companyInfo.CompanyName}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
    h1 { color: #1f3b4d; border-bottom: 3px solid #4e9271; padding-bottom: 10px; }
    h2 { color: #1f3b4d; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #1f3b4d; color: white; }
    tr:nth-child(even) { background: #f9f9f9; }
    .highlight { background: #e8f5e9 !important; font-weight: bold; }
    .amount { text-align: right; font-family: monospace; }
    .header { display: flex; justify-content: space-between; align-items: center; }
    .logo { font-size: 24px; font-weight: bold; color: #1f3b4d; }
    .date { color: #666; }
    .savings { background: #4e9271; color: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .savings h3 { margin-top: 0; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">${companyInfo.CompanyName}</div>
    <div class="date">Report Generated: ${reportDate}</div>
  </div>
  
  <h1>Credit Card Processing Volume Report</h1>
  
  <h2>2025 Annual Summary</h2>
  <table>
    <tr><th>Metric</th><th class="amount">Amount</th></tr>
    <tr><td>Estimated CC Processing Volume</td><td class="amount">$${volume2025.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>
    <tr><td>Monthly Average</td><td class="amount">$${monthlyAvg.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>
    <tr><td>Jobber Payment Fees Paid</td><td class="amount">$${fees2025.jobberFees.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>
    <tr><td>Bank Charges & Fees</td><td class="amount">$${fees2025.bankFees.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>
    <tr class="highlight"><td>Current Effective Rate</td><td class="amount">2.9%</td></tr>
  </table>

  <h2>Last 3 Months (Nov 2025 - Jan 2026)</h2>
  <table>
    <tr><th>Metric</th><th class="amount">Amount</th></tr>
    <tr><td>Estimated CC Processing Volume</td><td class="amount">$${volume3mo.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>
    <tr><td>Monthly Average</td><td class="amount">$${(volume3mo / 3).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>
    <tr><td>Fees Paid</td><td class="amount">$${fees3mo.jobberFees.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>
  </table>

  <div class="savings">
    <h3>💰 Potential Annual Savings</h3>
    <p>At 2.0% rate: <strong>$${(fees2025.totalFees - (volume2025 * 0.02)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong> saved per year</p>
    <p>At 1.5% rate: <strong>$${(fees2025.totalFees - (volume2025 * 0.015)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong> saved per year</p>
  </div>

  <h2>Business Information</h2>
  <table>
    <tr><td>Company</td><td>${companyInfo.CompanyName}</td></tr>
    <tr><td>Address</td><td>${companyInfo.CompanyAddr?.Line1 || ''}, ${companyInfo.CompanyAddr?.City || ''}, ${companyInfo.CompanyAddr?.CountrySubDivisionCode || ''} ${companyInfo.CompanyAddr?.PostalCode || ''}</td></tr>
  </table>

  <p style="margin-top: 40px; color: #666; font-size: 12px;">
    * CC volume estimated from merchant fees at 2.9% processing rate<br>
    * Data sourced from QuickBooks Online (${connection.environment})
  </p>
</body>
</html>`;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': 'inline; filename="cc-processing-report.html"'
      }
    });

  } catch (error) {
    console.error('Report generation error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
