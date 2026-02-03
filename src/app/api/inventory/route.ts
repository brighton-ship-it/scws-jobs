import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    
    const category = searchParams.get('category');
    const lowStock = searchParams.get('lowStock') === 'true';
    const search = searchParams.get('search');
    
    let query = supabase
      .from('inventory_items')
      .select('*')
      .order('name');
    
    if (category && category !== 'All') {
      query = query.eq('category', category);
    }
    
    if (search) {
      query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
    }
    
    const { data: items, error } = await query;
    
    if (error) {
      console.error('Error fetching inventory:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Filter low stock items if requested
    let filteredItems = items || [];
    if (lowStock) {
      filteredItems = filteredItems.filter(item => item.quantity <= item.reorder_level);
    }
    
    return NextResponse.json({ items: filteredItems });
  } catch (error) {
    console.error('Inventory API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    
    const { name, sku, category, quantity, unit_cost, reorder_level, location, vendor, description } = body;
    
    if (!name || !category) {
      return NextResponse.json({ error: 'Name and category are required' }, { status: 400 });
    }
    
    const { data: item, error } = await supabase
      .from('inventory_items')
      .insert({
        name,
        sku: sku || null,
        category,
        quantity: quantity || 0,
        unit_cost: unit_cost || 0,
        reorder_level: reorder_level || 0,
        location: location || null,
        vendor: vendor || null,
        description: description || null,
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating inventory item:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Create initial stock adjustment if quantity > 0
    if (quantity > 0) {
      await supabase.from('stock_adjustments').insert({
        inventory_item_id: item.id,
        quantity_change: quantity,
        reason: 'inventory_count',
        notes: 'Initial inventory count',
      });
    }
    
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    console.error('Inventory API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
