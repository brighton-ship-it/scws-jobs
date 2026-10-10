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

export function matchAdsCallToVoice(call: AdsCallDraft, voiceCalls: VoiceCall[]): VoiceCall | null {
  const start = Date.parse(call.startedAt || '');
  if (!Number.isFinite(start)) return null;

  const ranked = voiceCalls
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
  'caller_phone_number',
  'calling_party_number',
  'calling_number',
  'phone_number',
  'remote_party',
  'source_number',
  'caller_number',
];

const DURATION_PARAMS = ['duration_seconds', 'duration', 'call_duration_seconds', 'billable_seconds'];

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
    const qualifier = typeof id.uniqueQualifier === 'string' ? id.uniqueQualifier : null;
    const events = Array.isArray(record.events) ? record.events : [];
    events.forEach((event, index) => {
      if (!event || typeof event !== 'object' || !startedAt) return;
      const params = parametersOf(event as Record<string, unknown>);
      const phone = firstParam(params, PHONE_PARAMS);
      const durationRaw = firstParam(params, DURATION_PARAMS);
      const duration = durationRaw != null ? Number(durationRaw) : null;
      calls.push({
        id: qualifier ? `${qualifier}:${index}` : `${startedAt}:${index}`,
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
    started_at: draft.startedAt,
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

export async function importAdsCalls(input: {
  drafts: AdsCallDraft[];
  voiceCalls: VoiceCall[];
  parties: PhoneParty[];
  lookupJobber?: (phone: string) => Promise<PhoneParty | null>;
  save: (row: StoredAdsCall) => Promise<void>;
}): Promise<{ seen: number; matchedVoice: number; matchedCustomer: number; matchedJobber: number }> {
  const result = { seen: 0, matchedVoice: 0, matchedCustomer: 0, matchedJobber: 0 };
  for (const draft of input.drafts) {
    result.seen += 1;
    const voice = matchAdsCallToVoice(draft, input.voiceCalls);
    if (voice) result.matchedVoice += 1;
    let party = matchPhoneToParty(voice?.callerPhone, input.parties);
    if (!party && voice?.callerPhone && input.lookupJobber) {
      party = await input.lookupJobber(voice.callerPhone);
    }
    if (party?.kind === 'customer') result.matchedCustomer += 1;
    if (party?.kind === 'jobber_client') result.matchedJobber += 1;
    await input.save(storedAdsCall(draft, voice, party));
  }
  return result;
}
