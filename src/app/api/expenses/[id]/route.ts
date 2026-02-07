import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();
    
    const { data: expense, error } = await supabase
      .from('job_expenses')
      .select(`
        *,
        jobs:job_id(id, job_type, job_number)
      `)
      .eq('id', id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Expense not found' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ expense });
  } catch (error) {
    console.error('Expense detail API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();
    const body = await request.json();
    
    const { job_id, category, description, amount, vendor, expense_date, receipt_url } = body;
    
    const updates: Record<string, unknown> = {};
    if (job_id !== undefined) updates.job_id = job_id;
    if (category !== undefined) updates.category = category;
    if (description !== undefined) updates.description = description;
    if (amount !== undefined) updates.amount = amount;
    if (vendor !== undefined) updates.vendor = vendor;
    if (expense_date !== undefined) updates.expense_date = expense_date;
    if (receipt_url !== undefined) updates.receipt_url = receipt_url;
    
    const { data: expense, error } = await supabase
      .from('job_expenses')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        jobs:job_id(id, job_type, job_number)
      `)
      .single();
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ expense });
  } catch (error) {
    console.error('Expense update API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();
    
    const { error } = await supabase
      .from('job_expenses')
      .delete()
      .eq('id', id);
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Expense delete API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
