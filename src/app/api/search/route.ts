import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface SearchResult {
  id: string;
  type: 'customer' | 'job' | 'invoice' | 'quote';
  title: string;
  subtitle: string;
  url: string;
  relevance: number;
}

// GET - Global search across all entities
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim().toLowerCase();
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);

    if (!query || query.length < 2) {
      return NextResponse.json({ 
        results: [], 
        message: 'Query must be at least 2 characters' 
      });
    }

    const results: SearchResult[] = [];

    // Search customers
    const { data: customers } = await supabase
      .from('customers')
      .select('id, name, email, phone')
      .or(`name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
      .limit(limit);

    if (customers) {
      customers.forEach(c => {
        const nameMatch = c.name?.toLowerCase().includes(query) ? 10 : 0;
        const emailMatch = c.email?.toLowerCase().includes(query) ? 5 : 0;
        results.push({
          id: c.id,
          type: 'customer',
          title: c.name || 'Unknown Customer',
          subtitle: c.phone || c.email || '',
          url: `/customers/${c.id}`,
          relevance: nameMatch + emailMatch,
        });
      });
    }

    // Search jobs by job number, customer name, or address
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, job_number, status, job_type, customer_name, service_address')
      .or(`job_number.ilike.%${query}%,customer_name.ilike.%${query}%,service_address.ilike.%${query}%`)
      .limit(limit);

    if (jobs) {
      jobs.forEach(j => {
        const jobNumMatch = j.job_number?.toLowerCase().includes(query) ? 15 : 0;
        const customerMatch = j.customer_name?.toLowerCase().includes(query) ? 8 : 0;
        results.push({
          id: j.id,
          type: 'job',
          title: `Job #${j.job_number || 'N/A'} - ${j.job_type || 'Service'}`,
          subtitle: j.customer_name || j.service_address || '',
          url: `/jobs/${j.id}`,
          relevance: jobNumMatch + customerMatch,
        });
      });
    }

    // Search invoices by invoice number or customer name
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, invoice_number, status, total, customer_name')
      .or(`invoice_number.ilike.%${query}%,customer_name.ilike.%${query}%`)
      .limit(limit);

    if (invoices) {
      invoices.forEach(inv => {
        const invNumMatch = inv.invoice_number?.toLowerCase().includes(query) ? 15 : 0;
        const amount = inv.total ? `$${Number(inv.total).toLocaleString()}` : '';
        results.push({
          id: inv.id,
          type: 'invoice',
          title: `Invoice #${inv.invoice_number || 'N/A'} ${amount}`,
          subtitle: `${inv.customer_name || ''} - ${inv.status || 'draft'}`,
          url: `/invoices/${inv.id}`,
          relevance: invNumMatch,
        });
      });
    }

    // Search quotes by quote number or customer name
    const { data: quotes } = await supabase
      .from('quotes')
      .select('id, quote_number, status, total, customer_name')
      .or(`quote_number.ilike.%${query}%,customer_name.ilike.%${query}%`)
      .limit(limit);

    if (quotes) {
      quotes.forEach(q => {
        const quoteNumMatch = q.quote_number?.toLowerCase().includes(query) ? 15 : 0;
        const amount = q.total ? `$${Number(q.total).toLocaleString()}` : '';
        results.push({
          id: q.id,
          type: 'quote',
          title: `Quote #${q.quote_number || 'N/A'} ${amount}`,
          subtitle: `${q.customer_name || ''} - ${q.status || 'draft'}`,
          url: `/quotes/${q.id}`,
          relevance: quoteNumMatch,
        });
      });
    }

    // Sort by relevance and limit results
    results.sort((a, b) => b.relevance - a.relevance);
    const topResults = results.slice(0, limit);

    return NextResponse.json({ 
      results: topResults,
      total: results.length,
      query
    });
  } catch (error) {
    console.error('Search API error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
