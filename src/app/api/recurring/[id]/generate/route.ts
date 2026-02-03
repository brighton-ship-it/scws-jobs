import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { addWeeks, addMonths, addYears } from 'date-fns';
import type { RecurringFrequency } from '@/types/database';

/**
 * Calculate the next run date based on frequency
 */
function calculateNextRun(currentDate: Date, frequency: string): Date {
  switch (frequency) {
    case 'weekly':
      return addWeeks(currentDate, 1);
    case 'biweekly':
      return addWeeks(currentDate, 2);
    case 'monthly':
      return addMonths(currentDate, 1);
    case 'quarterly':
      return addMonths(currentDate, 3);
    case 'biannual':
      return addMonths(currentDate, 6);
    case 'annual':
      return addYears(currentDate, 1);
    default:
      return addMonths(currentDate, 1);
  }
}

/**
 * POST /api/recurring/[id]/generate - Generate a job from recurring schedule
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Get the recurring schedule
    const { data: schedule, error: scheduleError } = await supabase
      .from('recurring_jobs')
      .select('*')
      .eq('id', id)
      .single();

    if (scheduleError || !schedule) {
      return NextResponse.json(
        { error: 'Recurring schedule not found' },
        { status: 404 }
      );
    }

    if (schedule.status !== 'active') {
      return NextResponse.json(
        { error: 'Schedule is paused' },
        { status: 400 }
      );
    }

    // Generate job number
    const { data: lastJob } = await supabase
      .from('jobs')
      .select('job_number')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const jobNumber = lastJob?.job_number 
      ? `J${String(parseInt(lastJob.job_number.replace('J', '')) + 1).padStart(5, '0')}`
      : 'J00001';

    // Convert duration minutes to string
    const durationStr = schedule.estimated_duration_minutes 
      ? `${schedule.estimated_duration_minutes} minutes`
      : null;

    // Create the job
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert({
        property_id: schedule.property_id,
        assigned_to: schedule.assigned_to,
        status: 'scheduled',
        job_type: schedule.title || schedule.job_type,
        scheduled_date: schedule.next_scheduled,
        scheduled_time: null,
        estimated_duration: durationStr,
        description: schedule.description,
        internal_notes: schedule.internal_notes 
          ? `[Recurring Job] ${schedule.internal_notes}` 
          : '[Recurring Job]',
        priority: 'normal',
        recurring_schedule_id: schedule.id,
        job_number: jobNumber,
      })
      .select()
      .single();

    if (jobError) {
      console.error('Error creating job from recurring:', jobError);
      return NextResponse.json(
        { error: 'Failed to create job', details: jobError.message },
        { status: 500 }
      );
    }

    // Update the recurring schedule
    const nextRun = calculateNextRun(new Date(schedule.next_scheduled), schedule.frequency);

    const { error: updateError } = await supabase
      .from('recurring_jobs')
      .update({
        last_job_created_at: new Date().toISOString(),
        next_scheduled: nextRun.toISOString().split('T')[0],
        jobs_created: (schedule.jobs_created || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      console.error('Error updating recurring schedule:', updateError);
      // Job was created but schedule update failed - not critical
    }

    // Also create the instance link
    await supabase.from('recurring_job_instances').insert({
      recurring_job_id: schedule.id,
      job_id: job.id,
      scheduled_date: schedule.next_scheduled,
    });

    return NextResponse.json({
      success: true,
      job,
      nextRun: nextRun.toISOString().split('T')[0],
    });
  } catch (error) {
    console.error('Generate job API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
