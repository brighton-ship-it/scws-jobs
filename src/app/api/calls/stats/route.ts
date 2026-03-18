export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// GET /api/calls/stats - Get call statistics by source
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30');
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Get all calls in the date range
    const { data: calls, error } = await supabase
      .from('tracked_calls')
      .select('source, duration_seconds, call_status')
      .gte('started_at', startDate.toISOString());
    
    if (error) {
      console.error('Error fetching call stats:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Aggregate by source
    const stats: Record<string, { 
      total_calls: number; 
      completed_calls: number;
      total_duration: number;
      avg_duration: number;
    }> = {};
    
    const sources = ['seo', 'google_ads', 'gmb', 'direct', 'unknown'];
    sources.forEach(source => {
      stats[source] = { total_calls: 0, completed_calls: 0, total_duration: 0, avg_duration: 0 };
    });
    
    calls?.forEach(call => {
      const source = call.source || 'unknown';
      if (!stats[source]) {
        stats[source] = { total_calls: 0, completed_calls: 0, total_duration: 0, avg_duration: 0 };
      }
      stats[source].total_calls++;
      if (call.call_status === 'completed') {
        stats[source].completed_calls++;
      }
      if (call.duration_seconds) {
        stats[source].total_duration += call.duration_seconds;
      }
    });
    
    // Calculate averages
    Object.keys(stats).forEach(source => {
      if (stats[source].completed_calls > 0) {
        stats[source].avg_duration = Math.round(stats[source].total_duration / stats[source].completed_calls);
      }
    });
    
    // Summary
    const summary = {
      total_calls: calls?.length || 0,
      period_days: days,
      by_source: stats,
    };
    
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Call stats error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
