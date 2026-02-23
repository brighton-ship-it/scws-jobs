import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET single quote by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const id = resolvedParams.id;
    
    const supabase = createServiceClient();

    // Try UUID first, then quote_number
    let quote;
    let error;
    
    // Check if it looks like a UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    
    if (isUUID) {
      const result = await supabase
        .from('quotes')
        .select(`
          *,
          customer:customers (id, name, email, phone, billing_address),
          property:properties (id, address, city),
          items:quote_items (*)
        `)
        .eq('id', id)
        .single();
      quote = result.data;
      error = result.error;
    }
    
    // If not found by UUID, try by quote_number
    if (!quote) {
      const result = await supabase
        .from('quotes')
        .select(`
          *,
          customer:customers (id, name, email, phone, billing_address),
          property:properties (id, address, city),
          items:quote_items (*)
        `)
        .eq('quote_number', parseInt(id))
        .single();
      quote = result.data;
      error = result.error;
    }

    if (error || !quote) {
      return NextResponse.json({ error: 'Quote not found', id, dbError: error?.message }, { status: 404 });
    }

    // Sort items by sort_order
    if (quote.items) {
      quote.items.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
    }

    return NextResponse.json({ quote });
  } catch (error) {
    console.error('Quote fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch quote' }, { status: 500 });
  }
}

// PATCH - Update quote
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();
    const body = await request.json();

    const { data: quote, error } = await supabase
      .from('quotes')
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ quote });
  } catch (error) {
    console.error('Quote update error:', error);
    return NextResponse.json({ error: 'Failed to update quote' }, { status: 500 });
  }
}

// DELETE quote
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();

    // Check if it's a UUID or quote_number
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    
    let quoteId = id;
    
    // If not UUID, find the UUID by quote_number
    if (!isUUID) {
      const { data: quote } = await supabase
        .from('quotes')
        .select('id')
        .eq('quote_number', parseInt(id))
        .single();
      if (quote) {
        quoteId = quote.id;
      }
    }

    // Delete items first (cascade should handle this but being explicit)
    await supabase.from('quote_items').delete().eq('quote_id', quoteId);

    const { error } = await supabase
      .from('quotes')
      .delete()
      .eq('id', quoteId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Quote delete error:', error);
    return NextResponse.json({ error: 'Failed to delete quote' }, { status: 500 });
  }
}
