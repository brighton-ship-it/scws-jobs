import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

// GET - Fetch on-call settings
export async function GET() {
  try {
    const supabase = createServiceClient();
    
    const { data, error } = await supabase
      .from('on_call_settings')
      .select('*')
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching on-call settings:', error);
      return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }

    // Return defaults if no settings exist
    const settings = data || {
      availability_pay_daily: 75.00,
      callout_multiplier: 1.50,
      minimum_callout_hours: 2.00,
      base_hourly_rate: 30.00,
      require_one_per_day: true,
      auto_rotate: false,
      notify_days_ahead: 7,
    };

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT - Update on-call settings
export async function PUT(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();

    // Get existing settings ID
    const { data: existing } = await supabase
      .from('on_call_settings')
      .select('id')
      .single();

    if (existing) {
      const { data, error } = await supabase
        .from('on_call_settings')
        .update({
          ...body,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ settings: data });
    } else {
      const { data, error } = await supabase
        .from('on_call_settings')
        .insert(body)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ settings: data });
    }
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
