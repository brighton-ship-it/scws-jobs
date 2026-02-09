import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const JOBBER_API = 'https://api.getjobber.com/api/graphql';

async function jobberQuery(query: string, token: string) {
  const res = await fetch(JOBBER_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-JOBBER-GRAPHQL-VERSION': '2025-04-16'
    },
    body: JSON.stringify({ query })
  });
  return res.json();
}

export async function POST(request: NextRequest) {
  try {
    const token = process.env.JOBBER_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'Jobber token not configured' }, { status: 500 });
    }

    // Fetch approved drilling quotes from Jobber
    const query = `
      {
        quotes(first: 100, filter: {status: approved}) {
          nodes {
            id
            quoteNumber
            title
            quoteStatus
            createdAt
            amounts { total }
            client {
              id
              name
            }
            property {
              address {
                street1
                street2
                city
                province
                postalCode
              }
            }
          }
        }
      }
    `;

    const result = await jobberQuery(query, token);
    const quotes = result.data?.quotes?.nodes || [];

    // Filter for drilling-related quotes (wells, not tanks/pumps)
    const drillingKeywords = ['drill', 'drilling', 'new well', 'well drilling', 'water well', 'air rotary', 'deepen'];
    const excludeKeywords = ['tank', 'pump', 'motor', 'booster', 'replacement'];
    const drillingQuotes = quotes.filter((q: any) => {
      const title = (q.title || '').toLowerCase();
      const hasDrillingKeyword = drillingKeywords.some(keyword => title.includes(keyword));
      const hasExcludeKeyword = excludeKeywords.some(keyword => title.includes(keyword));
      return hasDrillingKeyword && !hasExcludeKeyword;
    });

    // Get existing quote numbers to avoid duplicates
    const { data: existingProjects } = await supabase
      .from('drilling_projects')
      .select('quote_number');
    
    const existingQuoteNumbers = new Set(
      (existingProjects || []).map(p => p.quote_number)
    );

    // Import new drilling projects
    let imported = 0;
    for (const quote of drillingQuotes) {
      if (existingQuoteNumbers.has(quote.quoteNumber)) {
        continue; // Skip existing
      }

      const address = quote.property?.address;
      const propertyAddress = address 
        ? `${address.street1 || ''} ${address.street2 || ''}, ${address.city || ''}, ${address.province || ''} ${address.postalCode || ''}`.trim()
        : 'Address not specified';

      const { error } = await supabase
        .from('drilling_projects')
        .insert({
          quote_id: quote.id,
          quote_number: quote.quoteNumber,
          customer_name: quote.client?.name || 'Unknown',
          customer_id: quote.client?.id,
          property_address: propertyAddress,
          total: quote.amounts?.total || 0,
          quote_date: quote.createdAt,
          stage: 'deposit', // Start at first stage
          jobber_data: quote
        });

      if (!error) {
        imported++;
      }
    }

    return NextResponse.json({ 
      success: true, 
      imported,
      total_drilling_quotes: drillingQuotes.length,
      already_imported: drillingQuotes.length - imported
    });
  } catch (error) {
    console.error('Error syncing from Jobber:', error);
    return NextResponse.json({ error: 'Failed to sync from Jobber' }, { status: 500 });
  }
}
