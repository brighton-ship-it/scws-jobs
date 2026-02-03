import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const supabase = await createClient();
    
    const { data: parts, error } = await supabase
      .from('job_parts')
      .select(`
        *,
        inventory_items:inventory_item_id(id, name, sku, category, unit_cost)
      `)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching job parts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ parts: parts || [] });
  } catch (error) {
    console.error('Job parts API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const supabase = await createClient();
    const body = await request.json();
    
    const { inventory_item_id, quantity_used, unit_price } = body;
    
    if (!inventory_item_id || !quantity_used) {
      return NextResponse.json({ error: 'inventory_item_id and quantity_used are required' }, { status: 400 });
    }
    
    // Get current inventory
    const { data: item, error: itemError } = await supabase
      .from('inventory_items')
      .select('quantity, unit_cost, name')
      .eq('id', inventory_item_id)
      .single();
    
    if (itemError) {
      return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
    }
    
    if (item.quantity < quantity_used) {
      return NextResponse.json({ 
        error: `Insufficient stock. Only ${item.quantity} available.` 
      }, { status: 400 });
    }
    
    // Create job part
    const { data: part, error: partError } = await supabase
      .from('job_parts')
      .insert({
        job_id: jobId,
        inventory_item_id,
        quantity_used,
        unit_price: unit_price ?? item.unit_cost,
      })
      .select(`
        *,
        inventory_items:inventory_item_id(id, name, sku, category, unit_cost)
      `)
      .single();
    
    if (partError) {
      // Handle duplicate
      if (partError.code === '23505') {
        return NextResponse.json({ 
          error: 'This part is already added to this job. Update the quantity instead.' 
        }, { status: 400 });
      }
      return NextResponse.json({ error: partError.message }, { status: 500 });
    }
    
    // Deduct from inventory
    const { error: updateError } = await supabase
      .from('inventory_items')
      .update({ quantity: item.quantity - quantity_used })
      .eq('id', inventory_item_id);
    
    if (updateError) {
      console.error('Error updating inventory:', updateError);
    }
    
    // Create stock adjustment
    await supabase.from('stock_adjustments').insert({
      inventory_item_id,
      quantity_change: -quantity_used,
      reason: 'job_usage',
      notes: `Used on job`,
      job_id: jobId,
    });
    
    return NextResponse.json({ part }, { status: 201 });
  } catch (error) {
    console.error('Job parts API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const partId = searchParams.get('partId');
    
    if (!partId) {
      return NextResponse.json({ error: 'partId is required' }, { status: 400 });
    }
    
    // Get the part to restore inventory
    const { data: part, error: partError } = await supabase
      .from('job_parts')
      .select('*')
      .eq('id', partId)
      .eq('job_id', jobId)
      .single();
    
    if (partError) {
      return NextResponse.json({ error: 'Part not found' }, { status: 404 });
    }
    
    // Delete the part
    const { error: deleteError } = await supabase
      .from('job_parts')
      .delete()
      .eq('id', partId);
    
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
    
    // Restore inventory
    const { data: item } = await supabase
      .from('inventory_items')
      .select('quantity')
      .eq('id', part.inventory_item_id)
      .single();
    
    if (item) {
      await supabase
        .from('inventory_items')
        .update({ quantity: item.quantity + part.quantity_used })
        .eq('id', part.inventory_item_id);
      
      // Create return adjustment
      await supabase.from('stock_adjustments').insert({
        inventory_item_id: part.inventory_item_id,
        quantity_change: part.quantity_used,
        reason: 'return',
        notes: 'Part removed from job',
        job_id: jobId,
      });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Job parts delete API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
