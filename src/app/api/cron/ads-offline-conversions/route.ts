import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import { googleAdsConfig, refreshGoogleAccessToken, uploadCallConversions } from '@/lib/ads/google-ads-api';
import { callTooRecent, e164, needsCallResend, toCallConversion, type CallInfo } from '@/lib/ads/call-conversions';
import {
  dmStatusLogLine,
  ingestEvents,
  ingestRequestId,
  retrieveRequestStatus,
  summarizeRequestStatus,
  type DmStatusSummary,
} from '@/lib/ads/data-manager';
import { candidatesFromBookedJobs } from '@/lib/ads/booked-jobs';
import {
  backfillFloorIso,
  needsStatusPoll,
  offlineUploadMode,
  requestIdFromRow,
  resendOrderId,
  runOfflineImport,
  statusUpdate,
  uploadedIdsToResend,
  type AttributedLead,
  type OfflinePlanRow,
} from '@/lib/ads/offline-import';
import { fetchBookedJobs } from '@/lib/jobber/attribution-reads';
import { nextRestatement, restatementAllowed, sentStateOf, type SentState } from '@/lib/ads/conversion-stages';
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
  const backfillDay = request.nextUrl.searchParams.get('backfillSince');
  let backfillFloor: string | null = null;
  if (backfillDay) {
    try {
      backfillFloor = backfillFloorIso(backfillDay);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'bad backfillSince';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }
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
      db.from('ads_offline_conversions').select('jobber_job_id, status, value_usd, payload, gclid, google_response').limit(5000),
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
      floorIso: backfillFloor ?? undefined,
    });

    const config = googleAdsConfig();
    async function refreshDataManagerToken(): Promise<string> {
      if (!config) throw new Error('Google Ads config missing');
      return refreshGoogleAccessToken({
        ...config,
        refreshToken: config.dataManagerRefreshToken,
        clientId: config.dataManagerClientId,
        clientSecret: config.dataManagerClientSecret,
      });
    }
    async function storeStatus(jobIds: string[], summary: DmStatusSummary): Promise<string[]> {
      const problems: string[] = [];
      for (const jobId of jobIds) {
        const prior = existingRows.find((row) => row.jobber_job_id === jobId);
        const patch = statusUpdate({
          payload: writtenPayload.get(jobId) ?? prior?.payload,
          gclid: prior?.gclid ?? null,
          summary,
        });
        const update: Record<string, unknown> = { payload: patch.payload, updated_at: new Date().toISOString() };
        if (patch.status) update.status = patch.status;
        if (patch.error !== undefined) update.error = patch.error;
        const { error } = await db.from('ads_offline_conversions').update(update).eq('jobber_job_id', jobId);
        if (error) problems.push(`${jobId}: ${error.message}`);
      }
      return problems;
    }
    async function pollRequestId(requestId: string, jobIds: string[]): Promise<string[]> {
      if (mode !== 'live' || !config || !requestId || jobIds.length === 0) return [];
      try {
        const token = await refreshDataManagerToken();
        const res = await retrieveRequestStatus(requestId, fetch, token);
        if (!res.ok) {
          console.log(`[ads_offline] datamanager requestId=${requestId} status=retrieve_http_${res.status}`);
          return [];
        }
        const summary = summarizeRequestStatus(res.body, requestId);
        console.log(dmStatusLogLine(summary));
        return storeStatus(jobIds, summary);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'status retrieve failed';
        console.log(`[ads_offline] datamanager requestId=${requestId} status=retrieve_failed`);
        return [`${requestId}: ${message}`];
      }
    }
    const stagesByJob = new Map(candidates.map((c) => [c.jobberJobId, c.stages]));
    const existingRows: Array<{
      jobber_job_id: string;
      status: string;
      value_usd: number | null;
      payload: unknown;
      gclid?: string | null;
      google_response?: unknown;
    }> = existing.data ?? [];
    const resendIds = backfillFloor ? uploadedIdsToResend(existingRows, candidates.map((c) => c.jobberJobId)) : undefined;
    if (resendIds) console.log(`[ads_offline] backfill since=${backfillDay} resend=${resendIds.size}`);
    // The original event carries the best value already known (invoice > approved quote > booking).
    const uploadedIds = new Set(existingRows.filter((r) => r.status === 'uploaded').map((r) => r.jobber_job_id));
    const firstStage = new Map<string, 1 | 2 | 3>();
    for (const c of candidates) {
      if (uploadedIds.has(c.jobberJobId) && !resendIds?.has(c.jobberJobId)) continue;
      const best = nextRestatement(c.stages, { stage: 1, value: c.stages.booking });
      if (best) {
        c.valueUsd = best.value;
        firstStage.set(c.jobberJobId, best.stage);
      }
    }
    const touched = new Set<string>();
    const writtenPayload = new Map<string, Record<string, unknown>>();
    const callJobIds = new Set<string>();
    const saveRow = async (row: OfflinePlanRow) => {
        touched.add(row.jobber_job_id);
        const prior = existingRows.find((r) => r.jobber_job_id === row.jobber_job_id);
        const payload: Record<string, unknown> = {
          ...(prior && !row.google_response && prior.payload && typeof prior.payload === 'object'
            ? (prior.payload as Record<string, unknown>)
            : {}),
          conversion: row.payload,
          stages: stagesByJob.get(row.jobber_job_id) ?? null,
          sent_stage: row.status === 'uploaded' ? (firstStage.get(row.jobber_job_id) ?? 1) : null,
          sent_value: row.status === 'uploaded' ? row.value_usd : null,
          call_upload: callJobIds.has(row.jobber_job_id) && row.status === 'uploaded' ? true : undefined,
          dm_request_id: callJobIds.has(row.jobber_job_id)
            ? null
            : ingestRequestId(row.google_response) ?? requestIdFromRow(prior ?? {}),
          dm_status: row.google_response ? null : (prior?.payload as { dm_status?: unknown } | null)?.dm_status ?? null,
        };
        writtenPayload.set(row.jobber_job_id, payload);
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
            payload,
            google_response: row.google_response ?? prior?.google_response ?? null,
            error: row.error,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'jobber_job_id' }
        );
        if (error) throw new Error(error.message);
      };

    // Won jobs from an Ads call go through UploadCallConversions (caller id + call start).
    // Unset GOOGLE_ADS_CALL_CONVERSION_ACTION keeps the previous Data Manager path.
    const callAction = mode === 'live' ? config?.callConversionAction ?? null : null;
    const callInfo = new Map<string, CallInfo>();
    let callResult: Awaited<ReturnType<typeof runOfflineImport>> | null = null;
    let mainCandidates = candidates;
    if (callAction && config) {
      const callCands = candidates.filter(
        (c) => c.signal === 'ads_call' && !c.gclid && !c.gbraid && !c.wbraid && e164(c.callerPhone) && c.callStartedAt
      );
      const tooRecent = new Set(callCands.filter((c) => callTooRecent({ callerPhone: c.callerPhone, callStartedAt: c.callStartedAt })).map((c) => c.jobberJobId));
      const ready = callCands.filter((c) => !tooRecent.has(c.jobberJobId));
      for (const c of ready) {
        callJobIds.add(c.jobberJobId);
        callInfo.set(c.jobberJobId, { callerPhone: c.callerPhone, callStartedAt: c.callStartedAt });
      }
      mainCandidates = candidates.filter((c) => !callJobIds.has(c.jobberJobId) && !tooRecent.has(c.jobberJobId));
      if (tooRecent.size) console.log(`[ads_offline] call conversions waiting 6h=${tooRecent.size}`);
      const callResend = new Set(
        existingRows.filter((r) => callJobIds.has(r.jobber_job_id) && needsCallResend(r)).map((r) => r.jobber_job_id)
      );
      callResult = await runOfflineImport({
        candidates: ready,
        existing: existingRows,
        mode,
        conversionAction: config.conversionAction ?? callAction,
        resendUploadedIds: callResend,
        save: saveRow,
        upload: async (conversions) => {
          const calls = conversions.map((c) => toCallConversion(callAction, c, callInfo.get(c.order_id)));
          const sendable = calls.filter((c): c is NonNullable<typeof c> => c != null);
          if (sendable.length !== calls.length) throw new Error('call conversion missing caller or start time');
          const token = await refreshGoogleAccessToken(config);
          const res = await uploadCallConversions(config, sendable, fetch, token);
          console.log(`[ads_offline] call conversions sent=${sendable.length} http=${res.status}`);
          return res;
        },
      });
    }

    const result = await runOfflineImport({
      candidates: mainCandidates,
      existing: existingRows,
      mode,
      conversionAction: config?.conversionAction ?? null,
      resendUploadedIds: resendIds,
      save: saveRow,
      upload:
        mode === 'live' && config
          ? async (conversions) => {
              // Data Manager API (Google Ads uploadClickConversions is closed to new integrations).
              // Does not send GA4 book_job. That import is conversion action 7735430525 and stays separate.
              const token = await refreshDataManagerToken();
              // Backfill re-sends never landed in Ads (sent without consent). Google may
              // dedupe the same transactionId, so a re-send uses a distinct id. The DB row
              // stays keyed on the Jobber job id, so a job is still one conversion.
              const sendable = conversions.map((c) =>
                resendIds?.has(c.order_id) ? { ...c, order_id: resendOrderId(c.order_id) } : c
              );
              return ingestEvents(config, sendable, fetch, token);
            }
          : undefined,
    });

    const statusErrors: string[] = [];
    const pending = new Map<string, string[]>();
    for (const row of existingRows) {
      if (touched.has(row.jobber_job_id) || !needsStatusPoll(row)) continue;
      const requestId = requestIdFromRow(row);
      if (!requestId) continue;
      const list = pending.get(requestId) ?? [];
      list.push(row.jobber_job_id);
      pending.set(requestId, list);
    }
    for (const [jobId, payload] of writtenPayload) {
      const requestId = typeof payload.dm_request_id === 'string' ? payload.dm_request_id : null;
      if (!requestId) continue;
      const list = pending.get(requestId) ?? [];
      if (!list.includes(jobId)) list.push(jobId);
      pending.set(requestId, list);
    }
    for (const [requestId, jobIds] of pending) {
      statusErrors.push(...(await pollRequestId(requestId, jobIds)));
    }

    // Value changes are not sent through Ads uploadConversionAdjustments. That API
    // returned CONVERSION_NOT_FOUND for every Data Manager event, including the ones
    // Google processed successfully, and it overwrote the request id.
    const existingById = new Map(existingRows.map((r) => [r.jobber_job_id, r]));
    const stageRows: Array<Record<string, unknown>> = [];
    let restatementsSkipped = 0;
    for (const c of candidates) {
      const row = existingById.get(c.jobberJobId);
      const uploaded = row?.status === 'uploaded' || touched.has(c.jobberJobId);
      const sent: SentState | null =
        mode === 'live' ? (uploaded ? sentStateOf(row) : null) : { stage: 1, value: c.stages.booking };
      const step = sent ? nextRestatement(c.stages, sent) : null;
      const allowed = restatementAllowed(row?.payload);
      if (mode === 'live' && step && row?.status === 'uploaded' && !resendIds?.has(c.jobberJobId) && !allowed) restatementsSkipped += 1;
      stageRows.push({
        job_id: c.jobberJobId,
        client: c.clientName,
        booking_value_usd: c.stages.booking,
        approved_value_usd: c.stages.approved,
        invoiced_value_usd: c.stages.invoiced,
        next_restatement: step && allowed ? { stage: step.stage, value_usd: step.value, from_usd: sent?.value } : null,
        restatement_skipped: Boolean(
          mode === 'live' && step && row?.status === 'uploaded' && !resendIds?.has(c.jobberJobId) && !allowed
        ),
        restatable: Boolean(c.gclid || c.gbraid || c.wbraid || c.email || c.phone),
      });
    }
    if (restatementsSkipped) {
      console.log(`[ads_offline] restatements skipped=${restatementsSkipped} reason=conversion_not_landed`);
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
        restated: 0,
        restatements_skipped: restatementsSkipped,
        errors: statusErrors,
      },
      success: result.errors.length === 0 && statusErrors.length === 0 && (callResult?.errors.length ?? 0) === 0,
      call_conversions: callResult
        ? { action: callAction, uploaded: callResult.uploaded, skipped: callResult.skipped, errors: callResult.errors }
        : null,
      mode,
      backfill_since: backfillDay,
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
