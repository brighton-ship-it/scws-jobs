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
    
    console.log('Quote API - ID received:', id);
    
    const supabase = createServiceClient();

    const { data: quote, error } = await supabase
      .from('quotes')
      .select(`
        *,
        customer:customers (id, name, email, phone),
        property:properties (id, address, city),
        items:quote_items (*)
      `)
      .eq('id', id)
      .single();

    console.log('Quote API - Query result:', { found: !!quote, error: error?.message });

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

    // Delete items first (cascade should handle this but being explicit)
    await supabase.from('quote_items').delete().eq('quote_id', id);

    const { error } = await supabase
      .from('quotes')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Quote delete error:', error);
    return NextResponse.json({ error: 'Failed to delete quote' }, { status: 500 });
  }
}
