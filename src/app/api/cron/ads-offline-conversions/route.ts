import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import {
  googleAdsConfig,
  refreshGoogleAccessToken,
  uploadClickConversions,
} from '@/lib/ads/google-ads-api';
import {
  candidatesFromInvoices,
  offlineUploadMode,
  runOfflineImport,
  type AttributedLead,
} from '@/lib/ads/offline-import';
import { fetchRecentInvoices } from '@/lib/jobber/attribution-reads';
import { selectLeadRows } from '@/lib/ads/lead-query';

export const dynamic = 'force-dynamic';

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
      db.from('ads_calls').select('caller_phone, campaign_name').not('caller_phone', 'is', null).limit(2000),
      fetchRecentInvoices(),
      db.from('ads_offline_conversions').select('jobber_job_id, status').limit(5000),
    ]);

    const leads: AttributedLead[] = [
      ...(bookings.data ?? []).map((row) => mapLead(row, 'booking_requests')),
      ...(customers.data ?? []).map((row) => mapLead(row, 'customers')),
    ];
    if (bookings.error) console.warn('[ads_offline] booking_requests:', bookings.error.message);
    if (customers.error) console.warn('[ads_offline] customers:', customers.error.message);

    const candidates = candidatesFromInvoices({
      invoices,
      leads,
      adsPhones: (calls.data ?? []).map((row: { caller_phone: string | null; campaign_name: string | null }) => ({
        phone: row.caller_phone,
        campaign: row.campaign_name,
      })),
    });

    const config = googleAdsConfig();
    const result = await runOfflineImport({
      candidates,
      existing: existing.data ?? [],
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
            payload: row.payload,
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

    return NextResponse.json({
      success: result.errors.length === 0,
      mode,
      invoices: invoices.length,
      candidates: candidates.length,
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
