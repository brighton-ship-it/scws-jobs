/**
 * Join a Google Ads call_view row to a Voice call log by start time, then
 * to a CRM customer or Jobber client by phone. call_view does not include
 * the caller number or the keyword.
 */

import { normalizePhone } from './book-job.ts';
import type { AdsCallDraft } from './google-ads-api.ts';

export const CALL_TIME_WINDOW_MS = 30_000;
export const CALL_DURATION_TOLERANCE_SEC = 15;

export interface VoiceCall {
  id: string;
  startedAt: string;
  durationSeconds: number | null;
  callerPhone: string | null;
}

export interface PhoneParty {
  id: string;
  phone: string | null;
  kind: 'customer' | 'jobber_client';
}

const ADS_ACCOUNT_TIME_ZONE = process.env.GOOGLE_ADS_TIME_ZONE?.trim() || 'America/Los_Angeles';

/**
 * Google Ads call_view times look like "2026-10-07 15:33:23" in the ad
 * account time zone with no offset. Date.parse would read that as server
 * local time (UTC on Vercel), 7 to 8 hours off from the Voice log's UTC times.
 */
export function parseAdsDateTime(value: string | null | undefined, timeZone = ADS_ACCOUNT_TIME_ZONE): number {
  const text = (value || '').trim();
  if (!text) return Number.NaN;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(text)) return Date.parse(text);
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return Date.parse(text);
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  // Find the zone offset at that wall-clock moment.
  let guess = asUtc;
  for (let i = 0; i < 2; i += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    guess += asUtc - wall;
  }
  return guess;
}

export function matchAdsCallToVoice(
  call: AdsCallDraft,
  voiceCalls: VoiceCall[],
  excludeIds?: ReadonlySet<string>
): VoiceCall | null {
  const start = parseAdsDateTime(call.startedAt);
  if (!Number.isFinite(start)) return null;

  const ranked = voiceCalls
    .filter((voice) => !excludeIds?.has(voice.id))
    .map((voice) => {
      const voiceStart = Date.parse(voice.startedAt);
      const delta = Number.isFinite(voiceStart) ? Math.abs(voiceStart - start) : Number.POSITIVE_INFINITY;
      const durationDelta =
        call.durationSeconds == null || voice.durationSeconds == null
          ? 0
          : Math.abs(call.durationSeconds - voice.durationSeconds);
      return { voice, delta, durationDelta };
    })
    .filter((row) => row.delta <= CALL_TIME_WINDOW_MS && row.durationDelta <= CALL_DURATION_TOLERANCE_SEC)
    .sort((a, b) => a.delta - b.delta || a.durationDelta - b.durationDelta);

  return ranked[0]?.voice ?? null;
}

/**
 * One voice activity can sit inside the time window of two ad calls.
 * Assign the closest unused voice to each ad call so a single Voice log
 * row is not written onto two ads_calls rows.
 */
export function assignAdsVoices(drafts: AdsCallDraft[], voiceCalls: VoiceCall[]): Map<string, VoiceCall> {
  const candidates: Array<{ resource: string; voice: VoiceCall; delta: number; durationDelta: number }> = [];
  for (const call of drafts) {
    const start = parseAdsDateTime(call.startedAt);
    if (!Number.isFinite(start)) continue;
    for (const voice of voiceCalls) {
      const voiceStart = Date.parse(voice.startedAt);
      const delta = Number.isFinite(voiceStart) ? Math.abs(voiceStart - start) : Number.POSITIVE_INFINITY;
      const durationDelta =
        call.durationSeconds == null || voice.durationSeconds == null
          ? 0
          : Math.abs(call.durationSeconds - voice.durationSeconds);
      if (delta <= CALL_TIME_WINDOW_MS && durationDelta <= CALL_DURATION_TOLERANCE_SEC) {
        candidates.push({ resource: call.resourceName, voice, delta, durationDelta });
      }
    }
  }
  candidates.sort((a, b) => a.delta - b.delta || a.durationDelta - b.durationDelta);
  const usedVoice = new Set<string>();
  const usedDraft = new Set<string>();
  const assigned = new Map<string, VoiceCall>();
  for (const row of candidates) {
    if (usedVoice.has(row.voice.id) || usedDraft.has(row.resource)) continue;
    usedVoice.add(row.voice.id);
    usedDraft.add(row.resource);
    assigned.set(row.resource, row.voice);
  }
  return assigned;
}

/**
 * Stored customer phones are mixed: 10 digits (`7603052997`) and 11 digits
 * with a leading country code (`17603052997`), plus a few punctuation forms.
 * Query these exact values instead of preloading a row cap.
 */
export function phoneLookupVariants(phone: string | null | undefined): string[] {
  const national = normalizePhone(phone);
  if (!national) return [];
  const country = `1${national}`;
  const area = national.slice(0, 3);
  const prefix = national.slice(3, 6);
  const line = national.slice(6);
  const dashed = `${area}-${prefix}-${line}`;
  const dotted = `${area}.${prefix}.${line}`;
  const paren = `(${area}) ${prefix}-${line}`;
  return Array.from(
    new Set([
      national,
      country,
      `+${country}`,
      paren,
      dashed,
      dotted,
      `+1 ${paren}`,
      `1-${area}-${prefix}-${line}`,
    ])
  );
}

/** PostgREST `or` filter. Values are quoted so punctuation and a leading + survive. */
export function customerPhoneOrFilter(phone: string | null | undefined): string | null {
  const variants = phoneLookupVariants(phone);
  if (!variants.length) return null;
  return variants.map((value) => `phone.eq."${value.replace(/"/g, '')}"`).join(',');
}

export function matchPhoneToParty(phone: string | null | undefined, parties: PhoneParty[]): PhoneParty | null {
  const needle = normalizePhone(phone);
  if (!needle) return null;
  return (
    parties.find((party) => normalizePhone(party.phone) === needle && party.kind === 'customer') ||
    parties.find((party) => normalizePhone(party.phone) === needle) ||
    null
  );
}

const PHONE_PARAMS = [
  // Real Workspace Voice audit log field names (verified against live logs).
  'param_source',
  'caller_phone_number',
  'calling_party_number',
  'calling_number',
  'phone_number',
  'remote_party',
  'source_number',
  'caller_number',
];

const DURATION_PARAMS = [
  'param_duration','duration_seconds', 'duration', 'call_duration_seconds', 'billable_seconds'];

function parameterValue(parameter: Record<string, unknown>): string | null {
  for (const key of ['value', 'intValue', 'int_value', 'multiValue']) {
    const value = parameter[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function parametersOf(event: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  const parameters = event.parameters;
  if (!Array.isArray(parameters)) return map;
  for (const parameter of parameters) {
    if (!parameter || typeof parameter !== 'object') continue;
    const record = parameter as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim().toLowerCase() : '';
    const value = parameterValue(record);
    if (name && value) map.set(name, value);
  }
  return map;
}

function firstParam(map: Map<string, string>, names: string[]): string | null {
  for (const name of names) {
    const value = map.get(name);
    if (value) return value;
  }
  return null;
}

function activityQualifier(id: Record<string, unknown>): string | null {
  const raw = id.uniqueQualifier;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

/**
 * Google's uniqueQualifier only separates activities that share a timestamp,
 * so the same qualifier shows up on unrelated calls. The activity identity
 * is time + qualifier. Index separates multiple events inside one activity.
 */
export function voiceCallId(startedAt: string, qualifier: string | null, index: number): string {
  return qualifier ? `${startedAt}:${qualifier}:${index}` : `${startedAt}:${index}`;
}

/** Google Admin SDK Reports activities for the Voice application. */
export function parseVoiceActivities(payload: unknown): VoiceCall[] {
  const items =
    payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown }).items)
      ? ((payload as { items: unknown[] }).items ?? [])
      : [];
  const calls: VoiceCall[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = record.id && typeof record.id === 'object' ? (record.id as Record<string, unknown>) : {};
    const startedAt = typeof id.time === 'string' ? id.time : null;
    const qualifier = activityQualifier(id);
    const events = Array.isArray(record.events) ? record.events : [];
    events.forEach((event, index) => {
      if (!event || typeof event !== 'object' || !startedAt) return;
      const params = parametersOf(event as Record<string, unknown>);
      const phone = firstParam(params, PHONE_PARAMS);
      const durationRaw = firstParam(params, DURATION_PARAMS);
      // PARAM_DURATION is milliseconds; the legacy names are seconds.
      const durationName = DURATION_PARAMS.find((name) => params.get(name));
      const durationScale = durationName === 'param_duration' ? 1000 : 1;
      const duration = durationRaw != null ? Number(durationRaw) / durationScale : null;
      calls.push({
        id: voiceCallId(startedAt, qualifier, index),
        startedAt,
        durationSeconds: duration != null && Number.isFinite(duration) ? duration : null,
        callerPhone: phone,
      });
    });
  }
  return calls.filter((call) => call.callerPhone);
}

export interface StoredAdsCall {
  call_view_resource: string;
  started_at: string | null;
  duration_seconds: number | null;
  campaign_id: string | null;
  campaign_name: string | null;
  ad_group_name: string | null;
  keyword: string | null;
  caller_area_code: string | null;
  call_status: string | null;
  call_source: string | null;
  caller_phone: string | null;
  voice_call_id: string | null;
  customer_id: string | null;
  jobber_client_id: string | null;
  match_method: 'voice_time' | 'phone_only' | 'unmatched' | null;
}

export function storedAdsCall(
  draft: AdsCallDraft,
  voice: VoiceCall | null,
  party: PhoneParty | null
): StoredAdsCall {
  const phone = normalizePhone(voice?.callerPhone) || null;
  let match_method: StoredAdsCall['match_method'] = 'unmatched';
  if (voice && party) match_method = 'voice_time';
  else if (voice) match_method = 'voice_time';
  else if (party) match_method = 'phone_only';
  return {
    call_view_resource: draft.resourceName,
    started_at: adsStartedAtIso(draft.startedAt),
    duration_seconds: draft.durationSeconds,
    campaign_id: draft.campaignId,
    campaign_name: draft.campaignName,
    ad_group_name: draft.adGroupName,
    keyword: draft.keyword,
    caller_area_code: draft.callerAreaCode,
    call_status: draft.callStatus,
    call_source: draft.callSource,
    caller_phone: phone,
    voice_call_id: voice?.id ?? null,
    customer_id: party?.kind === 'customer' ? party.id : null,
    jobber_client_id: party?.kind === 'jobber_client' ? party.id : null,
    match_method: voice || party ? match_method : 'unmatched',
  };
}

/**
 * UTC ISO instant for a call_view start. Naive strings are account-local
 * wall clocks (America/Los_Angeles). Strings that already carry an offset
 * stay the same instant, so readers such as the offline-conversion cron can
 * keep using Date.parse.
 */
export function adsStartedAtIso(value: string | null | undefined, timeZone = ADS_ACCOUNT_TIME_ZONE): string | null {
  const ms = parseAdsDateTime(value, timeZone);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Rows written before the UTC fix stored the Pacific wall clock with no
 * offset, and Postgres read that as UTC (`2026-10-13 07:28:49` PT became
 * `2026-10-13T07:28:49Z`). Reinterpret those UTC clock fields as account
 * local time. Not idempotent on its own — a second pass would shift again.
 * Callers must skip resources already recorded as corrected.
 */
export function repairAdsStartedAtStoredAsUtc(
  stored: string | null | undefined,
  timeZone = ADS_ACCOUNT_TIME_ZONE
): string | null {
  const text = (stored || '').trim();
  if (!text) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  const wall = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  const corrected = parseAdsDateTime(wall, timeZone);
  if (!Number.isFinite(corrected)) return null;
  return new Date(corrected).toISOString();
}

/** settings.key shared with supabase/migrations/20261013_ads_calls_started_at_utc.sql */
export const ADS_CALLS_TIME_REPAIR_KEY = 'ads_calls_started_at_utc_v1';

export interface AdsCallTimeRow {
  call_view_resource: string;
  started_at: string | null;
}

/**
 * Shift legacy wall-clock rows that are not already marked correct.
 * `alreadyCorrect` is the settings ledger plus any resource this run just
 * upserted from Google Ads (those writes already store a real UTC instant).
 */
export function planAdsCallTimeRepairs(
  rows: AdsCallTimeRow[],
  alreadyCorrect: ReadonlySet<string>
): Array<{ call_view_resource: string; started_at: string }> {
  const patches: Array<{ call_view_resource: string; started_at: string }> = [];
  for (const row of rows) {
    if (!row.call_view_resource || alreadyCorrect.has(row.call_view_resource)) continue;
    if (!row.started_at) continue;
    const started_at = repairAdsStartedAtStoredAsUtc(row.started_at);
    if (!started_at || started_at === new Date(row.started_at).toISOString()) continue;
    patches.push({ call_view_resource: row.call_view_resource, started_at });
  }
  return patches;
}

export function backfillPartyPatch(
  row: { customer_id: string | null; jobber_client_id: string | null },
  party: PhoneParty | null
): { customer_id: string } | { jobber_client_id: string } | null {
  if (!party || row.customer_id || row.jobber_client_id) return null;
  if (party.kind === 'customer') return { customer_id: party.id };
  return { jobber_client_id: party.id };
}

export async function importAdsCalls(input: {
  drafts: AdsCallDraft[];
  voiceCalls: VoiceCall[];
  parties: PhoneParty[];
  lookupCustomer?: (phone: string) => Promise<PhoneParty | null>;
  lookupJobber?: (phone: string) => Promise<PhoneParty | null>;
  save: (row: StoredAdsCall) => Promise<void>;
}): Promise<{ seen: number; matchedVoice: number; matchedCustomer: number; matchedJobber: number }> {
  const result = { seen: 0, matchedVoice: 0, matchedCustomer: 0, matchedJobber: 0 };
  const voices = assignAdsVoices(input.drafts, input.voiceCalls);
  for (const draft of input.drafts) {
    result.seen += 1;
    const voice = voices.get(draft.resourceName) ?? null;
    if (voice) result.matchedVoice += 1;
    let party = matchPhoneToParty(voice?.callerPhone, input.parties);
    if (!party && voice?.callerPhone && input.lookupCustomer) {
      party = await input.lookupCustomer(voice.callerPhone);
    }
    if (!party && voice?.callerPhone && input.lookupJobber) {
      party = await input.lookupJobber(voice.callerPhone);
    }
    if (party?.kind === 'customer') result.matchedCustomer += 1;
    if (party?.kind === 'jobber_client') result.matchedJobber += 1;
    await input.save(storedAdsCall(draft, voice, party));
  }
  return result;
}
