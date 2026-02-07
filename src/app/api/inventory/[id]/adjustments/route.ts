import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();
    const body = await request.json();
    
    const { quantity_change, reason, notes, job_id } = body;
    
    if (quantity_change === undefined || !reason) {
      return NextResponse.json({ error: 'quantity_change and reason are required' }, { status: 400 });
    }
    
    // Get current item
    const { data: item, error: itemError } = await supabase
      .from('inventory_items')
      .select('quantity')
      .eq('id', id)
      .single();
    
    if (itemError) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    
    const newQuantity = item.quantity + quantity_change;
    if (newQuantity < 0) {
      return NextResponse.json({ error: 'Insufficient stock' }, { status: 400 });
    }
    
    // Update quantity
    const { error: updateError } = await supabase
      .from('inventory_items')
      .update({ quantity: newQuantity })
      .eq('id', id);
    
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    
    // Create adjustment record
    const { data: adjustment, error: adjustError } = await supabase
      .from('stock_adjustments')
      .insert({
        inventory_item_id: id,
        quantity_change,
        reason,
        notes: notes || null,
        job_id: job_id || null,
      })
      .select()
      .single();
    
    if (adjustError) {
      console.error('Error creating adjustment:', adjustError);
    }
    
    return NextResponse.json({ 
      adjustment, 
      newQuantity 
    }, { status: 201 });
  } catch (error) {
    console.error('Stock adjustment API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
