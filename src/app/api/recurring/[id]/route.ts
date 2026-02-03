import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { RecurringFrequency } from '@/types/database';

/**
 * GET /api/recurring/[id] - Get a single recurring schedule
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: schedule, error } = await supabase
      .from('recurring_jobs')
      .select(`
        *,
        customer:customers (id, name, phone, email),
        property:properties (id, address, city)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
      }
      return NextResponse.json(
        { error: 'Failed to fetch schedule', details: error.message },
        { status: 500 }
      );
    }

    // Map to API format
    const result = {
      id: schedule.id,
      job_type: schedule.title,
      description: schedule.description,
      frequency: schedule.frequency,
      next_run: schedule.next_scheduled,
      last_run: schedule.last_job_created_at,
      active: schedule.status === 'active',
      price: schedule.price,
      jobs_created: schedule.jobs_created,
      customer: schedule.customer,
      property: schedule.property,
    };

    return NextResponse.json({ schedule: result });
  } catch (error) {
    console.error('Get recurring API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/recurring/[id] - Update a recurring schedule
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const body = await request.json();

    const updates: Record<string, any> = {};

    // Map API fields to database fields
    if (body.frequency !== undefined) updates.frequency = body.frequency;
    if (body.next_run !== undefined) updates.next_scheduled = body.next_run;
    if (body.active !== undefined) updates.status = body.active ? 'active' : 'paused';
    if (body.job_type !== undefined) updates.title = body.job_type;
    if (body.description !== undefined) updates.description = body.description;
    if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to;
    if (body.price !== undefined) updates.price = body.price;
    if (body.internal_notes !== undefined) updates.internal_notes = body.internal_notes;

    // Validate frequency if provided
    if (updates.frequency) {
      const validFrequencies: RecurringFrequency[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'biannual', 'annual'];
      if (!validFrequencies.includes(updates.frequency)) {
        return NextResponse.json(
          { error: 'Invalid frequency' },
          { status: 400 }
        );
      }
    }

    updates.updated_at = new Date().toISOString();

    const { data: schedule, error } = await supabase
      .from('recurring_jobs')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        customer:customers (id, name),
        property:properties (id, address, city)
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
      }
      return NextResponse.json(
        { error: 'Failed to update schedule', details: error.message },
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
    console.error('Update recurring API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/recurring/[id] - Delete a recurring schedule
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { error } = await supabase
      .from('recurring_jobs')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to delete schedule', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete recurring API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
