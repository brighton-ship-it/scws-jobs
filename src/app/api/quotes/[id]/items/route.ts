import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// PUT - Replace all quote items
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: quoteId } = await params;
    const supabase = createServiceClient();
    const body = await request.json();
    const { items } = body;

    // First delete existing items
    const { error: deleteError } = await supabase
      .from('quote_items')
      .delete()
      .eq('quote_id', quoteId);

    if (deleteError) {
      console.error('Error deleting quote items:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Insert new items if any
    // Note: Only include columns that exist in the base schema
    // taxable and item_description columns require migration 20250202_add_quote_item_description_taxable.sql
    if (items && items.length > 0) {
      const itemsToInsert = items.map((item: any, index: number) => ({
        quote_id: quoteId,
        description: item.description,
        quantity: item.quantity || 1,
        unit_price: item.unit_price || 0,
        total: item.total || 0,
        item_type: item.item_type || null,
        sort_order: item.sort_order ?? index,
      }));

      const { data: newItems, error: insertError } = await supabase
        .from('quote_items')
        .insert(itemsToInsert)
        .select();

      if (insertError) {
        console.error('Error inserting quote items:', insertError);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      return NextResponse.json({ items: newItems });
    }

    return NextResponse.json({ items: [] });
  } catch (error) {
    console.error('Quote items update error:', error);
    return NextResponse.json({ error: 'Failed to update quote items' }, { status: 500 });
  }
}

// GET - Get quote items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: quoteId } = await params;
    const supabase = createServiceClient();

    const { data: items, error } = await supabase
      .from('quote_items')
      .select('*')
      .eq('quote_id', quoteId)
      .order('sort_order', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ items: items || [] });
  } catch (error) {
    console.error('Quote items fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch quote items' }, { status: 500 });
  }
}
