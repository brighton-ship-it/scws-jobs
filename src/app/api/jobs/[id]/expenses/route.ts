import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const supabase = await createClient();
    
    const { data: expenses, error } = await supabase
      .from('job_expenses')
      .select('*')
      .eq('job_id', jobId)
      .order('expense_date', { ascending: false });
    
    if (error) {
      console.error('Error fetching job expenses:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Calculate total
    const total = (expenses || []).reduce((sum, exp) => sum + Number(exp.amount), 0);
    
    return NextResponse.json({ 
      expenses: expenses || [],
      total 
    });
  } catch (error) {
    console.error('Job expenses API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
