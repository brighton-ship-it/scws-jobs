import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

// GET - List callouts
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);
    
    const userId = searchParams.get('user_id');
    const status = searchParams.get('status');
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');

    // Simplified query without relationships to check table existence
    let query = supabase
      .from('on_call_callouts')
      .select('*')
      .order('callout_date', { ascending: false });

    if (userId) query = query.eq('user_id', userId);
    if (status) query = query.eq('status', status);
    if (startDate) query = query.gte('callout_date', startDate);
    if (endDate) query = query.lte('callout_date', endDate);

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching callouts:', error);
      return NextResponse.json({ error: 'Failed to fetch callouts' }, { status: 500 });
    }

    return NextResponse.json({ callouts: data });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Log a callout
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();

    const {
      user_id,
      job_id,
      customer_id,
      callout_date,
      start_time,
      end_time,
      hours_worked,
      description,
    } = body;

    if (!user_id || !callout_date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get settings for pay calculation
    const { data: settings } = await supabase
      .from('on_call_settings')
      .select('*')
      .single();

    const multiplier = settings?.callout_multiplier || 1.5;
    const minHours = settings?.minimum_callout_hours || 2;
    const baseRate = settings?.base_hourly_rate || 30;

    // Calculate pay
    const actualHours = hours_worked || minHours;
    const effectiveHours = Math.max(actualHours, minHours);
    const totalPay = effectiveHours * baseRate * multiplier;

    // Find the slot for this date
    const { data: slot } = await supabase
      .from('on_call_slots')
      .select('id')
      .eq('slot_date', callout_date)
      .single();

    const { data: callout, error } = await supabase
      .from('on_call_callouts')
      .insert({
        slot_id: slot?.id || null,
        user_id,
        job_id: job_id || null,
        customer_id: customer_id || null,
        callout_date,
        start_time: start_time || null,
        end_time: end_time || null,
        hours_worked: effectiveHours,
        hourly_rate: baseRate,
        multiplier,
        total_pay: totalPay,
        description: description || null,
        status: 'pending',
      })
      .select(`
        *,
        user:users (id, name)
      `)
      .single();

    if (error) {
      console.error('Error creating callout:', error);
      return NextResponse.json({ error: 'Failed to log callout' }, { status: 500 });
    }

    return NextResponse.json({ callout });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
