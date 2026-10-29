/**
 * Missed-call / hang-up text follow-up (CHIIRP-style), pure rules only.
 *
 * One text from SCWS to every inbound caller who did not end up with a real booking,
 * whether or not they reached Mike. A callback or emergency row is not a booking.
 * Replies go to the AI text conversation (text-agent.ts), which books with Mike's tools and
 * hands off to the office (Liz) when needed.
 *
 * OFF unless MISSED_CALL_TEXT_ENABLED=true. MISSED_CALL_TEXT_TEST_NUMBERS (comma list) texts
 * ONLY those numbers while the flag is unset. Nothing in this file sends anything.
 *
 * Every inbound line on the dial plan (ported Main/Ransom plus tracking numbers whose
 * Voice URL is /api/calls/inbound) is eligible. MISSED_CALL_TEXT_LINES and
 * MISSED_CALL_TEXT_LINES_EXTRA only add numbers; they cannot turn a dial-plan line off.
 */
import { digits10 } from '../ads/call-dashboard.ts';
import { isOwnNumber } from '../ads/real-leads.ts';
import { staffLines } from '../ads/staff-lines.ts';
import { type OutreachAttempt } from '../ads/callbacks.ts';
import { PORTED_LINES, TRACKING_SOURCES } from '../phone-calls/config.ts';
import { doNotCallText, zonedParts, DEFAULT_HOLD_PHRASES } from './mike-callback.ts';

/** Brighton's cell. Test calls come from here; it never gets a real follow-up text. */
export const OWNER_TEST_NUMBERS = ['4083181171', '7603312502', '7604630493'];
export const DAY_MS = 86400_000;
export const SAME_CALL_MS = 3 * 60_000;
/** Inbound replies route to the AI only this long after our text. */
export const THREAD_OPEN_MS = 72 * 3600_000;

export type TextTrigger = 'ring_hangup' | 'voicemail' | 'mike_hangup' | 'mike_unfinished';
export type WordingOption = 'A' | 'B' | 'C';

export interface TextCandidate {
  /** Stable id for the call (recording sid, voice log key, twilio parent sid, or vapi call id). */
  key: string;
  at: string;
  phone: string | null;
  calledNumber: string | null;
  trigger: TextTrigger;
  name: string | null;
  summary: string | null;
  spam: boolean;
  vendor: boolean;
  /** Set when this candidate is a Mike call, so a booking row for that call can match. */
  vapiCallId?: string | null;
}

export interface TextConfig {
  mode: 'off' | 'test' | 'full';
  testNumbers: Set<string>;
  /** Never texted, even in full mode (owner test lines, MISSED_CALL_TEXT_DNC). */
  blocked: Set<string>;
  /** Dial-plan inbound lines, plus any MISSED_CALL_TEXT_LINES / _EXTRA. Calls to other numbers, or with no known called number, are skipped. */
  lines: Set<string>;
  waitMs: number;
  lookbackMs: number;
  dedupeMs: number;
  option: WordingOption;
  timeZone: string;
  /** Quiet hours: no texts before quietStart or at/after quietEnd (local hour). Queued instead. */
  quietStart: number;
  quietEnd: number;
  maxPerRun: number;
  lineTypes: Set<string>;
  messagingServiceSid: string;
  holdPhrases: string[];
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

function num(raw: string | undefined, fallback: number, min = 0): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** 10-digit numbers that use the inbound dial plan, plus optional env additions. */
export function inboundTextLines(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const set = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const d = digits10(raw);
    if (d) set.add(d);
  };
  for (const number of Object.keys(TRACKING_SOURCES)) add(number);
  for (const line of Object.values(PORTED_LINES)) add(line.number);
  for (const part of (env.TWILIO_TRACKING_NUMBERS ?? '').split(/[,;]+/)) add(part);
  for (const part of (env.MISSED_CALL_TEXT_LINES ?? '').split(/[,;]+/)) add(part);
  for (const part of (env.MISSED_CALL_TEXT_LINES_EXTRA ?? '').split(/[,;]+/)) add(part);
  return set;
}

/** How close a Mike leg may be to the inbound recording it followed. */
export const MIKE_LINE_BEFORE_MS = 60_000;
export const MIKE_LINE_AFTER_MS = 6 * 60_000;

/**
 * Called number for a Mike hang-up. receptionist_calls does not store it.
 * Use the closest inbound recording for that caller in the handoff window.
 */
export function trackingNumberForCaller(
  phone: string | null | undefined,
  at: string,
  recordings: Array<{ phone: string | null; at: string; calledNumber: string | null }>,
): string | null {
  const d = digits10(phone);
  const t = Date.parse(at);
  if (!d || !Number.isFinite(t)) return null;
  let best: { number: string; dt: number } | null = null;
  for (const row of recordings) {
    if (digits10(row.phone) !== d) continue;
    const rt = Date.parse(row.at);
    if (!Number.isFinite(rt) || rt < t - MIKE_LINE_BEFORE_MS || rt > t + MIKE_LINE_AFTER_MS) continue;
    const n = digits10(row.calledNumber);
    if (!n) continue;
    const dt = Math.abs(rt - t);
    if (!best || dt < best.dt) best = { number: n, dt };
  }
  return best ? `+1${best.number}` : null;
}

export function textConfig(env: NodeJS.ProcessEnv = process.env): TextConfig {
  const testNumbers = numberSet(env.MISSED_CALL_TEXT_TEST_NUMBERS);
  const mode = truthy(env.MISSED_CALL_TEXT_ENABLED) ? 'full' : testNumbers.size ? 'test' : 'off';
  const blocked = numberSet(env.MISSED_CALL_TEXT_DNC);
  for (const n of OWNER_TEST_NUMBERS) blocked.add(n);
  const opt = (env.MISSED_CALL_TEXT_OPTION || 'A').trim().toUpperCase();
  const types = (env.MISSED_CALL_TEXT_LINE_TYPES || 'mobile').split(',').map((s) => s.trim()).filter(Boolean);
  const phrases = (env.MIKE_CALLBACK_HOLD_NAMES || DEFAULT_HOLD_PHRASES.join('|'))
    .split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    mode,
    testNumbers,
    blocked,
    lines: inboundTextLines(env),
    waitMs: num(env.MISSED_CALL_TEXT_WAIT_SECONDS, 60) * 1000,
    lookbackMs: num(env.MISSED_CALL_TEXT_LOOKBACK_HOURS, 12, 1) * 3600_000,
    dedupeMs: DAY_MS,
    option: opt === 'B' || opt === 'C' ? opt : 'A',
    timeZone: (env.MISSED_CALL_TEXT_TZ || 'America/Los_Angeles').trim() || 'America/Los_Angeles',
    quietStart: num(env.MISSED_CALL_TEXT_QUIET_START, 8),
    quietEnd: num(env.MISSED_CALL_TEXT_QUIET_END, 20),
    maxPerRun: Math.floor(num(env.MISSED_CALL_TEXT_MAX_PER_RUN, 5, 1)),
    lineTypes: new Set(types.length ? types : ['mobile']),
    messagingServiceSid: (env.MISSED_CALL_TEXT_MESSAGING_SERVICE_SID || env.SMS_FORWARD_MESSAGING_SERVICE_SID || 'MG66ff74e6d46a9e5439d0a2a718b3a14d').trim(),
    holdPhrases: phrases.length ? phrases : DEFAULT_HOLD_PHRASES,
  };
}

/** Whether a number may get a text (or an AI reply) in the current mode. */
export function textAllowedFor(phone: string | null | undefined, config: TextConfig): boolean {
  const d = digits10(phone);
  if (!d || config.mode === 'off') return false;
  if (config.mode === 'test') return config.testNumbers.has(d);
  return !config.blocked.has(d);
}

/**
 * Wording. Brighton approved Option A on Oct 18, 2026; it is the default (MISSED_CALL_TEXT_OPTION
 * unset). B and C stay only as alternates. Each names SCWS, says why
 * we're texting, offers ONE next step, and carries opt-out language. No prices, no links,
 * no phone numbers, nothing about bills or payments.
 */
export const WORDING: Record<WordingOption, { missed: string; cutoff: string }> = {
  A: {
    missed: "Hi, this is Mike with Southern California Well Service. Sorry we missed your call. What's going on with your well? Reply here and I can get you on the schedule. Reply STOP to opt out.",
    cutoff: "Hi, this is Mike with Southern California Well Service. Looks like we got cut off. What's going on with your well? Reply here and I can get you on the schedule. Reply STOP to opt out.",
  },
  B: {
    missed: 'Southern California Well Service here. Sorry we missed you! Text back what town the well is in and what it\'s doing, and we\'ll get a tech out. Reply STOP to opt out.',
    cutoff: 'Southern California Well Service here. Sorry we got cut off! Text back what town the well is in and what it\'s doing, and we\'ll get a tech out. Reply STOP to opt out.',
  },
  C: {
    missed: 'Hi from Southern California Well Service in Ramona and Anza. We saw your call and want to make sure you get help. Want us to set up a visit? Just reply here. Reply STOP to opt out.',
    cutoff: 'Hi from Southern California Well Service in Ramona and Anza. Your call ended before we could finish. Want us to set up a visit? Just reply here. Reply STOP to opt out.',
  },
};

export function textBody(trigger: TextTrigger, option: WordingOption): string {
  const w = WORDING[option] || WORDING.A;
  return trigger === 'mike_hangup' || trigger === 'mike_unfinished' ? w.cutoff : w.missed;
}

/** A booking_requests row, or a Jobber job/request already joined to a phone. */
export interface BookingRow {
  vapiCallId: string | null;
  phone: string | null;
  at: string;
  serviceType: string | null;
  kind?: 'booking_request' | 'jobber_job' | 'jobber_request';
}

export interface TextContext {
  laterInbound: Array<{ phone: string | null; at: string }>;
  voiceAttempts: OutreachAttempt[];
  work: Map<string, number[]>;
  /** Open Jobber-job phones. decideText does not skip on this. */
  activeJobPhones: Set<string>;
  unpaidPhones: Set<string>;
  holdPhones: Set<string>;
  holdNotes: Array<{ phone: string | null; text: string }>;
  dncPhones: Set<string>;
  /** Earlier text rows (any outcome). */
  texts: Array<{ key: string; phone: string | null; outcome: string; sentAt: string | null }>;
  staffPhones: Set<string>;
  /** Real-booking evidence. Callback and emergency rows are ignored. */
  bookings: BookingRow[];
}

export type TextDecision =
  | { action: 'send'; to: string; body: string }
  | { action: 'queue'; reason: 'too_soon' | 'quiet_hours'; to: string; body: string; notBefore: string }
  | { action: 'skip'; reason: string };

const NON_CUSTOMER = /wrong number|misdial|robocall|recorded message|automated (message|call)|press \d|this message is intended|survey|telemarket|solicit|job (application|opening)|looking for work|applying/i;

export function isQuiet(date: Date, config: TextConfig): boolean {
  const h = zonedParts(date, config.timeZone).hour;
  return h < config.quietStart || h >= config.quietEnd;
}

/** Next instant outside quiet hours (top of quietStart), or `from` if not quiet. */
export function nextSendable(from: Date, config: TextConfig): Date {
  if (!isQuiet(from, config)) return from;
  for (let m = 15; m <= 24 * 60; m += 15) {
    const t = new Date(from.getTime() + m * 60_000);
    if (!isQuiet(t, config)) {
      const p = zonedParts(t, config.timeZone);
      return new Date(t.getTime() - p.minute * 60_000 - t.getSeconds() * 1000 - t.getMilliseconds());
    }
  }
  return new Date(from.getTime() + DAY_MS);
}

/**
 * The one decision per call. `lineType` comes from Twilio Lookup (null = not looked up yet,
 * which the runner does only for calls that pass every other rule).
 */
export function decideText(
  call: TextCandidate,
  ctx: TextContext,
  config: TextConfig,
  now: Date,
  lineType: string | null | undefined,
): TextDecision {
  const phone = digits10(call.phone);
  const at = Date.parse(call.at);
  if (config.mode === 'off') return { action: 'skip', reason: 'flag_off' };
  if (!phone || !Number.isFinite(at)) return { action: 'skip', reason: 'no_phone' };
  if (isOwnNumber(call.phone) || ctx.staffPhones.has(phone)) return { action: 'skip', reason: 'own_number' };
  if (config.mode === 'test' && !config.testNumbers.has(phone)) return { action: 'skip', reason: 'not_allowlisted' };
  if (config.mode === 'full' && config.blocked.has(phone)) return { action: 'skip', reason: 'test_number' };
  if (config.lines.size && !config.lines.has(digits10(call.calledNumber) || '')) return { action: 'skip', reason: 'line_not_enabled' };
  if (/^8(00|33|44|55|66|77|88)/.test(phone)) return { action: 'skip', reason: 'toll_free' };
  if (now.getTime() - at > config.lookbackMs) return { action: 'skip', reason: 'stale' };
  if (call.spam || NON_CUSTOMER.test(call.summary || '')) return { action: 'skip', reason: 'spam' };
  if (call.vendor) return { action: 'skip', reason: 'vendor' };
  if (ctx.texts.some((row) => row.key === call.key)) return { action: 'skip', reason: 'already_handled' };
  const recent = ctx.texts.some((row) => {
    if (digits10(row.phone) !== phone) return false;
    if (row.outcome !== 'sent' && row.outcome !== 'sending') return false;
    const t = Date.parse(row.sentAt || '');
    return Number.isFinite(t) && now.getTime() - t < config.dedupeMs;
  });
  if (recent) return { action: 'skip', reason: 'texted_24h' };
  if (ctx.dncPhones.has(phone) || doNotCallText(call.name, call.summary)) return { action: 'skip', reason: 'opted_out' };
  if (mikeCallFinished({ vapiCallId: call.vapiCallId ?? null, phone: call.phone, at: call.at }, ctx.bookings ?? [])) {
    return { action: 'skip', reason: 'booked' };
  }

  const to = `+1${phone}`;
  const body = textBody(call.trigger, config.option);
  const readyAt = at + config.waitMs;
  if (now.getTime() < readyAt) {
    return { action: 'queue', reason: 'too_soon', to, body, notBefore: new Date(readyAt).toISOString() };
  }
  if (isQuiet(now, config)) {
    return { action: 'queue', reason: 'quiet_hours', to, body, notBefore: nextSendable(now, config).toISOString() };
  }
  if (lineType === null || lineType === undefined) return { action: 'queue', reason: 'too_soon', to, body, notBefore: now.toISOString() };
  if (!config.lineTypes.has(lineType)) return { action: 'skip', reason: `not_mobile:${lineType || 'unknown'}` };
  return { action: 'send', to, body };
}

/** Newest call per number wins; older calls from the same number in the window are the same episode. */
export function newestPerPhone(calls: TextCandidate[]): TextCandidate[] {
  const seen = new Set<string>();
  const out: TextCandidate[] = [];
  for (const call of [...calls].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const p = digits10(call.phone);
    if (p && seen.has(p)) continue;
    if (p) seen.add(p);
    out.push(call);
  }
  return out;
}

export function staffPhoneSet(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(staffLines(env).map((l) => digits10(l.phone)).filter((p): p is string => !!p));
}

/**
 * A booking_requests row counts only when it is a job or an assessment.
 * Callback, emergency, phone inquiry, and "needs callback" rows do not.
 */
export function isRealBookingServiceType(serviceType: string | null | undefined): boolean {
  const t = (serviceType || '').trim();
  if (!t) return false;
  if (/^(callback|emergency)$/i.test(t)) return false;
  if (/phone inquiry|sms inquiry|^needs callback\b/i.test(t)) return false;
  return /\bjob\b|assessment/i.test(t);
}

function bookingCounts(row: BookingRow): boolean {
  if (row.kind === 'jobber_job' || row.kind === 'jobber_request') return true;
  return isRealBookingServiceType(row.serviceType);
}

/**
 * True only for a real booking: a job/assessment booking_requests row, or a Jobber
 * job/request for that phone created after the call. Callback and emergency do not finish the call.
 * Clock skew of two minutes still counts as this call.
 */
export function mikeCallFinished(
  call: { vapiCallId: string | null; phone: string | null; at: string },
  rows: BookingRow[],
): boolean {
  const p = digits10(call.phone);
  const t = Date.parse(call.at);
  return rows.some((row) => {
    if (!bookingCounts(row)) return false;
    if (call.vapiCallId && row.vapiCallId && row.vapiCallId === call.vapiCallId) return true;
    const rt = Date.parse(row.at);
    return !!p && digits10(row.phone) === p && Number.isFinite(rt) && Number.isFinite(t) && rt >= t - 2 * 60_000;
  });
}

/** A shop leg is a real answer only at or above this. Shorter pickups are Google Voice or a hang-up. */
export const SHOP_ANSWERED_MIN_SECONDS = 20;

const OPEN_CALL = new Set(['queued', 'ringing', 'in-progress']);
const MISSED_LEG = new Set(['no-answer', 'busy', 'failed', 'canceled', 'cancelled']);

/** One Twilio call resource, parent or child. */
export interface TwilioLeg {
  sid: string;
  parentSid: string | null;
  from: string | null;
  to: string | null;
  direction: string;
  status: string;
  at: string | null;
  durationSeconds: number | null;
}

export interface ClassifiedParent {
  sid: string;
  at: string;
  phone: string | null;
  /** Shop leg connected for at least SHOP_ANSWERED_MIN_SECONDS. Not a text candidate. */
  shopAnswered: boolean;
  candidate: TextCandidate | null;
}

export function parseTwilioLegs(payload: unknown): TwilioLeg[] {
  const calls = payload && typeof payload === 'object' && Array.isArray((payload as { calls?: unknown }).calls)
    ? (payload as { calls: unknown[] }).calls
    : [];
  const legs: TwilioLeg[] = [];
  for (const raw of calls) {
    const c = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    if (!c) continue;
    const sid = typeof c.sid === 'string' ? c.sid : '';
    if (!sid) continue;
    const parent = typeof c.parent_call_sid === 'string' && c.parent_call_sid ? c.parent_call_sid : null;
    const started = typeof c.start_time === 'string' ? c.start_time : typeof c.date_created === 'string' ? c.date_created : null;
    const t = started ? Date.parse(started) : NaN;
    const duration = c.duration == null || c.duration === '' ? null : Number(c.duration);
    legs.push({
      sid,
      parentSid: parent,
      from: typeof c.from === 'string' ? c.from : null,
      to: typeof c.to === 'string' ? c.to : null,
      direction: typeof c.direction === 'string' ? c.direction : '',
      status: typeof c.status === 'string' ? c.status : '',
      at: Number.isFinite(t) ? new Date(t).toISOString() : null,
      durationSeconds: duration != null && Number.isFinite(duration) ? Math.round(duration) : null,
    });
  }
  return legs;
}

function legMissed(leg: TwilioLeg): boolean {
  if (MISSED_LEG.has(leg.status.toLowerCase())) return true;
  return leg.durationSeconds === 0;
}

function mikeLeg(leg: TwilioLeg, mikeNumbers: Set<string>): boolean {
  const to = digits10(leg.to);
  return !!to && mikeNumbers.has(to);
}

/** Same caller within a few minutes: one inbound episode (parent plus the Mike row that followed). */
export function sameTextEpisode(
  a: { phone: string | null; at: string },
  b: { phone: string | null; at: string },
  windowMs = 6 * 60_000,
): boolean {
  const pa = digits10(a.phone);
  const pb = digits10(b.phone);
  const ta = Date.parse(a.at);
  const tb = Date.parse(b.at);
  return !!pa && pa === pb && Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) <= windowMs;
}

/**
 * Inbound parent calls to SCWS numbers.
 * A shop leg counts as answered only when it connected for at least ~20s.
 * Otherwise the parent is a candidate: ring_hangup when Mike never connected, mike_unfinished when he did.
 * A still-open parent is left for the next run.
 */
export function classifyInboundParents(input: {
  legs: TwilioLeg[];
  lines: Set<string>;
  mikeNumbers: Set<string>;
  sinceMs?: number;
}): ClassifiedParent[] {
  const children = new Map<string, TwilioLeg[]>();
  for (const leg of input.legs) {
    if (!leg.parentSid || leg.parentSid === leg.sid) continue;
    const list = children.get(leg.parentSid) ?? [];
    list.push(leg);
    children.set(leg.parentSid, list);
  }
  const out: ClassifiedParent[] = [];
  for (const leg of input.legs) {
    if (leg.parentSid) continue;
    if (!leg.direction.toLowerCase().startsWith('inbound')) continue;
    if (OPEN_CALL.has(leg.status.toLowerCase())) continue;
    const line = digits10(leg.to);
    if (!line || (input.lines.size > 0 && !input.lines.has(line))) continue;
    if (!leg.at) continue;
    const started = Date.parse(leg.at);
    if (input.sinceMs != null && (!Number.isFinite(started) || started < input.sinceMs)) continue;
    const kids = children.get(leg.sid) ?? [];
    const shopAnswered = kids.some((child) => !mikeLeg(child, input.mikeNumbers) && !legMissed(child) && (child.durationSeconds ?? 0) >= SHOP_ANSWERED_MIN_SECONDS);
    const reachedMike = kids.some((child) => mikeLeg(child, input.mikeNumbers) && !legMissed(child) && (child.durationSeconds ?? 1) > 0);
    const phone = digits10(leg.from);
    if (shopAnswered) {
      out.push({ sid: leg.sid, at: leg.at, phone: leg.from, shopAnswered: true, candidate: null });
      continue;
    }
    out.push({
      sid: leg.sid,
      at: leg.at,
      phone: leg.from,
      shopAnswered: false,
      candidate: {
        key: `twilio:${leg.sid}`,
        at: leg.at,
        phone: phone ? `+1${phone}` : leg.from,
        calledNumber: `+1${line}`,
        trigger: reachedMike ? 'mike_unfinished' : 'ring_hangup',
        name: null,
        summary: null,
        spam: false,
        vendor: false,
      },
    });
  }
  return out;
}

/** Caller lines in a Vapi transcript ("User: ..."). */
export function callerTurns(transcript: string | null | undefined): number {
  return (transcript || '').split('\n').filter((l) => /^\s*(user|customer):/i.test(l)).length;
}

/** STOP-style keywords (carrier standard set). */
export const STOP_WORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out|revoke)\s*[.!]*\s*$/i;
export const START_WORDS = /^\s*(start|unstop|yes start)\s*[.!]*\s*$/i;
export const HELP_WORDS = /^\s*(help|info)\s*[.!?]*\s*$/i;
