import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { addWeeks, addMonths, addYears, startOfDay } from 'date-fns';

const CRON_SECRET = process.env.CRON_SECRET;

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
 * POST /api/cron/process-recurring
 * Process recurring schedules and create jobs that are due
 */
export async function POST(request: NextRequest) {
  // Verify cron secret in production
  if (CRON_SECRET) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const startTime = Date.now();
  const results = {
    schedulesProcessed: 0,
    jobsCreated: 0,
    errors: [] as string[],
  };

  try {
    console.log('[Recurring Cron] Starting processing...');
    const supabase = createServiceClient();
    const today = startOfDay(new Date());

    // Get all active recurring schedules that are due (next_scheduled <= today)
    const { data: schedules, error: fetchError } = await supabase
      .from('recurring_jobs')
      .select('*')
      .eq('status', 'active')
      .lte('next_scheduled', today.toISOString().split('T')[0]);

    if (fetchError) {
      console.error('[Recurring Cron] Error fetching schedules:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch schedules', details: fetchError.message },
        { status: 500 }
      );
    }

    if (!schedules?.length) {
      console.log('[Recurring Cron] No schedules due today');
      return NextResponse.json({
        success: true,
        message: 'No recurring schedules due',
        results,
        duration: Date.now() - startTime,
      });
    }

    console.log(`[Recurring Cron] Found ${schedules.length} schedules due`);

    // Process each schedule
    for (const schedule of schedules) {
      results.schedulesProcessed++;

      try {
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
          console.error(`[Recurring Cron] Error creating job for schedule ${schedule.id}:`, jobError);
          results.errors.push(`Schedule ${schedule.id}: ${jobError.message}`);
          continue;
        }

        results.jobsCreated++;

        // Create the instance link
        await supabase.from('recurring_job_instances').insert({
          recurring_job_id: schedule.id,
          job_id: job.id,
          scheduled_date: schedule.next_scheduled,
        });

        // Calculate and update next run date
        const nextRun = calculateNextRun(new Date(schedule.next_scheduled), schedule.frequency);

        const { error: updateError } = await supabase
          .from('recurring_jobs')
          .update({
            last_job_created_at: new Date().toISOString(),
            next_scheduled: nextRun.toISOString().split('T')[0],
            jobs_created: (schedule.jobs_created || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', schedule.id);

        if (updateError) {
          console.error(`[Recurring Cron] Error updating schedule ${schedule.id}:`, updateError);
          results.errors.push(`Schedule ${schedule.id} update: ${updateError.message}`);
        }

        console.log(`[Recurring Cron] Created job ${job.id} for schedule ${schedule.id}, next run: ${nextRun.toISOString().split('T')[0]}`);
      } catch (error) {
        console.error(`[Recurring Cron] Error processing schedule ${schedule.id}:`, error);
        results.errors.push(`Schedule ${schedule.id}: ${String(error)}`);
      }
    }

    console.log('[Recurring Cron] Completed:', results);

    return NextResponse.json({
      success: true,
      results,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    console.error('[Recurring Cron] Fatal error:', error);
    return NextResponse.json(
      { error: 'Cron processing failed', details: String(error) },
      { status: 500 }
    );
  }
}

// Allow GET for easier testing
export async function GET(request: NextRequest) {
  return POST(request);
}
