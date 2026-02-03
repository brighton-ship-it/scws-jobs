import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    
    const { data: item, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Get stock adjustments for history
    const { data: adjustments } = await supabase
      .from('stock_adjustments')
      .select(`
        *,
        jobs:job_id(id, job_type, job_number)
      `)
      .eq('inventory_item_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    
    // Get job parts usage
    const { data: jobParts } = await supabase
      .from('job_parts')
      .select(`
        *,
        jobs:job_id(id, job_type, job_number, status, scheduled_date)
      `)
      .eq('inventory_item_id', id)
      .order('created_at', { ascending: false })
      .limit(20);
    
    return NextResponse.json({ 
      item, 
      adjustments: adjustments || [], 
      jobParts: jobParts || [] 
    });
  } catch (error) {
    console.error('Inventory detail API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const body = await request.json();
    
    const { name, sku, category, unit_cost, reorder_level, location, vendor, description } = body;
    
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (sku !== undefined) updates.sku = sku;
    if (category !== undefined) updates.category = category;
    if (unit_cost !== undefined) updates.unit_cost = unit_cost;
    if (reorder_level !== undefined) updates.reorder_level = reorder_level;
    if (location !== undefined) updates.location = location;
    if (vendor !== undefined) updates.vendor = vendor;
    if (description !== undefined) updates.description = description;
    
    const { data: item, error } = await supabase
      .from('inventory_items')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ item });
  } catch (error) {
    console.error('Inventory update API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    
    const { error } = await supabase
      .from('inventory_items')
      .delete()
      .eq('id', id);
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Inventory delete API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
