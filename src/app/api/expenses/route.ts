import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    
    const category = searchParams.get('category');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const jobId = searchParams.get('jobId');
    const search = searchParams.get('search');
    
    let query = supabase
      .from('job_expenses')
      .select(`
        *,
        jobs:job_id(id, job_type, job_number)
      `)
      .order('expense_date', { ascending: false });
    
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }
    
    if (startDate) {
      query = query.gte('expense_date', startDate);
    }
    
    if (endDate) {
      query = query.lte('expense_date', endDate);
    }
    
    if (jobId) {
      query = query.eq('job_id', jobId);
    }
    
    if (search) {
      query = query.or(`description.ilike.%${search}%,vendor.ilike.%${search}%`);
    }
    
    const { data: expenses, error } = await query;
    
    if (error) {
      console.error('Error fetching expenses:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ expenses: expenses || [] });
  } catch (error) {
    console.error('Expenses API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    
    const { job_id, category, description, amount, vendor, expense_date, receipt_url } = body;
    
    if (!category || !description || amount === undefined) {
      return NextResponse.json({ error: 'Category, description, and amount are required' }, { status: 400 });
    }
    
    const { data: expense, error } = await supabase
      .from('job_expenses')
      .insert({
        job_id: job_id || null,
        category,
        description,
        amount,
        vendor: vendor || null,
        expense_date: expense_date || new Date().toISOString().split('T')[0],
        receipt_url: receipt_url || null,
      })
      .select(`
        *,
        jobs:job_id(id, job_type, job_number)
      `)
      .single();
    
    if (error) {
      console.error('Error creating expense:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ expense }, { status: 201 });
  } catch (error) {
    console.error('Expenses API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
