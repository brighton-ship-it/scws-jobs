import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { jobberGraphql } from '@/lib/jobber/client';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();

    // Fetch approved drilling quotes from Jobber. Tokens come from the
    // durable settings.jobber_oauth row (env is bootstrap only).
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

    const result = await jobberGraphql(query);
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
    const message = error instanceof Error ? error.message : 'Failed to sync from Jobber';
    console.error(`[drilling-sync] ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
