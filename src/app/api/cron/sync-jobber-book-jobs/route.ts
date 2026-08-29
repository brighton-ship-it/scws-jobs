import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  BOOK_JOB_EVENT_NAME,
  buildBookJobPayload,
  clientContactFromJob,
  decideBookJob,
  isJobScheduled,
  jobCreatedRecently,
  jobValueUsd,
  matchWebsiteLead,
  normalizeEmail,
  normalizePhone,
  type WebsiteLead,
} from '@/lib/ads/book-job';
import { sendBookJobEvent } from '@/lib/ads/ga4-measurement-protocol';
import { fetchRecentlyUpdatedJobs } from '@/lib/jobber/recent-jobs';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';

// GET/POST from Vercel Cron: x-vercel-cron + Authorization Bearer CRON_SECRET.
// Middleware skips session auth for /api/cron/*; this handler still requires the secret.

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function mapLeadRow(
  row: Record<string, any>,
  source: WebsiteLead['source']
): WebsiteLead {
  return {
    id: String(row.id),
    source,
    phone: row.phone ?? null,
    email: row.email ?? null,
    created_at: row.created_at,
    gclid: row.gclid ?? null,
    gbraid: row.gbraid ?? null,
    wbraid: row.wbraid ?? null,
    ga_client_id: row.ga_client_id ?? null,
    ga_session_id: row.ga_session_id ?? null,
  };
}

async function loadRecentWebsiteLeads(supabase: ReturnType<typeof createServiceClient>) {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const select =
    'id, phone, email, created_at, gclid, gbraid, wbraid, ga_client_id, ga_session_id';

  const [bookings, customers] = await Promise.all([
    supabase.from('booking_requests').select(select).gte('created_at', since).limit(1000),
    supabase.from('customers').select(select).gte('created_at', since).limit(1000),
  ]);

  if (bookings.error) {
    console.warn('[book_job] Could not load booking_requests leads:', bookings.error.message);
  }
  if (customers.error) {
    console.warn('[book_job] Could not load customer leads:', customers.error.message);
  }

  return [
    ...(bookings.data ?? []).map((row) => mapLeadRow(row, 'booking_requests')),
    ...(customers.data ?? []).map((row) => mapLeadRow(row, 'customers')),
  ];
}

export async function POST(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (!cronAuth.ok) {
    cronUnauthorizedLog(cronAuth.reason);
    return unauthorized();
  }

  const started = Date.now();
  const results = {
    event: BOOK_JOB_EVENT_NAME,
    jobsSeen: 0,
    fired: 0,
    skippedNotScheduled: 0,
    skippedAlreadyConverted: 0,
    skippedAlreadyOnSchedule: 0,
    skippedBootstrap: 0,
    skippedMissingSecret: 0,
    errors: [] as string[],
  };

  try {
    const supabase = createServiceClient();
    const jobs = await fetchRecentlyUpdatedJobs();
    results.jobsSeen = jobs.length;

    if (jobs.length === 0) {
      return NextResponse.json({
        success: true,
        results,
        duration_ms: Date.now() - started,
      });
    }

    const jobIds = jobs.map((job) => job.id);
    const [conversionsRes, stateRes, leads] = await Promise.all([
      supabase.from('book_job_conversions').select('jobber_job_id').in('jobber_job_id', jobIds),
      supabase
        .from('jobber_job_schedule_state')
        .select('jobber_job_id, is_scheduled')
        .in('jobber_job_id', jobIds),
      loadRecentWebsiteLeads(supabase),
    ]);

    const converted = new Set((conversionsRes.data ?? []).map((row: any) => row.jobber_job_id));
    const previous = new Map(
      (stateRes.data ?? []).map((row: any) => [row.jobber_job_id as string, Boolean(row.is_scheduled)])
    );

    for (const job of jobs) {
      const scheduled = isJobScheduled(job);
      const decision = decideBookJob({
        isScheduled: scheduled,
        alreadyConverted: converted.has(job.id),
        previouslyScheduled: previous.has(job.id) ? Boolean(previous.get(job.id)) : null,
        createdRecently: jobCreatedRecently(job.createdAt),
      });

      await supabase.from('jobber_job_schedule_state').upsert({
        jobber_job_id: job.id,
        is_scheduled: scheduled,
        jobber_created_at: job.createdAt ?? null,
        last_seen_at: new Date().toISOString(),
      });

      if (!decision.emit) {
        if (decision.reason === 'not_scheduled') results.skippedNotScheduled += 1;
        else if (decision.reason === 'already_converted') results.skippedAlreadyConverted += 1;
        else if (decision.reason === 'already_on_schedule') results.skippedAlreadyOnSchedule += 1;
        else results.skippedBootstrap += 1;
        continue;
      }

      const contact = clientContactFromJob(job);
      const match = matchWebsiteLead(leads, contact);
      const payload = buildBookJobPayload({
        jobberJobId: job.id,
        lead: match?.lead ?? null,
        jobberEmail: contact.emails?.map(normalizeEmail).find(Boolean) ?? null,
        jobberPhone: contact.phones?.map(normalizePhone).find(Boolean) ?? null,
        valueUsd: jobValueUsd(job),
      });

      const { error: insertError } = await supabase.from('book_job_conversions').insert({
        jobber_job_id: job.id,
        booking_request_id: match?.lead.source === 'booking_requests' ? match.lead.id : null,
        customer_id: match?.lead.source === 'customers' ? match.lead.id : null,
        client_id: payload.client_id,
        client_id_source: payload.events[0].params.client_id_source,
        matched_by: match?.matchedBy ?? null,
      });

      if (insertError) {
        if (insertError.code === '23505') {
          results.skippedAlreadyConverted += 1;
          continue;
        }
        results.errors.push(`insert ${job.id}: ${insertError.message}`);
        continue;
      }

      converted.add(job.id);

      const sent = await sendBookJobEvent(payload);
      if (sent.skipped === 'missing_secret') {
        results.skippedMissingSecret += 1;
        await supabase.from('book_job_conversions').delete().eq('jobber_job_id', job.id);
        converted.delete(job.id);
        continue;
      }

      if (!sent.ok) {
        results.errors.push(`mp ${job.id}: HTTP ${sent.status}`);
        await supabase.from('book_job_conversions').delete().eq('jobber_job_id', job.id);
        converted.delete(job.id);
        continue;
      }

      results.fired += 1;
      console.log('[book_job] Fired Measurement Protocol event', {
        jobber_job_id: job.id,
        reason: decision.reason,
        matched_by: match?.matchedBy ?? null,
        client_id_source: payload.events[0].params.client_id_source,
      });
    }

    return NextResponse.json({
      success: results.errors.length === 0,
      results,
      duration_ms: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    console.error('[book_job] Cron failed:', message);
    return NextResponse.json(
      { error: 'Failed to sync Jobber book_job conversions', results },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
