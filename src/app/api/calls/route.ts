import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// GET /api/calls - List calls with optional filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const days = parseInt(searchParams.get('days') || '30');
    const limit = parseInt(searchParams.get('limit') || '100');
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    let query = supabase
      .from('tracked_calls')
      .select('*')
      .gte('started_at', startDate.toISOString())
      .order('started_at', { ascending: false })
      .limit(limit);
    
    if (source) {
      query = query.eq('source', source);
    }
    
    const { data: calls, error } = await query;
    
    if (error) {
      console.error('Error fetching calls:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ calls });
  } catch (error) {
    console.error('Calls API error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
