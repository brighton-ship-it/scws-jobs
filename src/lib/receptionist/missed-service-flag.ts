/**
 * Log-only backstop for a service caller who hung up with no booking and no callback.
 * Writes a note and a booking label. Does not text, dial, or email on its own, and does not
 * read the callback flag. Mike's callback cron selects missed calls on its own tables.
 */

export type ToolOutcome = { booked: boolean; callbackLogged: boolean; emergencyFlagged: boolean };

export const AUTO_FLAG_NOTE =
  'AUTO-FLAG: service caller ended with no booking or callback. Needs office callback.';
export const AUTO_FLAG_BOOKING_PREFIX = '⚠️ Auto-flag: hung up before booking/callback.';
export const AUTO_FLAG_EMAIL_LINE = 'Auto-flagged: needs callback';

const BOOK_TOOLS = new Set(['book_job', 'bookJob', 'bookServiceCall']);

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function unwrapResult(value: unknown): AnyRecord | null {
  let current = parseJson(value);
  if (typeof current === 'string') current = parseJson(current);
  const record = asRecord(current);
  if (!record) return null;
  const nested = asRecord(record.result);
  return nested || record;
}

function accepted(result: AnyRecord | null): boolean {
  if (!result) return false;
  if (result.success === false || result.ok === false || result.error) return false;
  return result.success === true || result.ok === true;
}

/** Scan artifact.messages for tool calls and their results. */
export function toolOutcomes(messages: any[]): ToolOutcome {
  const outcome: ToolOutcome = { booked: false, callbackLogged: false, emergencyFlagged: false };
  const nameById = new Map<string, string>();

  for (const message of messages || []) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'tool_calls' || message.role === 'assistant') {
      const list = parseJson(message.toolCalls ?? message.tool_calls);
      for (const call of Array.isArray(list) ? list : []) {
        const record = asRecord(call);
        const fn = asRecord(record?.function);
        if (!record || !fn) continue;
        if (typeof record.id === 'string') nameById.set(record.id, String(fn.name || ''));
      }
    }
  }

  for (const message of messages || []) {
    if (!message || typeof message !== 'object') continue;
    const isResult =
      message.role === 'tool_call_result' ||
      message.role === 'tool' ||
      (message.result != null && message.name && message.role !== 'tool_calls');
    if (!isResult) continue;
    const id = typeof message.toolCallId === 'string'
      ? message.toolCallId
      : typeof message.tool_call_id === 'string'
        ? message.tool_call_id
        : '';
    const name = String(message.name || (id ? nameById.get(id) : '') || '');
    const result = unwrapResult(message.result ?? message.content);
    if (!result) continue;
    if (BOOK_TOOLS.has(name) && result.booked === true) outcome.booked = true;
    else if (name === 'createCallback' && accepted(result)) outcome.callbackLogged = true;
    else if (name === 'flagEmergency' && accepted(result)) outcome.emergencyFlagged = true;
  }

  return outcome;
}

const SERVICE_WORDS =
  /\b(?:no water|new pump|pump|pressure|leak|tank|squeak|cycling|breaker)\b/i;
const DRILLING_QUOTE = /drill(?:ing)?\s+quote/i;

function excludedLabel(value: string): boolean {
  const n = value.trim().toLowerCase();
  if (!n) return true;
  if (n === 'phone inquiry') return true;
  return /\b(?:invoice|billing|sales|robocall)\b/.test(n);
}

function serviceLanguage(text: string): boolean {
  if (SERVICE_WORDS.test(text)) return true;
  return /\bwell\b/i.test(text) && !DRILLING_QUOTE.test(text);
}

/**
 * True when serviceNeeded is a real service request, or the summary/transcript
 * talks about water, a pump, a leak, and the other service words Mike hears.
 */
export function isServiceIntent(input: {
  serviceNeeded?: string | null;
  summary?: string | null;
  transcript?: string | null;
}): boolean {
  const label = String(input.serviceNeeded || '').trim();
  if (label && !excludedLabel(label)) return true;
  return serviceLanguage(`${input.summary || ''}\n${input.transcript || ''}`);
}

export function needsCallbackFlag(
  outcome: ToolOutcome,
  intent: boolean,
  opts: { isTestCall: boolean; callbackAttempt: boolean },
): boolean {
  return intent && !outcome.booked && !outcome.callbackLogged && !outcome.emergencyFlagged && !opts.isTestCall && !opts.callbackAttempt;
}

export function needsCallbackServiceType(serviceNeeded?: string | null): string {
  const label = String(serviceNeeded || '').trim();
  return `Needs callback: ${label || 'Service request'}`;
}

export type MissedServiceFlag = {
  flag: boolean;
  notes: string | null;
  needsCallback: boolean;
  serviceType: string | null;
  bookingNotesPrefix: string | null;
  emailLine: string | null;
  log: { vapiCallId: string; phone: string } | null;
};

export function buildMissedServiceFlag(input: {
  messages?: any[] | null;
  serviceNeeded?: string | null;
  summary?: string | null;
  transcript?: string | null;
  isTestCall: boolean;
  callbackAttempt: boolean;
  vapiCallId: string;
  phone: string;
}): MissedServiceFlag {
  const flag = needsCallbackFlag(
    toolOutcomes(input.messages || []),
    isServiceIntent(input),
    { isTestCall: input.isTestCall, callbackAttempt: input.callbackAttempt },
  );
  if (!flag) {
    return {
      flag: false,
      notes: null,
      needsCallback: false,
      serviceType: null,
      bookingNotesPrefix: null,
      emailLine: null,
      log: null,
    };
  }
  return {
    flag: true,
    notes: AUTO_FLAG_NOTE,
    needsCallback: true,
    serviceType: needsCallbackServiceType(input.serviceNeeded),
    bookingNotesPrefix: AUTO_FLAG_BOOKING_PREFIX,
    emailLine: AUTO_FLAG_EMAIL_LINE,
    log: { vapiCallId: input.vapiCallId, phone: input.phone },
  };
}

/** Writes this flag performs. No SMS, dial, or office-alert tool. */
export function missedServiceFlagOperations(flag: boolean): string[] {
  if (!flag) return [];
  return [
    'receptionist_calls.notes',
    'receptionist_calls.needs_callback',
    'receptionist_calls.status=pending',
    'booking_requests.service_type',
    'booking_requests.notes',
    'console.log',
    'end-of-call email line',
  ];
}

export function isMissingNeedsCallbackColumn(
  error: { message?: string | null; code?: string | number | null; details?: string | null; hint?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  const text = [error.message, error.details, error.hint].filter((part) => !!part).join(' ');
  if (!/needs_callback/i.test(text)) return false;
  const code = String(error.code ?? '');
  return code === '42703' || code === 'PGRST204' || /does not exist|schema cache|could not find/i.test(text);
}
