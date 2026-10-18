import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import {
  ADS_CALL_VOICE_LOOKBACK_DAYS,
  ADS_CALLS_TIME_REPAIR_KEY,
  backfillPartyPatch,
  importAdsCalls,
  parseVoiceActivities,
  customerPhoneOrFilter,
  phoneLookupVariants,
  planAdsCallTimeRepairs,
  planNullPhoneRestores,
  planVoiceIdFills,
  voiceActivityStartIso,
  type AdsCallResolution,
  type PhoneParty,
} from '@/lib/ads/call-match';
import { customerAdsPatch, type CustomerAdsState } from '@/lib/ads/lead-tag';
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
import { ADS_CALL_PHONE_BACKFILL_20261014 } from '@/lib/ads/ads-call-phone-backfill-20261014';
import { findExistingClient, searchClientsByPhone } from '@/lib/jobber/quotes';
import { normalizePhone } from '@/lib/ads/book-job';

export const dynamic = 'force-dynamic';

const CUSTOMER_COLUMNS =
  'id, phone, lead_source, lead_source_detail, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, gbraid, wbraid, ga_client_id, ga_session_id';

const JOBBER_LOOKUPS_PER_RUN = 25;

type CustomerRow = CustomerAdsState & { id: string; phone: string | null };

function missingColumn(error: { message?: string } | null | undefined, column: string): boolean {
  const message = error?.message || '';
  return message.includes(column) && /column|schema cache|could not find/i.test(message);
}

function partyFromCustomer(row: CustomerRow): PhoneParty {
  return { id: String(row.id), phone: row.phone, kind: 'customer' };
}

async function selectByPhone(db: any, table: string, columns: string, phone: string, extra?: (query: any) => any) {
  const phoneOr = customerPhoneOrFilter(phone);
  if (!phoneOr) return { data: [], error: null };
  const run = (query: any) => (extra ? extra(query) : query);
  const first = await run(db.from(table).select(columns).or(phoneOr).order('created_at', { ascending: false }).limit(5));
  if (!first.error) return first;
  const digits = phoneLookupVariants(phone).filter((value) => /^\d+$/.test(value));
  console.warn(`[ads_calls] ${table} phone filter failed, retrying 10- and 11-digit match:`, first.error.message);
  if (!digits.length) return first;
  return run(db.from(table).select(columns).in('phone', digits).order('created_at', { ascending: false }).limit(5));
}

async function findCustomerByPhone(db: any, phone: string): Promise<CustomerRow | null> {
  const national = normalizePhone(phone);
  if (!national) return null;
  const { data, error } = await selectByPhone(db, 'customers', CUSTOMER_COLUMNS, phone);
  if (error) {
    console.warn('[ads_calls] Customer phone lookup failed:', error.message);
  } else {
    const hit = (data ?? []).find((row: CustomerRow) => normalizePhone(row.phone) === national);
    if (hit) return hit;
  }

  const bookings = await selectByPhone(db, 'booking_requests', 'customer_id, phone', phone, (query) =>
    query.not('customer_id', 'is', null)
  );
  if (bookings.error) {
    console.warn('[ads_calls] Booking phone lookup failed:', bookings.error.message);
    return null;
  }
  const booking = (bookings.data ?? []).find(
    (row: { phone: string | null; customer_id: string | null }) =>
      normalizePhone(row.phone) === national && row.customer_id
  );
  if (!booking?.customer_id) return null;
  const customer = await db.from('customers').select(CUSTOMER_COLUMNS).eq('id', booking.customer_id).maybeSingle();
  if (customer.error) {
    console.warn('[ads_calls] Could not load booking customer:', customer.error.message);
  }
  if (customer.data) return customer.data as CustomerRow;
  return { id: String(booking.customer_id), phone: national };
}

async function readTimeLedger(db: any): Promise<{ ok: boolean; resources: Set<string> }> {
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', ADS_CALLS_TIME_REPAIR_KEY)
    .maybeSingle();
  if (error) {
    console.warn('[ads_calls] Could not read time-repair ledger:', error.message);
    return { ok: false, resources: new Set() };
  }
  const resources = data?.value?.resources;
  const set = new Set<string>();
  if (Array.isArray(resources)) {
    for (const resource of resources) {
      if (typeof resource === 'string' && resource) set.add(resource);
    }
  }
  return { ok: true, resources: set };
}

async function writeTimeLedger(db: any, resources: Set<string>): Promise<boolean> {
  const { error } = await db.from('settings').upsert(
    {
      key: ADS_CALLS_TIME_REPAIR_KEY,
      value: { resources: Array.from(resources), at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );
  if (error) {
    console.warn('[ads_calls] Could not save time-repair ledger:', error.message);
    return false;
  }
  return true;
}

async function startedAtUtcColumnExists(db: any): Promise<boolean> {
  const { error } = await db.from('ads_calls').select('started_at_utc').limit(1);
  if (!error) return true;
  if (missingColumn(error, 'started_at_utc')) return false;
  console.warn('[ads_calls] started_at_utc probe failed:', error.message);
  return false;
}

async function repairExistingAdsCalls(
  db: any,
  input: {
    hasUtcColumn: boolean;
    imported: Set<string>;
    lookupCustomer: (phone: string) => Promise<PhoneParty | null>;
    lookupJobber: (phone: string) => Promise<PhoneParty | null>;
    tagCustomer: (customerId: string, campaign: string | null, keyword: string | null) => Promise<void>;
  }
): Promise<{ repairedTimes: number; linkedCustomers: number; linkedJobber: number; repairErrors: string[] }> {
  const repaired = { repairedTimes: 0, linkedCustomers: 0, linkedJobber: 0, repairErrors: [] as string[] };
  const ledger = await readTimeLedger(db);
  let ledgerWritable = ledger.ok;
  const alreadyCorrect = new Set<string>(ledger.resources);
  for (const resource of input.imported) alreadyCorrect.add(resource);
  // Record this run's upserts before any legacy shift. Those rows already
  // store a real UTC instant; a crash before this write must not be followed
  // by a shift of the same rows.
  if (ledgerWritable) ledgerWritable = await writeTimeLedger(db, alreadyCorrect);
  if (!ledgerWritable && !input.hasUtcColumn) {
    repaired.repairErrors.push('skipped time repair; ledger unreadable and started_at_utc is absent');
  }

  let hasUtcColumn = input.hasUtcColumn;
  const columns = [
    'call_view_resource',
    'started_at',
    'caller_phone',
    'customer_id',
    'jobber_client_id',
    'campaign_name',
    'keyword',
    ...(hasUtcColumn ? ['started_at_utc'] : []),
  ].join(', ');
  const loaded = await loadAdsCallRows(db, columns);
  if (loaded.error) {
    repaired.repairErrors.push(loaded.error);
    return repaired;
  }

  let stopTimeShifts = !ledgerWritable && !hasUtcColumn;
  for (const row of loaded.rows) {
    const resource = String(row.call_view_resource || '');
    if (!resource) continue;
    const patch: Record<string, unknown> = {};
    const inLedger = alreadyCorrect.has(resource);
    const flagged = hasUtcColumn && row.started_at_utc === true;
    if (hasUtcColumn && !flagged && inLedger) {
      // Corrected before the column existed. Mark it so a later pass does not shift it.
      patch.started_at_utc = true;
    } else if (
      !stopTimeShifts &&
      row.started_at &&
      !flagged &&
      !inLedger &&
      (ledgerWritable || hasUtcColumn)
    ) {
      const [timePatch] = planAdsCallTimeRepairs([row], new Set());
      if (timePatch) {
        patch.started_at = timePatch.started_at;
        if (hasUtcColumn) patch.started_at_utc = true;
      }
    }

    if (row.caller_phone && !row.customer_id && !row.jobber_client_id) {
      let party = await input.lookupCustomer(row.caller_phone);
      if (!party) party = await input.lookupJobber(row.caller_phone);
      const link = backfillPartyPatch(row, party);
      if (link) Object.assign(patch, link);
    }
    if (!Object.keys(patch).length) continue;
    patch.updated_at = new Date().toISOString();
    let { error } = await db.from('ads_calls').update(patch).eq('call_view_resource', resource);
    if (error && patch.started_at_utc && missingColumn(error, 'started_at_utc')) {
      delete patch.started_at_utc;
      hasUtcColumn = false;
      ({ error } = await db.from('ads_calls').update(patch).eq('call_view_resource', resource));
    }
    if (error) {
      repaired.repairErrors.push(`${resource}: ${error.message}`);
      continue;
    }
    if (patch.started_at) {
      repaired.repairedTimes += 1;
      alreadyCorrect.add(resource);
      if (ledgerWritable) {
        ledgerWritable = await writeTimeLedger(db, alreadyCorrect);
        if (!ledgerWritable) {
          stopTimeShifts = true;
          repaired.repairErrors.push('time-repair ledger save failed after a shift; further time shifts skipped');
        }
      }
    }
    if (typeof patch.customer_id === 'string') {
      repaired.linkedCustomers += 1;
      await input.tagCustomer(patch.customer_id, row.campaign_name ?? null, row.keyword ?? null);
    }
    if (typeof patch.jobber_client_id === 'string') repaired.linkedJobber += 1;
  }
  if (ledgerWritable) await writeTimeLedger(db, alreadyCorrect);
  return repaired;
}

async function loadAdsCallRows(db: any, columns: string): Promise<{ rows: any[]; error: string | null }> {
  const rows: any[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await db.from('ads_calls').select(columns).range(from, from + 999);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { rows, error: null };
}

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
        // call_view includes the whole Pacific boundary day. A rolling
        // now-30d start drops that morning, and the upsert used to write
        // caller_phone null over a phone resolved on an earlier run.
        const start = voiceActivityStartIso(new Date(), ADS_CALL_VOICE_LOOKBACK_DAYS);
        voiceCalls = parseVoiceActivities(await fetchVoiceActivityPayload(voice, fetch, start, 80));
      } catch (error) {
        voiceError = error instanceof Error ? error.message : 'voice log failed';
        console.warn('[ads_calls] Voice log skipped:', voiceError);
      }
    } else {
      voiceError = 'GOOGLE_VOICE_REFRESH_TOKEN is not set';
    }

    const supabase = createServiceClient();
    const db = supabase as any;
    const customerCache = new Map<string, CustomerRow | null>();
    const tagged = new Set<string>();
    const jobberNotes: string[] = [];
    let jobberLookups = 0;
    let jobberCapped = 0;
    let mirrorWarned = false;
    const jobberCache = new Map<string, PhoneParty | null>();

    async function lookupCustomer(phone: string): Promise<PhoneParty | null> {
      const national = normalizePhone(phone);
      if (!national) return null;
      if (!customerCache.has(national)) {
        customerCache.set(national, await findCustomerByPhone(db, phone));
      }
      const row = customerCache.get(national);
      return row ? partyFromCustomer(row) : null;
    }

    async function lookupJobber(phone: string): Promise<PhoneParty | null> {
      const national = normalizePhone(phone);
      if (!national) return null;
      if (jobberCache.has(national)) return jobberCache.get(national) ?? null;
      const remember = (party: PhoneParty | null) => {
        jobberCache.set(national, party);
        return party;
      };
      if (!mirrorWarned) {
        try {
          const mirror = await db.from('jobber_clients').select('id').contains('phones_digits', [national]).limit(1);
          if (mirror.error) {
            mirrorWarned = true;
            const message = `Jobber mirror lookup failed: ${mirror.error.message}`;
            jobberNotes.push(message);
            console.warn('[ads_calls]', message);
          } else if (mirror.data?.[0]?.id) {
            return remember({ id: String(mirror.data[0].id), phone: national, kind: 'jobber_client' });
          }
        } catch (error) {
          mirrorWarned = true;
          const message = error instanceof Error ? error.message : 'mirror lookup failed';
          jobberNotes.push(`Jobber mirror lookup failed: ${message}`);
          console.warn('[ads_calls] Jobber mirror lookup failed:', message);
        }
      }
      if (jobberLookups >= JOBBER_LOOKUPS_PER_RUN) {
        jobberCapped += 1;
        return remember(null);
      }
      jobberLookups += 1;
      try {
        const clients = await searchClientsByPhone(national);
        const found = findExistingClient(clients, { phone: national });
        if (!found) {
          jobberNotes.push(`${national}: Jobber search returned no phone match (term ${national.slice(-7)})`);
          return remember(null);
        }
        return remember({ id: found.id, phone: national, kind: 'jobber_client' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Jobber search failed';
        const why = /throttl|rate|cost/i.test(message) ? `throttled: ${message}` : message;
        jobberNotes.push(`${national}: ${why}`);
        console.warn(`[ads_calls] Jobber phone search failed for ${national}:`, why);
        return remember(null);
      }
    }

    async function tagCustomer(customerId: string, campaign: string | null, keyword: string | null) {
      if (tagged.has(customerId)) return;
      let current: CustomerRow | null = null;
      for (const row of customerCache.values()) {
        if (row && String(row.id) === customerId) current = row;
      }
      if (!current) {
        const loaded = await db.from('customers').select(CUSTOMER_COLUMNS).eq('id', customerId).maybeSingle();
        if (loaded.error) console.warn('[ads_calls] Could not load customer to tag:', loaded.error.message);
        current = (loaded.data as CustomerRow | null) ?? null;
      }
      const patch = customerAdsPatch(current, {
        lead_source: 'google_ads',
        campaign,
        keyword,
        utms: {
          utm_source: 'google',
          utm_medium: 'cpc',
          utm_campaign: campaign,
          utm_term: keyword,
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
      tagged.add(customerId);
      const { error: updateError } = await db.from('customers').update(patch).eq('id', customerId);
      if (updateError) console.warn('[ads_calls] Could not tag customer:', updateError.message);
    }

    let hasUtcColumn = await startedAtUtcColumnExists(db);
    const existingLoad = await loadAdsCallRows(
      db,
      'call_view_resource, started_at, duration_seconds, campaign_name, caller_phone, voice_call_id, customer_id, jobber_client_id, match_method'
    );
    if (existingLoad.error) {
      throw new Error(`refusing to upsert ads_calls; could not read existing rows: ${existingLoad.error}`);
    }
    const existing = existingLoad.rows as Array<AdsCallResolution & {
      started_at: string | null;
      duration_seconds: number | null;
      campaign_name: string | null;
    }>;
    const imported = new Set<string>();
    const savedVoiceIds = new Set<string>();
    const savedPhones = new Map<string, string | null>();
    const result = await importAdsCalls({
      drafts,
      voiceCalls,
      parties: [],
      existing,
      lookupCustomer,
      lookupJobber,
      save: async (row) => {
        const payload = hasUtcColumn ? { ...row, started_at_utc: true } : row;
        let { error } = await db.from('ads_calls').upsert(payload, { onConflict: 'call_view_resource' });
        if (error && hasUtcColumn && missingColumn(error, 'started_at_utc')) {
          hasUtcColumn = false;
          ({ error } = await db.from('ads_calls').upsert(row, { onConflict: 'call_view_resource' }));
        }
        if (error) throw new Error(error.message);
        imported.add(row.call_view_resource);
        savedPhones.set(row.call_view_resource, row.caller_phone);
        if (row.voice_call_id) savedVoiceIds.add(row.voice_call_id);
        if (row.customer_id) await tagCustomer(row.customer_id, row.campaign_name, row.keyword);
      },
    });

    let restoredPhones = 0;
    const restoreErrors: string[] = [];
    // Snapshot fallback still applies when Voice failed: it only fills rows that are still null.
    {
      const candidates = existing.filter((row) => !savedPhones.get(row.call_view_resource));
      for (const row of existing) {
        if (row.caller_phone && row.voice_call_id) savedVoiceIds.add(row.voice_call_id);
      }
      const restores = planNullPhoneRestores(candidates, voiceError ? [] : voiceCalls, {
        usedVoiceIds: savedVoiceIds,
        snapshots: ADS_CALL_PHONE_BACKFILL_20261014,
      });
      for (const patch of restores) {
        const { data, error } = await db
          .from('ads_calls')
          .update({
            caller_phone: patch.caller_phone,
            voice_call_id: patch.voice_call_id,
            match_method: patch.match_method,
            updated_at: new Date().toISOString(),
          })
          .eq('call_view_resource', patch.call_view_resource)
          .is('caller_phone', null)
          .select('call_view_resource');
        if (error) restoreErrors.push(`${patch.call_view_resource}: ${error.message}`);
        else restoredPhones += data?.length ?? 0;
        if (patch.voice_call_id) savedVoiceIds.add(patch.voice_call_id);
      }
      if (!voiceError) {
        const phoneNow = new Map(existing.map((row) => [row.call_view_resource, row.caller_phone]));
        for (const [resource, phone] of savedPhones) phoneNow.set(resource, phone);
        for (const patch of restores) phoneNow.set(patch.call_view_resource, patch.caller_phone);
        const voiceFills = planVoiceIdFills(
          existing.map((row) => ({
            call_view_resource: row.call_view_resource,
            started_at: row.started_at,
            duration_seconds: row.duration_seconds,
            campaign_name: row.campaign_name,
            caller_phone: phoneNow.get(row.call_view_resource) ?? row.caller_phone,
            voice_call_id: row.voice_call_id,
          })),
          voiceCalls,
          savedVoiceIds
        );
        for (const fill of voiceFills) {
          const { error } = await db
            .from('ads_calls')
            .update({ voice_call_id: fill.voice_call_id, match_method: fill.match_method, updated_at: new Date().toISOString() })
            .eq('call_view_resource', fill.call_view_resource)
            .is('voice_call_id', null);
          if (error) restoreErrors.push(`${fill.call_view_resource}: ${error.message}`);
        }
      }
      if (restoredPhones || restoreErrors.length) {
        console.log(`[ads_calls] restored ${restoredPhones} caller phones`);
      }
    }

    const repair = await repairExistingAdsCalls(db, {
      hasUtcColumn,
      imported,
      lookupCustomer,
      lookupJobber,
      tagCustomer,
    });
    if (jobberCapped) {
      jobberNotes.push(`Jobber live lookup cap (${JOBBER_LOOKUPS_PER_RUN}) reached; ${jobberCapped} caller(s) not searched`);
    }

    return NextResponse.json({
      success: true,
      ...result,
      restoredPhones,
      restoreErrors: restoreErrors.slice(0, 20),
      voiceError,
      jobberLookups,
      jobberNotes: jobberNotes.slice(0, 30),
      ...repair,
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
