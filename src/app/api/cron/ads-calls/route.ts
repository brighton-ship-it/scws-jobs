import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import { importAdsCalls, parseVoiceActivities } from '@/lib/ads/call-match';
import { customerAdsPatch } from '@/lib/ads/lead-tag';
import {
  callViewGaql,
  googleAdsConfig,
  googleAdsSearch,
  parseCallViewRow,
  refreshGoogleAccessToken,
  searchResultRows,
  type AdsCallDraft,
} from '@/lib/ads/google-ads-api';
import { fetchVoiceActivityPayload, voiceLogConfig } from '@/lib/ads/voice-log';
import { findExistingClient, searchClients } from '@/lib/jobber/quotes';
import { normalizePhone } from '@/lib/ads/book-job';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

async function searchCallViews(env: NodeJS.ProcessEnv = process.env) {
  const config = googleAdsConfig(env);
  if (!config) return { config: null, drafts: [] as AdsCallDraft[] };
  const token = await refreshGoogleAccessToken(config);
  const drafts: AdsCallDraft[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const payload = await googleAdsSearch(config, callViewGaql(), fetch, token, pageToken);
    for (const row of searchResultRows(payload)) {
      const parsed = parseCallViewRow(row);
      if (parsed) drafts.push(parsed);
    }
    const next =
      payload && typeof payload === 'object'
        ? (payload as { nextPageToken?: unknown }).nextPageToken
        : null;
    pageToken = typeof next === 'string' && next ? next : null;
    if (!pageToken) break;
  }
  return { config, drafts };
}

export async function POST(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (!cronAuth.ok) {
    cronUnauthorizedLog(cronAuth.reason);
    return unauthorized();
  }

  const started = Date.now();
  try {
    const { drafts } = await searchCallViews();
    if (!googleAdsConfig()) {
      return NextResponse.json({
        success: true,
        skipped: 'google_ads_not_configured',
        duration_ms: Date.now() - started,
      });
    }

    let voiceCalls: ReturnType<typeof parseVoiceActivities> = [];
    let voiceError: string | null = null;
    const voice = voiceLogConfig();
    if (voice) {
      try {
        const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        voiceCalls = parseVoiceActivities(await fetchVoiceActivityPayload(voice, fetch, start));
      } catch (error) {
        voiceError = error instanceof Error ? error.message : 'voice log failed';
        console.warn('[ads_calls] Voice log skipped:', voiceError);
      }
    } else {
      voiceError = 'GOOGLE_VOICE_REFRESH_TOKEN is not set';
    }

    const supabase = createServiceClient();
    const db = supabase as any;
    const { data: customers, error: customerError } = await db
      .from('customers')
      .select('id, phone, lead_source, utm_campaign, utm_term, gclid')
      .not('phone', 'is', null)
      .limit(5000);
    if (customerError) {
      console.warn('[ads_calls] Could not load customers:', customerError.message);
    }

    const parties = (customers ?? []).map((row: { id: string; phone: string | null }) => ({
      id: String(row.id),
      phone: row.phone,
      kind: 'customer' as const,
    }));
    let jobberLookups = 0;

    const tagged = new Set<string>();
    const result = await importAdsCalls({
      drafts,
      voiceCalls,
      parties,
      lookupJobber: async (phone) => {
        const national = normalizePhone(phone);
        if (!national || jobberLookups >= 25) return null;
        jobberLookups += 1;
        const clients = await searchClients(national);
        const found = findExistingClient(clients, { phone: national });
        return found ? { id: found.id, phone: national, kind: 'jobber_client' as const } : null;
      },
      save: async (row) => {
        const { error } = await db.from('ads_calls').upsert(row, { onConflict: 'call_view_resource' });
        if (error) throw new Error(error.message);
        if (!row.customer_id || tagged.has(row.customer_id)) return;
        const current = (customers ?? []).find(
          (customer: { id: string }) => String(customer.id) === row.customer_id
        );
        const patch = customerAdsPatch(current, {
          lead_source: 'google_ads',
          campaign: row.campaign_name,
          keyword: row.keyword,
          utms: {
            utm_source: 'google',
            utm_medium: 'cpc',
            utm_campaign: row.campaign_name,
            utm_term: row.keyword,
            utm_content: null,
          },
          clickIds: {
            gclid: null,
            gbraid: null,
            wbraid: null,
            ga_client_id: null,
            ga_session_id: null,
          },
        });
        if (!Object.keys(patch).length) return;
        tagged.add(row.customer_id);
        const { error: updateError } = await db.from('customers').update(patch).eq('id', row.customer_id);
        if (updateError) console.warn('[ads_calls] Could not tag customer:', updateError.message);
      },
    });

    return NextResponse.json({
      success: true,
      ...result,
      voiceError,
      duration_ms: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    console.error('[ads_calls] Cron failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
