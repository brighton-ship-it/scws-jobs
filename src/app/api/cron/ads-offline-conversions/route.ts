import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import {
  googleAdsConfig,
  refreshGoogleAccessToken,
  uploadClickConversions,
  uploadConversionAdjustments,
} from '@/lib/ads/google-ads-api';
import { candidatesFromBookedJobs } from '@/lib/ads/booked-jobs';
import {
  offlineUploadMode,
  runOfflineImport,
  type AttributedLead,
} from '@/lib/ads/offline-import';
import { fetchBookedJobs } from '@/lib/jobber/attribution-reads';
import { hashEmail, hashPhoneE164 } from '@/lib/ads/offline-conversion';
import {
  buildRestatement,
  nextRestatement,
  sentStateOf,
  type SentState,
} from '@/lib/ads/conversion-stages';
import { selectLeadRows } from '@/lib/ads/lead-query';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (!cronAuth.ok) {
    cronUnauthorizedLog(cronAuth.reason);
    return unauthorized();
  }

  const started = Date.now();
  const mode = offlineUploadMode();
  try {
    const supabase = createServiceClient();
    const db = supabase as any;
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const leadColumns = [
      'id',
      'phone',
      'email',
      'created_at',
      'gclid',
      'gbraid',
      'wbraid',
      'ga_client_id',
      'ga_session_id',
      'lead_source',
      'utm_campaign',
      'utm_term',
    ];

    const [bookings, customers, calls, invoices, existing] = await Promise.all([
      selectLeadRows(db.from('booking_requests'), leadColumns, since),
      selectLeadRows(db.from('customers'), leadColumns, since),
      db.from('ads_calls').select('caller_phone, campaign_name, started_at').not('caller_phone', 'is', null).limit(5000),
      fetchBookedJobs(),
      db.from('ads_offline_conversions').select('jobber_job_id, status, value_usd, payload').limit(5000),
    ]);

    const leads: AttributedLead[] = [
      ...(bookings.data ?? []).map((row) => mapLead(row, 'booking_requests')),
      ...(customers.data ?? []).map((row) => mapLead(row, 'customers')),
    ];
    if (bookings.error) console.warn('[ads_offline] booking_requests:', bookings.error.message);
    if (customers.error) console.warn('[ads_offline] customers:', customers.error.message);

    const { candidates, excluded } = candidatesFromBookedJobs({
      jobs: invoices,
      leads,
      adsCalls: (calls.data ?? []).map(
        (row: { caller_phone: string | null; campaign_name: string | null; started_at: string | null }) => ({
          phone: row.caller_phone,
          campaign: row.campaign_name,
          startedAt: row.started_at,
        })
      ),
    });

    const config = googleAdsConfig();
    const stagesByJob = new Map(candidates.map((c) => [c.jobberJobId, c.stages]));
    const existingRows: Array<{ jobber_job_id: string; status: string; value_usd: number | null; payload: unknown }> =
      existing.data ?? [];
    const result = await runOfflineImport({
      candidates,
      existing: existingRows,
      mode,
      conversionAction: config?.conversionAction ?? null,
      save: async (row) => {
        const { error } = await db.from('ads_offline_conversions').upsert(
          {
            jobber_job_id: row.jobber_job_id,
            invoice_ids: row.invoice_ids,
            conversion_at: row.conversion_at,
            value_usd: row.value_usd,
            gclid: row.gclid,
            gbraid: row.gbraid,
            wbraid: row.wbraid,
            signal: row.signal,
            status: row.status,
            mode: row.mode,
            // payload = { conversion, stages, sent_stage, sent_value }. Stage state lives
            // here so no schema change is needed. Nothing is "sent" in dry run.
            payload: {
              conversion: row.payload,
              stages: stagesByJob.get(row.jobber_job_id) ?? null,
              sent_stage: row.status === 'uploaded' ? 1 : null,
              sent_value: row.status === 'uploaded' ? row.value_usd : null,
            },
            google_response: row.google_response ?? null,
            error: row.error,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'jobber_job_id' }
        );
        if (error) throw new Error(error.message);
      },
      upload:
        mode === 'live' && config
          ? async (conversions) => {
              const token = await refreshGoogleAccessToken(config);
              return uploadClickConversions(config, conversions, fetch, token);
            }
          : undefined,
    });

    // Stages 2 and 3: restate upward only. Dry run assumes the booking value was sent.
    const existingById = new Map(existingRows.map((r) => [r.jobber_job_id, r]));
    const stageRows: Array<Record<string, unknown>> = [];
    const toAdjust: Array<{ jobId: string; step: NonNullable<ReturnType<typeof nextRestatement>>; adjustment: unknown; payload: Record<string, unknown> }> = [];
    for (const c of candidates) {
      const row = existingById.get(c.jobberJobId);
      const uploaded = row?.status === 'uploaded';
      const sent: SentState | null =
        mode === 'live' ? (uploaded ? sentStateOf(row) : null) : { stage: 1, value: c.stages.booking };
      const step = sent ? nextRestatement(c.stages, sent) : null;
      stageRows.push({
        job_id: c.jobberJobId,
        client: c.clientName,
        booking_value_usd: c.stages.booking,
        approved_value_usd: c.stages.approved,
        invoiced_value_usd: c.stages.invoiced,
        next_restatement: step ? { stage: step.stage, value_usd: step.value, from_usd: sent?.value } : null,
        restatable: Boolean(c.gclid || c.gbraid || c.wbraid || c.email || c.phone),
      });
      if (mode === 'live' && config?.conversionAction && step && uploaded) {
        const adjustment = buildRestatement(config.conversionAction, {
          jobberJobId: c.jobberJobId,
          value: step.value,
          nowIso: new Date().toISOString(),
          hashedEmail: hashEmail(c.email),
          hashedPhone: hashPhoneE164(c.phone),
        });
        toAdjust.push({ jobId: c.jobberJobId, step, adjustment, payload: (row?.payload as Record<string, unknown>) ?? {} });
      }
    }
    const adjustErrors: string[] = [];
    let restated = 0;
    if (toAdjust.length && config) {
      const token = await refreshGoogleAccessToken(config);
      const res = await uploadConversionAdjustments(
        config,
        toAdjust.map((a) => a.adjustment),
        fetch,
        token
      );
      const partial =
        res.body && typeof res.body === 'object' && 'partialFailureError' in (res.body as Record<string, unknown>);
      const ok = res.ok && !partial;
      for (const a of toAdjust) {
        const patch = ok
          ? {
              value_usd: a.step.value,
              payload: { ...a.payload, stages: stagesByJob.get(a.jobId) ?? null, sent_stage: a.step.stage, sent_value: a.step.value },
              google_response: res.body,
              error: null,
            }
          : { error: `Restatement HTTP ${res.status}`, google_response: res.body };
        const { error } = await db
          .from('ads_offline_conversions')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('jobber_job_id', a.jobId);
        if (error) adjustErrors.push(`${a.jobId}: ${error.message}`);
        if (ok) restated += 1;
        else adjustErrors.push(`${a.jobId}: restatement failed (${res.status})`);
      }
    }
    const sum = (key: string) =>
      Math.round(stageRows.reduce((t, r) => t + (Number(r[key]) || 0), 0) * 100) / 100;

    return NextResponse.json({
      stages: {
        rows: stageRows,
        totals: {
          booking_usd: sum('booking_value_usd'),
          // Cumulative view: a job with no approved/invoiced value yet carries its prior stage.
          approved_usd:
            Math.round(candidates.reduce((t, c) => t + (c.stages.approved ?? c.stages.booking), 0) * 100) / 100,
          invoiced_usd:
            Math.round(
              candidates.reduce((t, c) => t + (c.stages.invoiced ?? c.stages.approved ?? c.stages.booking), 0) * 100
            ) / 100,
        },
        restated,
        errors: adjustErrors,
      },
      success: result.errors.length === 0 && adjustErrors.length === 0,
      mode,
      trigger: 'booked_job',
      jobs_seen: invoices.length,
      candidates: candidates.length,
      total_value_usd: Math.round(candidates.reduce((sum, c) => sum + c.valueUsd, 0) * 100) / 100,
      rows: candidates.map((c) => ({
        job_id: c.jobberJobId,
        client: c.clientName,
        booked_at: c.conversionAt,
        value_usd: c.valueUsd,
        value_source: c.valueSource,
        signal: c.signal,
      })),
      excluded,
      ...result,
      duration_ms: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    console.error('[ads_offline] Cron failed:', message);
    return NextResponse.json({ error: message, mode }, { status: 500 });
  }
}

function mapLead(row: Record<string, unknown>, source: AttributedLead['source']): AttributedLead {
  return {
    id: String(row.id),
    source,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    created_at: String(row.created_at),
    gclid: (row.gclid as string | null) ?? null,
    gbraid: (row.gbraid as string | null) ?? null,
    wbraid: (row.wbraid as string | null) ?? null,
    ga_client_id: (row.ga_client_id as string | null) ?? null,
    ga_session_id: (row.ga_session_id as string | null) ?? null,
    lead_source: (row.lead_source as string | null) ?? null,
    utm_campaign: (row.utm_campaign as string | null) ?? null,
    utm_term: (row.utm_term as string | null) ?? null,
  };
}

export async function GET(request: NextRequest) {
  return POST(request);
}
