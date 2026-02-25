import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET - List quotes
export async function GET(request: Request) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);
    
    const status = searchParams.get('status');
    const customerId = searchParams.get('customer_id');
    const limit = parseInt(searchParams.get('limit') || '50');
    const includeCounts = searchParams.get('counts') === 'true';
    
    let query = supabase
      .from('quotes')
      .select(`
        *,
        customer:customers(id, name, email, phone),
        property:properties(id, address, city),
        items:quote_items(*)
      `)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (status) {
      query = query.eq('status', status);
    }
    
    if (customerId) {
      query = query.eq('customer_id', customerId);
    }
    
    const { data: quotes, error } = await query;
    
    if (error) {
      console.error('Quotes fetch error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Optionally include counts by status
    let counts: Record<string, number> | undefined;
    if (includeCounts) {
      counts = {};
      const statuses = ['draft', 'sent', 'accepted', 'declined', 'expired', 'completed'];
      for (const s of statuses) {
        const { count } = await supabase
          .from('quotes')
          .select('id', { count: 'exact', head: true })
          .eq('status', s);
        if (count !== null) counts[s] = count;
      }
    }
    
    return NextResponse.json({ quotes: quotes || [], counts });
  } catch (error) {
    console.error('Quotes API error:', error);
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
  }
}

// POST - Create new quote
export async function POST(request: Request) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();
    
    const {
      customer_id,
      property_id,
      valid_until,
      notes,
      internal_notes,
      tax_rate = 8.75,
      required_deposit,
      line_items = [],
      status = 'draft',
    } = body;
    
    if (!customer_id) {
      return NextResponse.json({ error: 'Customer ID is required' }, { status: 400 });
    }
    
    // Calculate totals
    const subtotal = line_items.reduce((sum: number, item: any) => sum + (item.total || 0), 0);
    const taxableSubtotal = line_items
      .filter((item: any) => item.taxable !== false)
      .reduce((sum: number, item: any) => sum + (item.total || 0), 0);
    const tax_amount = taxableSubtotal * (tax_rate / 100);
    const total = subtotal + tax_amount;
    
    // Create quote
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .insert({
        customer_id,
        property_id: property_id || null,
        status,
        valid_until: valid_until || null,
        subtotal,
        tax_rate,
        tax_amount,
        total,
        notes: notes || null,
        internal_notes: internal_notes || null,
        // required_deposit: required_deposit || null, // TODO: Add column if needed
      })
      .select()
      .single();
    
    if (quoteError) {
      console.error('Quote creation error:', quoteError);
      return NextResponse.json({ error: quoteError.message }, { status: 500 });
    }
    
    // Create line items
    if (line_items.length > 0) {
      const itemsToInsert = line_items.map((item: any, index: number) => ({
        quote_id: quote.id,
        product_id: item.product_id || null,
        description: item.description,
        quantity: item.quantity || 1,
        unit_price: item.unit_price || 0,
        total: item.total || 0,
        item_type: item.item_type || null,
        sort_order: index,
      }));
      
      console.log('Inserting items:', JSON.stringify(itemsToInsert));
      
      const { data: insertedItems, error: itemsError } = await supabase
        .from('quote_items')
        .insert(itemsToInsert)
        .select();
      
      if (itemsError) {
        console.error('Quote items error:', itemsError);
        return NextResponse.json({ 
          quote, 
          warning: `Quote created but items failed: ${itemsError.message}` 
        });
      }
      
      console.log('Inserted items:', insertedItems?.length);
    }
    
    return NextResponse.json({ 
      quote,
      message: 'Quote created successfully' 
    });
  } catch (error) {
    console.error('Quote creation error:', error);
    return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 });
  }
}
