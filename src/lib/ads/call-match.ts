/**
 * Join a Google Ads call_view row to a Voice call log by start time, then
 * to a CRM customer or Jobber client by phone. call_view does not include
 * the caller number or the keyword.
 */

import { normalizePhone } from './book-job.ts';
import type { AdsCallDraft } from './google-ads-api.ts';

export const CALL_TIME_WINDOW_MS = 30_000;
export const CALL_DURATION_TOLERANCE_SEC = 15;
/**
 * After the Twilio port the shop leg starts late: recording notice, then up to
 * a 15s ring, then talk. Google Ads' clock includes that wait. Voice
 * PARAM_DURATION is talk time only. A second event in the same window often
 * has the SCWS Forward number (+1 760-276-3468) as its caller. That number is
 * one of our own lines, so the dashboard drops the ad call.
 */
export const SHOP_ANSWER_LATE_MS = 60_000;
/** Ring time that can sit in Google's duration after Voice has already started. */
export const SHOP_RING_SLACK_SEC = 15;

export interface AdsVoiceMatchOptions {
  /** Staff and our other lines. Used only when no external caller is in the window. */
  ownCaller?: (phone: string | null | undefined) => boolean;
  /** Shop forward number. Never stored as the customer; the dashboard would drop the call. */
  discardCaller?: (phone: string | null | undefined) => boolean;
}

function voiceWindow(
  adStart: number,
  voiceStart: number,
  adDuration: number | null,
  voiceDuration: number | null,
): { delta: number; durationDelta: number; strict: boolean } | null {
  if (!Number.isFinite(adStart) || !Number.isFinite(voiceStart)) return null;
  // A missing duration used to count as a perfect match and could steal the
  // call from the ring-group event that actually has the customer.
  if (adDuration == null || voiceDuration == null) return null;
  const delta = Math.abs(voiceStart - adStart);
  const lateMs = voiceStart - adStart;
  const rawDurationDelta = Math.abs(adDuration - voiceDuration);
  if (delta <= CALL_TIME_WINDOW_MS && rawDurationDelta <= CALL_DURATION_TOLERANCE_SEC) {
    return { delta, durationDelta: rawDurationDelta, strict: true };
  }
  // Shop answered. Voice starts after Google, and its talk time is shorter
  // by about that delay plus the ring that followed. Strict matches stay ahead
  // of this wider window so a nearby call keeps the log row it already fit.
  if (lateMs <= 0 || lateMs > SHOP_ANSWER_LATE_MS) return null;
  const shortfall = adDuration - voiceDuration;
  const unexplained = shortfall - lateMs / 1000;
  if (shortfall < -CALL_DURATION_TOLERANCE_SEC) return null;
  if (unexplained < -CALL_DURATION_TOLERANCE_SEC || unexplained > CALL_DURATION_TOLERANCE_SEC + SHOP_RING_SLACK_SEC) {
    return null;
  }
  return { delta, durationDelta: Math.abs(unexplained), strict: false };
}

function byVoiceFit(
  a: { delta: number; durationDelta: number; strict: boolean },
  b: { delta: number; durationDelta: number; strict: boolean },
): number {
  return Number(b.strict) - Number(a.strict) || a.delta - b.delta || a.durationDelta - b.durationDelta;
}

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
  excludeIds?: ReadonlySet<string>,
  options?: AdsVoiceMatchOptions,
): VoiceCall | null {
  const start = parseAdsDateTime(call.startedAt);
  if (!Number.isFinite(start)) return null;

  const ranked = voiceCalls
    .filter((voice) => !excludeIds?.has(voice.id) && !options?.discardCaller?.(voice.callerPhone))
    .map((voice) => {
      const window = voiceWindow(start, Date.parse(voice.startedAt), call.durationSeconds, voice.durationSeconds);
      return window ? { voice, ...window } : null;
    })
    .filter((row): row is { voice: VoiceCall; delta: number; durationDelta: number; strict: boolean } => row != null);
  const external = ranked.filter((row) => !options?.ownCaller?.(row.voice.callerPhone));
  const pool = external.length ? external : ranked;
  pool.sort(byVoiceFit);
  return pool[0]?.voice ?? null;
}

/**
 * One voice activity can sit inside the time window of two ad calls.
 * Assign the closest unused voice to each ad call so a single Voice log
 * row is not written onto two ads_calls rows.
 */
export function assignAdsVoices(
  drafts: AdsCallDraft[],
  voiceCalls: VoiceCall[],
  options?: AdsVoiceMatchOptions,
): Map<string, VoiceCall> {
  const candidates: Array<{ resource: string; voice: VoiceCall; delta: number; durationDelta: number; strict: boolean }> = [];
  for (const call of drafts) {
    const start = parseAdsDateTime(call.startedAt);
    if (!Number.isFinite(start)) continue;
    const rows: Array<{ resource: string; voice: VoiceCall; delta: number; durationDelta: number; strict: boolean }> = [];
    for (const voice of voiceCalls) {
      if (options?.discardCaller?.(voice.callerPhone)) continue;
      const window = voiceWindow(start, Date.parse(voice.startedAt), call.durationSeconds, voice.durationSeconds);
      if (window) rows.push({ resource: call.resourceName, voice, ...window });
    }
    const external = rows.filter((row) => !options?.ownCaller?.(row.voice.callerPhone));
    candidates.push(...(external.length ? external : rows));
  }
  candidates.sort(byVoiceFit);
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

/** Resolution columns a later import must not null out. */
export interface AdsCallResolution {
  call_view_resource: string;
  caller_phone: string | null;
  voice_call_id: string | null;
  customer_id: string | null;
  jobber_client_id: string | null;
  match_method: StoredAdsCall['match_method'];
}

function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  return Boolean(left && right && left === right);
}

/**
 * A re-import that cannot see the Voice log must not wipe a phone, voice id,
 * customer, Jobber client, or match method already stored. A new voice match
 * replaces the phone and voice id. Party links from this run win; when this
 * run matched the same phone but found no party, the stored links stay.
 */
export function preserveResolvedAdsCall(
  incoming: StoredAdsCall,
  existing: AdsCallResolution | null | undefined,
  discardCaller?: (phone: string | null | undefined) => boolean,
): StoredAdsCall {
  if (!existing) return incoming;
  // The forward number was stored as the customer. Do not keep it: the
  // dashboard treats that line as internal and drops the ad call.
  if (discardCaller?.(existing.caller_phone)) {
    if (incoming.caller_phone && !discardCaller(incoming.caller_phone)) return incoming;
    return {
      ...incoming,
      caller_phone: null,
      voice_call_id: null,
      customer_id: null,
      jobber_client_id: null,
      match_method: 'unmatched',
    };
  }
  const existingResolved =
    Boolean(existing.caller_phone) ||
    Boolean(existing.voice_call_id) ||
    Boolean(existing.customer_id) ||
    Boolean(existing.jobber_client_id) ||
    Boolean(existing.match_method && existing.match_method !== 'unmatched');
  if (!incoming.caller_phone) {
    if (!existingResolved) return incoming;
    return {
      ...incoming,
      caller_phone: existing.caller_phone,
      voice_call_id: existing.voice_call_id,
      customer_id: existing.customer_id,
      jobber_client_id: existing.jobber_client_id,
      match_method:
        existing.match_method && existing.match_method !== 'unmatched'
          ? existing.match_method
          : existing.match_method ?? incoming.match_method,
    };
  }
  const same = phonesMatch(incoming.caller_phone, existing.caller_phone);
  return {
    ...incoming,
    customer_id: incoming.customer_id ?? (same ? existing.customer_id : null),
    jobber_client_id: incoming.jobber_client_id ?? (same ? existing.jobber_client_id : null),
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
  /** Rows already stored. Resolution fields are kept when this run cannot match. */
  existing?: readonly AdsCallResolution[];
  lookupCustomer?: (phone: string) => Promise<PhoneParty | null>;
  lookupJobber?: (phone: string) => Promise<PhoneParty | null>;
  /** Staff and our lines. Kept only when no external caller matches. */
  ownCaller?: (phone: string | null | undefined) => boolean;
  /** Shop forward number. Never kept as the caller. */
  discardCaller?: (phone: string | null | undefined) => boolean;
  save: (row: StoredAdsCall) => Promise<void>;
}): Promise<{ seen: number; matchedVoice: number; matchedCustomer: number; matchedJobber: number }> {
  const result = { seen: 0, matchedVoice: 0, matchedCustomer: 0, matchedJobber: 0 };
  const prior = new Map((input.existing ?? []).map((row) => [row.call_view_resource, row]));
  const voices = assignAdsVoices(input.drafts, input.voiceCalls, {
    ownCaller: input.ownCaller,
    discardCaller: input.discardCaller,
  });
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
    await input.save(preserveResolvedAdsCall(storedAdsCall(draft, voice, party), prior.get(draft.resourceName), input.discardCaller));
  }
  return result;
}

/**
 * Voice history pulled with each ads-calls import. Wider than call_view's
 * 30 Pacific days so a call that has aged out of the rolling `now - 30 days`
 * window can still be re-matched, including rows a previous run nulled.
 */
export const ADS_CALL_VOICE_LOOKBACK_DAYS = 60;

/** Start of the Pacific day `days` ago. Inclusive of that whole boundary day. */
export function voiceActivityStartIso(
  now: Date = new Date(),
  days = ADS_CALL_VOICE_LOOKBACK_DAYS,
  timeZone = ADS_ACCOUNT_TIME_ZONE
): string {
  const from = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(now.getTime() - days * 86400_000));
  const ms = parseAdsDateTime(`${from} 00:00:00`, timeZone);
  if (!Number.isFinite(ms)) return new Date(now.getTime() - days * 86400_000).toISOString();
  return new Date(ms).toISOString();
}

export interface AdsCallPhoneRow {
  call_view_resource: string;
  started_at: string | null;
  duration_seconds: number | null;
  campaign_name: string | null;
  caller_phone: string | null;
  voice_call_id?: string | null;
}

export interface AdCallPhoneSnapshot {
  at: string;
  phone: string | null;
  campaign: string | null;
}

export interface AdsCallPhoneRestore {
  call_view_resource: string;
  caller_phone: string;
  voice_call_id: string | null;
  match_method: 'voice_time' | 'phone_only';
}

/**
 * Fill caller_phone on rows that lost it. Voice time/duration wins. A
 * snapshot of (at, phone, campaign) is only used when Voice has no match.
 * `usedVoiceIds` are logs already written onto another ad call this run.
 */
export function planNullPhoneRestores(
  rows: readonly AdsCallPhoneRow[],
  voiceCalls: readonly VoiceCall[],
  options?: {
    usedVoiceIds?: ReadonlySet<string>;
    snapshots?: readonly AdCallPhoneSnapshot[];
    ownCaller?: (phone: string | null | undefined) => boolean;
    discardCaller?: (phone: string | null | undefined) => boolean;
  }
): AdsCallPhoneRestore[] {
  const used = options?.usedVoiceIds;
  const open = rows.filter((row) => row.call_view_resource && row.started_at && !normalizePhone(row.caller_phone));
  const drafts: AdsCallDraft[] = open.map((row) => ({
    resourceName: row.call_view_resource,
    startedAt: row.started_at,
    durationSeconds: row.duration_seconds,
    campaignId: null,
    campaignName: row.campaign_name,
    adGroupName: null,
    keyword: null,
    callerAreaCode: null,
    callStatus: null,
    callSource: null,
  }));
  const voices = used ? voiceCalls.filter((voice) => !used.has(voice.id)) : voiceCalls;
  const assigned = assignAdsVoices(drafts, voices as VoiceCall[], {
    ownCaller: options?.ownCaller,
    discardCaller: options?.discardCaller,
  });
  const restores: AdsCallPhoneRestore[] = [];
  const restored = new Set<string>();
  for (const row of open) {
    const voice = assigned.get(row.call_view_resource);
    const phone = normalizePhone(voice?.callerPhone);
    if (!voice || !phone) continue;
    restores.push({
      call_view_resource: row.call_view_resource,
      caller_phone: phone,
      voice_call_id: voice.id,
      match_method: 'voice_time',
    });
    restored.add(row.call_view_resource);
  }

  const snapshots = options?.snapshots ?? [];
  if (!snapshots.length) return restores;
  const byCampaign = new Map<string, AdCallPhoneSnapshot[]>();
  for (const snap of snapshots) {
    if (!normalizePhone(snap.phone) || !Number.isFinite(Date.parse(snap.at))) continue;
    const key = snap.campaign || '';
    const list = byCampaign.get(key) ?? [];
    list.push(snap);
    byCampaign.set(key, list);
  }
  const usedSnap = new Set<AdCallPhoneSnapshot>();
  for (const row of open) {
    if (restored.has(row.call_view_resource)) continue;
    const at = Date.parse(row.started_at || '');
    if (!Number.isFinite(at)) continue;
    let best: AdCallPhoneSnapshot | null = null;
    let bestDelta = Infinity;
    for (const snap of byCampaign.get(row.campaign_name || '') ?? []) {
      if (usedSnap.has(snap)) continue;
      const delta = Math.abs(Date.parse(snap.at) - at);
      if (delta <= 2000 && delta < bestDelta) {
        best = snap;
        bestDelta = delta;
      }
    }
    const phone = normalizePhone(best?.phone);
    if (!best || !phone) continue;
    usedSnap.add(best);
    restores.push({
      call_view_resource: row.call_view_resource,
      caller_phone: phone,
      voice_call_id: null,
      match_method: 'phone_only',
    });
  }
  return restores;
}

/**
 * Rows that already have a caller phone but lost voice_call_id. Attach the
 * Voice log only when it is the same caller. Never changes the phone.
 */
export function planVoiceIdFills(
  rows: readonly AdsCallPhoneRow[],
  voiceCalls: readonly VoiceCall[],
  usedVoiceIds?: ReadonlySet<string>,
  ownCaller?: (phone: string | null | undefined) => boolean,
  discardCaller?: (phone: string | null | undefined) => boolean,
): Array<{ call_view_resource: string; voice_call_id: string; match_method: 'voice_time' }> {
  const open = rows.filter(
    (row) => row.call_view_resource && row.started_at && normalizePhone(row.caller_phone) && !row.voice_call_id
  );
  const drafts: AdsCallDraft[] = open.map((row) => ({
    resourceName: row.call_view_resource,
    startedAt: row.started_at,
    durationSeconds: row.duration_seconds,
    campaignId: null,
    campaignName: row.campaign_name,
    adGroupName: null,
    keyword: null,
    callerAreaCode: null,
    callStatus: null,
    callSource: null,
  }));
  const voices = usedVoiceIds ? voiceCalls.filter((voice) => !usedVoiceIds.has(voice.id)) : voiceCalls;
  const assigned = assignAdsVoices(drafts, voices as VoiceCall[], { ownCaller, discardCaller });
  const fills: Array<{ call_view_resource: string; voice_call_id: string; match_method: 'voice_time' }> = [];
  for (const row of open) {
    const voice = assigned.get(row.call_view_resource);
    const phone = normalizePhone(voice?.callerPhone);
    if (!voice || !phone || phone !== normalizePhone(row.caller_phone)) continue;
    fills.push({ call_view_resource: row.call_view_resource, voice_call_id: voice.id, match_method: 'voice_time' });
  }
  return fills;
}
