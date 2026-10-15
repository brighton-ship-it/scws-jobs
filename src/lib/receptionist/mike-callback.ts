/**
 * Outbound missed-call callbacks for Mike.
 *
 * Pure rules: who may be dialed, when, from which number, and how the
 * dashboard should describe the attempt. Nothing here places a call.
 *
 * A callback is placed from the tracking or business number the customer
 * dialed, so the ad or line that received the call keeps the credit.
 * Mike's own assistant number is never used as that caller ID.
 */
import { ASSISTANT_NAME } from './assistant-name.ts';
import { PORTED_LINES, shopNumbers } from '../phone-calls/config.ts';
import { MIKE_FORWARD_NUMBER } from '../ads/phone-call-log.ts';
import { digits10 } from '../ads/call-dashboard.ts';
import { isOwnNumber } from '../ads/real-leads.ts';
import { trackingNumberSet } from '../ads/twilio-outbound.ts';
import { staffLines } from '../ads/staff-lines.ts';
import { formatPhone } from '../ads/call-feed.ts';
import {
  hasWorkOnOrAfter,
  isHangupUnder10s,
  type CallbackCandidate,
  type CallbackSource,
  type OutreachAttempt,
} from '../ads/callbacks.ts';

export const SAME_CALL_MS = 3 * 60_000;
export const WEEK_MS = 7 * 86400_000;
export const IN_FLIGHT_MS = 45 * 60_000;
export const MIKE_LEG_MS = 30 * 60_000;
export const DIAL_OUTCOMES = new Set(['dialing', 'reached', 'booked', 'voicemail', 'no-answer', 'failed']);
export const DEFAULT_HOLD_PHRASES = ['kevin coleman', 'steven payment plan'];

const DNC_TEXT = /\bdo not call\b|\bdon't call\b|\bdo-not-call\b|\bopt[ -]?out\b|\bstop calling\b/i;
const WEEKDAY: Record<string, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};

export interface CallbackConfig {
  mode: 'off' | 'test' | 'full';
  /** 10-digit numbers. Test mode dials only these. */
  testNumbers: Set<string>;
  timeZone: string;
  openMinutes: number;
  closeMinutes: number;
  days: Set<string>;
  waitMs: number;
  maxPer7Days: number;
  lookbackMs: number;
  maxPerRun: number;
  holdPhrases: string[];
  extraDnc: Set<string>;
  mikeNumber: string;
}

export interface StoredAttempt {
  id?: string;
  missedCallKey: string;
  phone: string | null;
  fromNumber: string | null;
  missedAt: string;
  attemptedAt: string | null;
  outcome: string;
  reason: string | null;
  twilioCallSid?: string | null;
  vapiCallId?: string | null;
}

export interface CallbackContext {
  laterInbound: Array<{ phone: string | null; at: string }>;
  voiceAttempts: OutreachAttempt[];
  work: Map<string, number[]>;
  attempts: StoredAttempt[];
  /** Phones on a client with an unpaid invoice. */
  unpaidPhones: Set<string>;
  /** collection_holds matched by phone. */
  holdPhones: Set<string>;
  /** Extra text (client name, hold reason) checked against the known hold phrases. */
  holdNotes: Array<{ phone: string | null; text: string }>;
  dncPhones: Set<string>;
}

export type CallbackAction =
  | { action: 'dial'; to: string; from: string }
  | { action: 'queue'; reason: 'too_soon' | 'after_hours' | 'line_busy'; to: string; from: string; notBefore: string }
  | { action: 'skip'; reason: string };

export interface PlannedCallback {
  call: CallbackCandidate;
  decision: CallbackAction;
}

const EPHEMERAL_SKIPS = new Set([
  'flag_off', 'not_allowlisted', 'already_attempted', 'public_url_missing', 'dialer_not_configured',
]);

export function isEphemeralSkip(reason: string): boolean {
  return EPHEMERAL_SKIPS.has(reason);
}

function truthy(raw: string | undefined): boolean {
  const v = (raw || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function numberSet(raw: string | undefined): Set<string> {
  const set = new Set<string>();
  for (const part of (raw || '').split(/[,;]+/)) {
    const d = digits10(part);
    if (d) set.add(d);
  }
  return set;
}

function clockMinutes(raw: string | undefined, fallback: number): number {
  const text = (raw || '').trim();
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2] || '0');
  if (hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}

function daySet(raw: string | undefined): Set<string> {
  const set = new Set<string>();
  for (const part of (raw || 'Mon,Tue,Wed,Thu,Fri').split(/[,;\s]+/)) {
    const day = WEEKDAY[part.trim().toLowerCase().slice(0, 3)];
    if (day) set.add(day);
  }
  return set.size ? set : new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
}

export function callbackConfig(env: NodeJS.ProcessEnv = process.env): CallbackConfig {
  const testNumbers = numberSet(env.MIKE_CALLBACK_TEST_NUMBERS);
  const mode = truthy(env.MIKE_CALLBACKS_ENABLED) ? 'full' : testNumbers.size ? 'test' : 'off';
  const phrases = (env.MIKE_CALLBACK_HOLD_NAMES || DEFAULT_HOLD_PHRASES.join('|'))
    .split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const mike = (env.MIKE_VAPI_NUMBER || MIKE_FORWARD_NUMBER).trim();
  const waitMin = Number(env.MIKE_CALLBACK_WAIT_MINUTES);
  const maxWeek = Number(env.MIKE_CALLBACK_MAX_PER_7_DAYS);
  const lookbackH = Number(env.MIKE_CALLBACK_LOOKBACK_HOURS);
  const maxRun = Number(env.MIKE_CALLBACK_MAX_PER_RUN);
  return {
    mode,
    testNumbers,
    timeZone: (env.MIKE_CALLBACK_TZ || 'America/Los_Angeles').trim() || 'America/Los_Angeles',
    openMinutes: clockMinutes(env.MIKE_CALLBACK_OPEN, 8 * 60),
    closeMinutes: clockMinutes(env.MIKE_CALLBACK_CLOSE, 17 * 60),
    days: daySet(env.MIKE_CALLBACK_DAYS),
    waitMs: (Number.isFinite(waitMin) && waitMin >= 0 ? waitMin : 5) * 60_000,
    maxPer7Days: Number.isFinite(maxWeek) && maxWeek >= 1 ? Math.floor(maxWeek) : 2,
    lookbackMs: (Number.isFinite(lookbackH) && lookbackH > 0 ? lookbackH : 96) * 3600_000,
    maxPerRun: Number.isFinite(maxRun) && maxRun >= 1 ? Math.floor(maxRun) : 3,
    holdPhrases: phrases.length ? phrases : DEFAULT_HOLD_PHRASES,
    extraDnc: numberSet(env.MIKE_CALLBACK_DNC),
    mikeNumber: mike.startsWith('+') ? mike : (digits10(mike) ? `+1${digits10(mike)}` : MIKE_FORWARD_NUMBER),
  };
}

export function callbackPublicBase(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.NEXT_PUBLIC_APP_URL || env.MIKE_CALLBACK_PUBLIC_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Twilio fetches the script over HTTPS. An http base would ring the customer with no greeting.
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) map[part.type] = part.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    weekday: (map.weekday || '').slice(0, 3),
  };
}

/** UTC instant for a wall-clock time in `timeZone`. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    const diff = Date.UTC(year, month - 1, day, hour, minute, 0) - asUtc;
    const next = utc + diff;
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}

export function isOpenAt(date: Date, config: CallbackConfig): boolean {
  const parts = zonedParts(date, config.timeZone);
  if (!config.days.has(parts.weekday)) return false;
  const minutes = parts.hour * 60 + parts.minute;
  return minutes >= config.openMinutes && minutes < config.closeMinutes;
}

/** Next instant the office is open, or `from` when it already is. */
export function nextOpenAt(from: Date, config: CallbackConfig): Date {
  if (isOpenAt(from, config)) return from;
  const start = zonedParts(from, config.timeZone);
  const openHour = Math.floor(config.openMinutes / 60);
  const openMinute = config.openMinutes % 60;
  for (let add = 0; add < 8; add += 1) {
    // 20:00 UTC is the same Pacific calendar day (1pm PDT / noon PST).
    const probe = new Date(Date.UTC(start.year, start.month - 1, start.day + add, 20, 0, 0));
    const day = zonedParts(probe, config.timeZone);
    if (!config.days.has(day.weekday)) continue;
    const open = zonedTimeToUtc(day.year, day.month, day.day, openHour, openMinute, config.timeZone);
    if (open.getTime() >= from.getTime()) return open;
  }
  return new Date(from.getTime() + 86400_000);
}

export function businessCallerId(called: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  const d = digits10(called);
  if (!d) return null;
  if (d === digits10(MIKE_FORWARD_NUMBER) || d === digits10(callbackConfig(env).mikeNumber)) return null;
  const staff = new Set(staffLines(env).map((line) => line.phone).filter((phone): phone is string => !!phone));
  if (staff.has(d)) return null;
  const allowed = trackingNumberSet(env);
  for (const line of Object.values(PORTED_LINES)) {
    const n = digits10(line.number);
    if (n) allowed.add(n);
  }
  for (const n of shopNumbers(env)) {
    const x = digits10(n);
    if (x) allowed.add(x);
  }
  allowed.delete(digits10(MIKE_FORWARD_NUMBER) || '');
  if (!allowed.has(d)) return null;
  return `+1${d}`;
}

/** Spoken by Mike in his Vapi voice on inbound calls. No Twilio <Say> before him. */
export function mikeFirstMessage(): string {
  return `Hey, this is ${ASSISTANT_NAME} with Southern California Well Service. Just a heads up, this call's recorded. What's going on with your well?`;
}

/** Callback only. Spoken by Mike if the person who answered stays quiet. */
export function mikeCallbackFirstMessage(): string {
  return `Hey, this is ${ASSISTANT_NAME} with Southern California Well Service, returning your call. Just a heads up, this call's recorded. What's going on with your well?`;
}

/**
 * How long a callback waits for the person who answered before Mike greets.
 * A little past 2 seconds: a hello that starts right at 2 seconds has to
 * cancel the timer before the greeting is locked in.
 */
export const CALLBACK_SILENCE_GREETING_SECONDS = 3;

/**
 * Cartesia sonic-3 volume. 1 is the default and 0.5 is the quietest.
 * The callback was coming through like a shout at the default.
 */
export const CALLBACK_VOICE_VOLUME = 0.55;

export const CALLBACK_VOICE_ID = '5fc5c797-12c5-4f2b-ac9b-d4e53c08098f';

/**
 * Wyatt, quieter, normal speed, no emotion styling.
 * Cartesia emotion tags only add emotion, so none is set.
 * The 11labs fallback has speaker boost off so a failover is not louder.
 */
export function callbackVoiceSettings(): {
  provider: 'cartesia';
  voiceId: string;
  model: 'sonic-3';
  language: 'en';
  cachingEnabled: false;
  generationConfig: { speed: number; volume: number };
  fallbackPlan: {
    voices: Array<{
      provider: '11labs';
      voiceId: string;
      model: 'eleven_turbo_v2_5';
      stability: number;
      similarityBoost: number;
      style: number;
      speed: number;
      useSpeakerBoost: false;
    }>;
  };
} {
  return {
    provider: 'cartesia',
    voiceId: CALLBACK_VOICE_ID,
    model: 'sonic-3',
    language: 'en',
    cachingEnabled: false,
    generationConfig: { speed: 1, volume: CALLBACK_VOICE_VOLUME },
    fallbackPlan: {
      voices: [{
        provider: '11labs',
        voiceId: 'pNInz6obpgDQGcFmaJgB',
        model: 'eleven_turbo_v2_5',
        stability: 0.6,
        similarityBoost: 0.75,
        style: 0,
        speed: 1,
        useSpeakerBoost: false,
      }],
    },
  };
}

/**
 * Opening fallback. The timer is cancelled when the person speaks, so the
 * greeting is not recited over their hello. exact is the only spoken text.
 * say.prompt is spoken aloud by the voice, which is how the rules were read
 * on the 6:26 PM call.
 */
export function callbackSilenceGreetingHook(): {
  on: 'customer.speech.timeout';
  name: string;
  options: { timeoutSeconds: number; triggerMaxCount: number; triggerResetMode: 'never' };
  do: Array<{ type: 'say'; exact: string }>;
} {
  return {
    on: 'customer.speech.timeout',
    name: 'callback_greeting_if_silent',
    options: {
      timeoutSeconds: CALLBACK_SILENCE_GREETING_SECONDS,
      triggerMaxCount: 1,
      triggerResetMode: 'never',
    },
    // Hook say rejects interruptionsEnabled. Barge-in is stopSpeakingPlan
    // plus firstMessageInterruptionsEnabled, which cover this utterance.
    do: [{ type: 'say', exact: mikeCallbackFirstMessage() }],
  };
}

/** Stop as soon as the caller’s voice is on the line, then wait a second. */
export function callbackStopSpeakingPlan(): {
  numWords: 0;
  voiceSeconds: 0.2;
  backoffSeconds: 1;
} {
  return { numWords: 0, voiceSeconds: 0.2, backoffSeconds: 1 };
}

/** Outbound callback: wait for them, then greet if they stay quiet. */
export function callbackAssistantOverrides(customerPhone: string): {
  firstMessage: '';
  firstMessageMode: 'assistant-waits-for-user';
  firstMessageInterruptionsEnabled: true;
  backgroundSound: 'off';
  voice: ReturnType<typeof callbackVoiceSettings>;
  stopSpeakingPlan: ReturnType<typeof callbackStopSpeakingPlan>;
  hooks: Array<ReturnType<typeof callbackSilenceGreetingHook>>;
  variableValues: { callback: 'true'; customerPhone: string };
} {
  return {
    // Empty so a saved firstMessage is not recited over their hello.
    firstMessage: '',
    firstMessageMode: 'assistant-waits-for-user',
    firstMessageInterruptionsEnabled: true,
    backgroundSound: 'off',
    voice: callbackVoiceSettings(),
    stopSpeakingPlan: callbackStopSpeakingPlan(),
    hooks: [callbackSilenceGreetingHook()],
    variableValues: { callback: 'true', customerPhone },
  };
}

/** SIP user for the callback assistant. Twilio dials this instead of Mike's PSTN number. */
export const CALLBACK_SIP_USER = 'scws-mike-callback';

export function callbackSipUri(customerPhone: string): string {
  const phone = customerPhone.trim();
  return `sip:${CALLBACK_SIP_USER}@sip.vapi.ai?X-callback=true&X-customerPhone=${encodeURIComponent(phone)}`;
}

export function voicemailScript(fromE164: string): string {
  const shown = formatPhone(fromE164);
  return `Hi, this is Southern California Well Service returning your call. Please call us back at ${shown}, the number you dialed. Thank you.`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Voicemail only. A person is bridged straight to Mike, who says the recording
 * disclosure himself. Chirp3 HD is a generative US English male, not standard Polly.
 */
export const CALLBACK_SAY_VOICE = 'Google.en-US-Chirp3-HD-Charon';

/**
 * On a callback, Vapi's Caller ID is the tracking number we dialed from.
 * The model often passes that number as params.phone, which would look up
 * our ads line instead of the customer. Prefer the customer we actually dialed.
 */
export function phoneForCallbackTool(paramsPhone: unknown, callPhone: string): string {
  const presented = String(paramsPhone ?? '').trim();
  const caller = String(callPhone ?? '').trim();
  if (caller && isOwnNumber(presented)) return caller;
  return presented || caller;
}

export function machineTwiml(voicemail: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${CALLBACK_SAY_VOICE}">${esc(voicemail)}</Say>
  <Hangup/>
</Response>`;
}

/**
 * Person answered. Connect straight to the callback assistant over SIP.
 * No second PSTN leg, and no <Say> before Mike.
 */
export function humanTwiml(opts: { customerPhone: string; actionUrl: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="20" action="${esc(opts.actionUrl)}" method="POST">
    <Sip>${esc(callbackSipUri(opts.customerPhone))}</Sip>
  </Dial>
</Response>`;
}

export function hangupTwiml(): string {
  return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
}

/** machine leaves a voicemail. fax hangs up. anything else is treated as a person. */
export function amdKind(answeredBy: string | null | undefined): 'human' | 'machine' | 'fax' {
  const value = (answeredBy || '').trim().toLowerCase();
  if (value === 'fax') return 'fax';
  if (value.startsWith('machine')) return 'machine';
  return 'human';
}

export function isUnpaidStatus(status: string | null | undefined, balance?: number | null): boolean {
  const normalized = (status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'paid' || normalized === 'draft') return false;
  if (typeof balance === 'number' && Number.isFinite(balance)) return balance > 0.009;
  return normalized === 'awaiting_payment' || normalized === 'past_due' || normalized === 'bad_debt';
}

export function visitCreatedInstants(data: unknown): string[] {
  const root = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  if (!root) return [];
  const visits = root.visits;
  const nodes = Array.isArray(visits)
    ? visits
    : visits && typeof visits === 'object' && Array.isArray((visits as { nodes?: unknown[] }).nodes)
      ? (visits as { nodes: unknown[] }).nodes
      : [];
  const out: string[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const created = (node as { createdAt?: unknown; created_at?: unknown; startAt?: unknown; start_at?: unknown }).createdAt
      ?? (node as { created_at?: unknown }).created_at
      ?? (node as { startAt?: unknown }).startAt
      ?? (node as { start_at?: unknown }).start_at;
    if (typeof created === 'string' && Number.isFinite(Date.parse(created))) out.push(created);
  }
  return out;
}

export function phraseMatches(blob: string, phrases: string[]): boolean {
  const hay = blob.toLowerCase();
  return phrases.some((phrase) => {
    const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length > 0 && words.every((word) => hay.includes(word));
  });
}

export function matchesCollectionsHold(input: {
  name: string | null;
  summary?: string | null;
  notes?: string[];
  phrases: string[];
}): boolean {
  const blob = [input.name, input.summary, ...(input.notes || [])].filter(Boolean).join(' ');
  return phraseMatches(blob, input.phrases);
}

export function doNotCallText(name: string | null, summary: string | null): boolean {
  return DNC_TEXT.test(`${name || ''}\n${summary || ''}`);
}

function calledAgain(phone: string | null, afterIso: string, rows: Array<{ phone: string | null; at: string }>): boolean {
  const p = digits10(phone);
  const after = Date.parse(afterIso);
  if (!p || !Number.isFinite(after)) return false;
  return rows.some((row) => {
    const t = Date.parse(row.at);
    return digits10(row.phone) === p && Number.isFinite(t) && t > after + SAME_CALL_MS;
  });
}

function shopCalledBack(phone: string | null, afterIso: string, attempts: OutreachAttempt[]): boolean {
  const p = digits10(phone);
  const after = Date.parse(afterIso);
  if (!p || !Number.isFinite(after)) return false;
  return attempts.some((row) => {
    const t = Date.parse(row.at);
    return digits10(row.phone) === p && Number.isFinite(t) && t > after;
  });
}

function dialsFor(phone: string | null, attempts: StoredAttempt[], now: Date): StoredAttempt[] {
  const p = digits10(phone);
  const start = now.getTime() - WEEK_MS;
  return attempts.filter((row) => {
    if (!p || digits10(row.phone) !== p || !DIAL_OUTCOMES.has(row.outcome)) return false;
    const t = Date.parse(row.attemptedAt || '');
    return Number.isFinite(t) && t >= start && t <= now.getTime();
  });
}

export function fromLineBusy(from: string | null, attempts: StoredAttempt[], now: Date): boolean {
  const line = digits10(from);
  if (!line) return false;
  return attempts.some((row) => {
    if (digits10(row.fromNumber) !== line) return false;
    const t = Date.parse(row.attemptedAt || '');
    if (!Number.isFinite(t) || now.getTime() - t > IN_FLIGHT_MS) return false;
    return row.outcome === 'dialing' || row.outcome === 'reached';
  });
}

function inFlightAttempt(row: StoredAttempt, now: Date): boolean {
  const t = Date.parse(row.attemptedAt || '');
  if (!Number.isFinite(t) || now.getTime() - t > IN_FLIGHT_MS) return false;
  return row.outcome === 'dialing' || row.outcome === 'reached';
}

export function matchInFlightCallback(presented: string | null, attempts: StoredAttempt[], now: Date): StoredAttempt | null {
  const line = digits10(presented);
  if (!line) return null;
  const live = attempts.filter((row) => inFlightAttempt(row, now));
  const byFrom = live.filter((row) => digits10(row.fromNumber) === line);
  if (byFrom.length === 1) return byFrom[0];
  if (byFrom.length > 1) return null;
  const byPhone = live.filter((row) => digits10(row.phone) === line);
  return byPhone.length === 1 ? byPhone[0] : null;
}

function gate(decision: CallbackAction, phone: string | null, config: CallbackConfig): CallbackAction {
  if (decision.action === 'skip') return decision;
  if (config.mode === 'off') return { action: 'skip', reason: 'flag_off' };
  if (config.mode === 'test' && !config.testNumbers.has(digits10(phone) || '')) {
    return { action: 'skip', reason: 'not_allowlisted' };
  }
  return decision;
}

export function decideMikeCallback(
  call: CallbackCandidate,
  ctx: CallbackContext,
  config: CallbackConfig,
  now: Date,
  env: NodeJS.ProcessEnv = process.env,
): CallbackAction {
  const phone = digits10(call.phone);
  const at = Date.parse(call.at);
  const finish = (decision: CallbackAction) => gate(decision, call.phone, config);
  if (!phone || !Number.isFinite(at)) return { action: 'skip', reason: 'no_phone' };
  if (isOwnNumber(call.phone)) return { action: 'skip', reason: 'own_number' };
  if (call.outcome !== 'missed') return { action: 'skip', reason: 'not_missed' };
  if (now.getTime() - at > config.lookbackMs) return { action: 'skip', reason: 'stale' };
  if (isHangupUnder10s(call.durationSeconds, call.ringSeconds)) return { action: 'skip', reason: 'hangup' };
  if (call.spam) return { action: 'skip', reason: 'spam' };
  if (call.vendor) return { action: 'skip', reason: 'vendor' };
  if (call.aiBooked) return { action: 'skip', reason: 'mike_booked' };

  const prior = ctx.attempts.filter((row) => row.missedCallKey === call.key);
  if (prior.some((row) => DIAL_OUTCOMES.has(row.outcome))) return { action: 'skip', reason: 'already_attempted' };

  const notes = ctx.holdNotes.filter((row) => !row.phone || digits10(row.phone) === phone).map((row) => row.text);
  if (ctx.holdPhones.has(phone) || matchesCollectionsHold({
    name: call.name, summary: call.summary, notes, phrases: config.holdPhrases,
  })) return { action: 'skip', reason: 'collections_hold' };
  if (ctx.unpaidPhones.has(phone)) return { action: 'skip', reason: 'unpaid_invoice' };
  if (ctx.dncPhones.has(phone) || config.extraDnc.has(phone) || doNotCallText(call.name, call.summary)) {
    return { action: 'skip', reason: 'do_not_call' };
  }
  if (hasWorkOnOrAfter(call.phone, call.at, ctx.work)) return { action: 'skip', reason: 'jobber_work' };
  if (calledAgain(call.phone, call.at, ctx.laterInbound)) return { action: 'skip', reason: 'called_again' };
  if (shopCalledBack(call.phone, call.at, ctx.voiceAttempts)) return { action: 'skip', reason: 'voice_callback' };
  if (dialsFor(call.phone, ctx.attempts, now).length >= config.maxPer7Days) return { action: 'skip', reason: 'weekly_cap' };

  const from = businessCallerId(call.calledNumber, env);
  if (!from) return { action: 'skip', reason: 'no_from_number' };
  const to = `+1${phone}`;
  if (digits10(from) === phone) return { action: 'skip', reason: 'own_number' };

  const readyAt = at + config.waitMs;
  let notBefore = new Date(readyAt);
  if (!isOpenAt(notBefore, config)) notBefore = nextOpenAt(notBefore, config);
  if (!isOpenAt(now, config)) {
    const next = nextOpenAt(now, config);
    if (next.getTime() > notBefore.getTime()) notBefore = next;
  }
  if (fromLineBusy(from, ctx.attempts, now)) {
    const soon = new Date(now.getTime() + 2 * 60_000);
    return finish({
      action: 'queue', reason: 'line_busy', to, from,
      notBefore: new Date(Math.max(soon.getTime(), notBefore.getTime())).toISOString(),
    });
  }
  if (now.getTime() < readyAt && isOpenAt(new Date(readyAt), config) && isOpenAt(now, config)) {
    return finish({ action: 'queue', reason: 'too_soon', to, from, notBefore: new Date(readyAt).toISOString() });
  }
  if (now.getTime() < notBefore.getTime() || !isOpenAt(now, config)) {
    return finish({ action: 'queue', reason: 'after_hours', to, from, notBefore: notBefore.toISOString() });
  }
  return finish({ action: 'dial', to, from });
}

export function planMikeCallbacks(
  calls: CallbackCandidate[],
  ctx: CallbackContext,
  config: CallbackConfig,
  now: Date,
  env: NodeJS.ProcessEnv = process.env,
): PlannedCallback[] {
  const seen = new Set<string>();
  const plans: PlannedCallback[] = [];
  // Newest missed call per number. An older miss is the same episode or was followed by another call.
  const ordered = [...calls].filter((call) => call.outcome === 'missed').sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  for (const call of ordered) {
    const phone = digits10(call.phone);
    if (phone && seen.has(phone)) continue;
    if (phone) seen.add(phone);
    plans.push({ call, decision: decideMikeCallback(call, ctx, config, now, env) });
  }
  return plans;
}

const REASON_LABEL: Record<string, string> = {
  unpaid_invoice: 'unpaid invoice',
  collections_hold: 'collections hold',
  do_not_call: 'do not call',
  jobber_work: 'Jobber work after the call',
  called_again: 'called again',
  voice_callback: 'shop called back',
  mike_booked: 'Mike already booked',
  already_attempted: 'already tried',
  weekly_cap: '2 calls in 7 days',
  hangup: 'hang-up under 10s',
  spam: 'spam',
  vendor: 'vendor',
  not_missed: 'not a missed call',
  no_from_number: 'no business caller ID',
  own_number: 'internal number',
  stale: 'older than the lookback',
  no_phone: 'no phone',
  fax: 'fax',
  bridge_failed: 'could not reach Mike',
  twilio_error: 'call failed',
};

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'skipped';
  return REASON_LABEL[reason] || reason.replace(/_/g, ' ');
}

function whenLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
  const day = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  if (day === today) return time;
  const date = d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' });
  return `${date}, ${time}`;
}

const TRIED: Record<string, string> = {
  reached: 'reached',
  booked: 'booked',
  voicemail: 'voicemail',
  'no-answer': 'no answer',
  failed: 'failed',
  dialing: 'calling',
};

export function formatMikeStatus(attempt: StoredAttempt, now: Date): string | null {
  if (attempt.outcome === 'queued') return null;
  const when = whenLabel(attempt.attemptedAt || attempt.missedAt, now);
  if (attempt.outcome === 'skipped') return `Mike skipped ${when}, ${reasonLabel(attempt.reason)}`;
  const label = TRIED[attempt.outcome];
  if (!label) return null;
  return `Mike tried ${when}, ${label}`;
}

export function mikeStatusLabel(
  phone: string | null,
  callAt: string,
  attempts: StoredAttempt[],
  now: Date,
): string | null {
  const p = digits10(phone);
  const at = Date.parse(callAt);
  if (!p || !Number.isFinite(at)) return null;
  const hits = attempts.filter((row) => digits10(row.phone) === p && Math.abs(Date.parse(row.missedAt) - at) < SAME_CALL_MS);
  if (!hits.length) return null;
  const ranked = [...hits].sort((a, b) => {
    const score = (row: StoredAttempt) => (DIAL_OUTCOMES.has(row.outcome) ? 2 : row.outcome === 'skipped' ? 1 : 0);
    const byScore = score(b) - score(a);
    if (byScore) return byScore;
    return Date.parse(b.attemptedAt || b.missedAt) - Date.parse(a.attemptedAt || a.missedAt);
  });
  return formatMikeStatus(ranked[0], now);
}

export function mikeOutreachAttempts(attempts: StoredAttempt[]): OutreachAttempt[] {
  const out: OutreachAttempt[] = [];
  for (const row of attempts) {
    if (!DIAL_OUTCOMES.has(row.outcome) || !row.attemptedAt) continue;
    if (!Number.isFinite(Date.parse(row.attemptedAt))) continue;
    out.push({
      at: row.attemptedAt,
      phone: row.phone,
      staff: 'Mike',
      durationSeconds: row.outcome === 'reached' || row.outcome === 'booked' ? 1 : 0,
    });
  }
  return out;
}

export function sourcesWithoutMikeLegs(sources: CallbackSource[], attempts: StoredAttempt[], env: NodeJS.ProcessEnv = process.env): CallbackSource[] {
  const staff = new Set(staffLines(env).map((line) => line.name));
  return sources.filter((source) => {
    if (source.kind !== 'outbound') return true;
    if (source.staff && staff.has(source.staff)) return true;
    const phone = digits10(source.phone);
    const t = Date.parse(source.at);
    if (!phone || !Number.isFinite(t)) return true;
    const mike = attempts.some((row) => {
      if (!DIAL_OUTCOMES.has(row.outcome)) return false;
      const at = Date.parse(row.attemptedAt || '');
      return digits10(row.phone) === phone && Number.isFinite(at) && Math.abs(at - t) <= MIKE_LEG_MS;
    });
    return !mike;
  });
}

/** A caller Mike booked is no longer waiting on the callback list. */
export function dropBookedByMike<T extends { key: string }>(rows: T[], attempts: StoredAttempt[]): T[] {
  const booked = new Set(attempts.filter((row) => row.outcome === 'booked').map((row) => row.missedCallKey));
  return rows.filter((row) => !booked.has(row.key));
}

export function callbackVapiIds(attempts: StoredAttempt[]): Set<string> {
  const ids = new Set<string>();
  for (const row of attempts) if (row.vapiCallId) ids.add(row.vapiCallId);
  return ids;
}

export function toStoredAttempt(row: Record<string, unknown>): StoredAttempt | null {
  const key = typeof row.missed_call_key === 'string' ? row.missed_call_key : '';
  const missedAt = typeof row.missed_at === 'string' ? row.missed_at : '';
  if (!key || !Number.isFinite(Date.parse(missedAt))) return null;
  return {
    id: typeof row.id === 'string' ? row.id : undefined,
    missedCallKey: key,
    phone: typeof row.caller_phone === 'string' ? row.caller_phone : null,
    fromNumber: typeof row.from_number === 'string' ? row.from_number : null,
    missedAt,
    attemptedAt: typeof row.attempted_at === 'string' ? row.attempted_at : null,
    outcome: typeof row.outcome === 'string' ? row.outcome : '',
    reason: typeof row.reason === 'string' ? row.reason : null,
    twilioCallSid: typeof row.twilio_call_sid === 'string' ? row.twilio_call_sid : null,
    vapiCallId: typeof row.vapi_call_id === 'string' ? row.vapi_call_id : null,
  };
}
