/**
 * Missed-call / hang-up text follow-up (CHIIRP-style), pure rules only.
 *
 * One text from SCWS to a caller whose call ended without a booking, a callback or an
 * emergency flag: they hung up while the line rang, hung up on Mike, or Mike didn't finish.
 * Replies go to the AI text conversation (text-agent.ts), which books with Mike's tools and
 * hands off to the office (Liz) when needed.
 *
 * OFF unless MISSED_CALL_TEXT_ENABLED=true. MISSED_CALL_TEXT_TEST_NUMBERS (comma list) texts
 * ONLY those numbers while the flag is unset. Nothing in this file sends anything.
 */
import { digits10 } from '../ads/call-dashboard.ts';
import { isOwnNumber } from '../ads/real-leads.ts';
import { staffLines } from '../ads/staff-lines.ts';
import { hasWorkOnOrAfter, type OutreachAttempt } from '../ads/callbacks.ts';
import { doNotCallText, matchesCollectionsHold, zonedParts, DEFAULT_HOLD_PHRASES } from './mike-callback.ts';

/** Brighton's cell. Test calls come from here; it never gets a real follow-up text. */
export const OWNER_TEST_NUMBERS = ['4083181171', '7603312502', '7604630493'];
export const DAY_MS = 86400_000;
export const SAME_CALL_MS = 3 * 60_000;
/** Inbound replies route to the AI only this long after our text. */
export const THREAD_OPEN_MS = 72 * 3600_000;

export type TextTrigger = 'ring_hangup' | 'voicemail' | 'mike_hangup' | 'mike_unfinished';
export type WordingOption = 'A' | 'B' | 'C';

export interface TextCandidate {
  /** Stable id for the call (recording sid, voice log key, or vapi call id). */
  key: string;
  at: string;
  phone: string | null;
  calledNumber: string | null;
  trigger: TextTrigger;
  name: string | null;
  summary: string | null;
  spam: boolean;
  vendor: boolean;
}

export interface TextConfig {
  mode: 'off' | 'test' | 'full';
  testNumbers: Set<string>;
  /** Never texted, even in full mode (owner test lines, MISSED_CALL_TEXT_DNC). */
  blocked: Set<string>;
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
 * Draft wording for Brighton to pick (MISSED_CALL_TEXT_OPTION). Each names SCWS, says why
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

export interface TextContext {
  laterInbound: Array<{ phone: string | null; at: string }>;
  voiceAttempts: OutreachAttempt[];
  work: Map<string, number[]>;
  /** Phones on a client with an open (not archived) Jobber job: mid-job customers. */
  activeJobPhones: Set<string>;
  unpaidPhones: Set<string>;
  holdPhones: Set<string>;
  holdNotes: Array<{ phone: string | null; text: string }>;
  dncPhones: Set<string>;
  /** Earlier text rows (any outcome). */
  texts: Array<{ key: string; phone: string | null; outcome: string; sentAt: string | null }>;
  staffPhones: Set<string>;
}

export type TextDecision =
  | { action: 'send'; to: string; body: string }
  | { action: 'queue'; reason: 'too_soon' | 'quiet_hours'; to: string; body: string; notBefore: string }
  | { action: 'skip'; reason: string };

const NON_CUSTOMER = /wrong number|misdial|robocall|recorded message|automated (message|call)|press \d|this message is intended|survey|telemarket|solicit|job (application|opening)|looking for work|applying/i;

function calledAgain(phone: string, afterMs: number, rows: Array<{ phone: string | null; at: string }>): boolean {
  return rows.some((row) => {
    const t = Date.parse(row.at);
    return digits10(row.phone) === phone && Number.isFinite(t) && t > afterMs + SAME_CALL_MS;
  });
}

function shopCalledBack(phone: string, afterMs: number, attempts: OutreachAttempt[]): boolean {
  return attempts.some((row) => {
    const t = Date.parse(row.at);
    return digits10(row.phone) === phone && Number.isFinite(t) && t > afterMs;
  });
}

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
  const notes = ctx.holdNotes.filter((row) => !row.phone || digits10(row.phone) === phone).map((row) => row.text);
  if (ctx.holdPhones.has(phone) || matchesCollectionsHold({ name: call.name, summary: call.summary, notes, phrases: config.holdPhrases })) {
    return { action: 'skip', reason: 'hold' };
  }
  if (ctx.unpaidPhones.has(phone)) return { action: 'skip', reason: 'existing_customer_open_invoice' };
  if (ctx.activeJobPhones.has(phone)) return { action: 'skip', reason: 'active_job' };
  if (hasWorkOnOrAfter(call.phone, call.at, ctx.work)) return { action: 'skip', reason: 'jobber_work' };
  if (calledAgain(phone, at, ctx.laterInbound)) return { action: 'skip', reason: 'called_again' };
  if (shopCalledBack(phone, at, ctx.voiceAttempts)) return { action: 'skip', reason: 'shop_called_back' };

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

/** Mike calls: was the call finished (booked, callback or emergency logged)? */
export function mikeCallFinished(
  call: { vapiCallId: string | null; phone: string | null; at: string },
  officeRows: Array<{ vapiCallId: string | null; phone: string | null; at: string; serviceType: string | null }>,
): boolean {
  const p = digits10(call.phone);
  const t = Date.parse(call.at);
  return officeRows.some((row) => {
    if (!/^(callback|emergency)$/i.test((row.serviceType || '').trim())) return false;
    if (call.vapiCallId && row.vapiCallId === call.vapiCallId) return true;
    const rt = Date.parse(row.at);
    return !!p && digits10(row.phone) === p && Number.isFinite(rt) && Number.isFinite(t) && rt >= t - 2 * 60_000 && rt <= t + 20 * 60_000;
  });
}

/** Caller lines in a Vapi transcript ("User: ..."). */
export function callerTurns(transcript: string | null | undefined): number {
  return (transcript || '').split('\n').filter((l) => /^\s*(user|customer):/i.test(l)).length;
}

/** STOP-style keywords (carrier standard set). */
export const STOP_WORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out|revoke)\s*[.!]*\s*$/i;
export const START_WORDS = /^\s*(start|unstop|yes start)\s*[.!]*\s*$/i;
export const HELP_WORDS = /^\s*(help|info)\s*[.!?]*\s*$/i;
