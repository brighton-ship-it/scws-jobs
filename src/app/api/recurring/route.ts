import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import type { RecurringFrequency } from '@/types/database';

/**
 * GET /api/recurring - List all recurring schedules
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status'); // 'active' | 'paused' | 'all'

    let query = supabase
      .from('recurring_jobs')
      .select(`
        *,
        customer:customers (id, name, phone, email),
        property:properties (id, address, city)
      `)
      .order('next_scheduled', { ascending: true });

    if (status === 'active') {
      query = query.eq('status', 'active');
    } else if (status === 'paused') {
      query = query.eq('status', 'paused');
    }

    const { data: rawSchedules, error } = await query;

    if (error) {
      console.error('Error fetching recurring schedules:', error);
      return NextResponse.json(
        { error: 'Failed to fetch recurring schedules', details: error.message },
        { status: 500 }
      );
    }

    // Map to API format
    const schedules = (rawSchedules || []).map(s => ({
      id: s.id,
      job_type: s.title,
      description: s.description,
      frequency: s.frequency,
      next_run: s.next_scheduled,
      last_run: s.last_job_created_at,
      active: s.status === 'active',
      price: s.price,
      jobs_created: s.jobs_created,
      internal_notes: s.internal_notes,
      customer_id: s.customer_id,
      property_id: s.property_id,
      assigned_to: s.assigned_to,
      customer: s.customer,
      property: s.property,
      created_at: s.created_at,
    }));

    return NextResponse.json({ schedules });
  } catch (error) {
    console.error('Recurring API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/recurring - Create a new recurring schedule
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();

    const {
      job_id,
      customer_id,
      property_id,
      frequency,
      start_date,
      job_type,
      description,
      estimated_duration,
      assigned_to,
      price,
      internal_notes,
    } = body;

    // Validate required fields
    if (!customer_id || !property_id || !frequency || !start_date || !job_type) {
      return NextResponse.json(
        { error: 'Missing required fields: customer_id, property_id, frequency, start_date, job_type' },
        { status: 400 }
      );
    }

    // Validate frequency
    const validFrequencies: RecurringFrequency[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'biannual', 'annual'];
    if (!validFrequencies.includes(frequency)) {
      return NextResponse.json(
        { error: 'Invalid frequency. Must be: weekly, biweekly, monthly, quarterly, biannual, or annual' },
        { status: 400 }
      );
    }

    // Parse duration to minutes
    let durationMinutes: number | null = null;
    if (estimated_duration) {
      // Parse strings like "2 hours" or "90 minutes"
      const match = estimated_duration.match(/(\d+)\s*(hour|hr|minute|min)/i);
      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        durationMinutes = unit.startsWith('hour') || unit.startsWith('hr') ? value * 60 : value;
      }
    }

    const { data: schedule, error } = await supabase
      .from('recurring_jobs')
      .insert({
        customer_id,
        property_id,
        title: job_type,
        description: description || null,
        job_type: job_type,
        frequency,
        start_date,
        next_scheduled: start_date,
        estimated_duration_minutes: durationMinutes,
        assigned_to: assigned_to || null,
        price: price || null,
        internal_notes: internal_notes || null,
        status: 'active',
        jobs_created: 0,
      })
      .select(`
        *,
        customer:customers (id, name),
        property:properties (id, address, city)
      `)
      .single();

    if (error) {
      console.error('Error creating recurring schedule:', error);
      return NextResponse.json(
        { error: 'Failed to create recurring schedule', details: error.message },
        { status: 500 }
      );
    }

    // Map to API format
    const result = {
      id: schedule.id,
      job_type: schedule.title,
      frequency: schedule.frequency,
      next_run: schedule.next_scheduled,
      active: schedule.status === 'active',
      price: schedule.price,
      customer: schedule.customer,
      property: schedule.property,
    };

    return NextResponse.json({ schedule: result });
  } catch (error) {
    console.error('Create recurring API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
