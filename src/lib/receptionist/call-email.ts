/**
 * One office email per Mike call.
 *
 * Mid-call tools (flagEmergency, createCallback, book_job) no longer email.
 * The end-of-call report reads what Mike did from the call's tool messages and
 * sends a single email whose subject reflects the outcome. A cron fallback
 * (see /api/cron/receptionist-alert-fallback) pages the office for an
 * emergency/callback if the end-of-call report never arrives.
 */
import { formatPhoneDisplay, joinUniqueTexts } from './office-callback.ts';

export type CallOutcomeKind = 'booked' | 'emergency' | 'callback' | 'none';

export type CallOutcome = {
  kind: CallOutcomeKind;
  /** Mike flagged an emergency (also true when the call was booked). */
  emergency: boolean;
  callback: boolean;
  booked: boolean;
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  issue: string;
  /** e.g. "Thursday, October 15, between 10:00 AM and 12:00 PM" */
  window: string;
  /** e.g. "Thursday, October 15 8-10 AM" short form for subjects */
  windowShort: string;
  technician: string;
  jobberUrl: string;
  jobId: string;
};

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

function str(params: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function truthy(value: unknown): boolean {
  return value === true || (typeof value === 'string' && /^(true|yes|1)$/i.test(value.trim()));
}

/** Jobber ids are base64 of gid://Jobber/Job/<n>. Returns the numeric id or ''. */
export function jobberNumericId(gid: string | null | undefined): string {
  const raw = (gid || '').trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const match = decoded.match(/\/(\d+)$/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

export function jobberJobUrl(gid: string | null | undefined): string {
  const id = jobberNumericId(gid);
  return id ? `https://secure.getjobber.com/jobs/${id}` : '';
}

const BOOK_TOOLS = new Set(['book_job', 'bookJob', 'bookServiceCall']);
const OFFICE_TOOLS = new Set(['flagEmergency', 'createCallback']);

/** ("Thursday, October 15", "between 10:00 AM and 12:00 PM") -> "Thursday, October 15 10-12 AM". */
export function shortWindow(date: string, time: string): string {
  const day = (date || '').trim();
  const m = (time || '').match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)\s*and\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)/i);
  let span = time || '';
  if (m) {
    const [, a, , ap, b, , bp] = m;
    span = ap.toUpperCase() === bp.toUpperCase()
      ? `${a}-${b} ${bp.toUpperCase()}`
      : `${a} ${ap.toUpperCase()}-${b} ${bp.toUpperCase()}`;
  }
  return [day, span].filter(Boolean).join(' ');
}

export type VapiMessageLike = AnyRecord;

/**
 * Read Mike's actions from the end-of-call artifact messages.
 * Vapi emits `tool_calls` (toolCalls[].function.{name,arguments}) followed by
 * `tool_call_result` ({ name, result, toolCallId }).
 */
export function extractCallOutcome(
  messages: VapiMessageLike[] | null | undefined,
  fallback: { name?: string; phone?: string; address?: string; city?: string; issue?: string } = {},
): CallOutcome {
  const outcome: CallOutcome = {
    kind: 'none',
    emergency: false,
    callback: false,
    booked: false,
    name: fallback.name || '',
    phone: fallback.phone || '',
    email: '',
    address: fallback.address || '',
    city: fallback.city || '',
    issue: fallback.issue || '',
    window: '',
    windowShort: '',
    technician: '',
    jobberUrl: '',
    jobId: '',
  };

  const argsById = new Map<string, { name: string; params: AnyRecord }>();
  const issues: string[] = [];
  let bookArgs: AnyRecord | null = null;
  const toolName = (message: VapiMessageLike) => String(message.name || '');

  const takeParams = (params: AnyRecord) => {
    outcome.name = str(params, ['name', 'callerName', 'customerName', 'customer_name', 'fullName']) || outcome.name;
    outcome.phone = str(params, ['phone', 'callerPhone', 'customerPhone']) || outcome.phone;
    outcome.email = str(params, ['email', 'callerEmail']) || outcome.email;
    outcome.address = str(params, ['address', 'serviceAddress', 'street']) || outcome.address;
    outcome.city = str(params, ['city', 'town']) || outcome.city;
    issues.push(str(params, ['reason', 'issue', 'description', 'notes', 'summary', 'problem']));
    issues.push(str(params, ['message']));
    issues.push(str(params, ['details']));
  };

  for (const message of messages || []) {
    if (message.role === 'tool_calls' || message.role === 'assistant') {
      const list = parseJson(message.toolCalls ?? message.tool_calls);
      for (const call of Array.isArray(list) ? list : []) {
        const record = asRecord(call);
        const fn = asRecord(record?.function);
        if (!record || !fn) continue;
        const name = String(fn.name || '');
        const params = asRecord(parseJson(fn.arguments)) || {};
        if (typeof record.id === 'string') argsById.set(record.id, { name, params });
      }
    }
  }

  for (const message of messages || []) {
    if (message.role !== 'tool_call_result' && message.role !== 'tool') continue;
    const id = typeof message.toolCallId === 'string' ? message.toolCallId : typeof message.tool_call_id === 'string' ? message.tool_call_id : '';
    const call = id ? argsById.get(id) : undefined;
    const name = toolName(message) || call?.name || '';
    let result = asRecord(parseJson(message.result ?? message.content));
    if (result && asRecord(result.result)) result = asRecord(result.result);
    if (!result) continue;

    if (OFFICE_TOOLS.has(name)) {
      // Count only a tool the server accepted.
      if (result.success === false || result.error) continue;
      if (call) takeParams(call.params);
      const flagged = name === 'flagEmergency' || (call && truthy(call.params.isEmergency ?? call.params.emergency ?? call.params.urgent));
      if (flagged) outcome.emergency = true;
      else outcome.callback = true;
    } else if (BOOK_TOOLS.has(name)) {
      if (call) bookArgs = call.params;
      if (result.weekendEmergency === true) outcome.emergency = true;
      const visit = asRecord(result.visit);
      if (result.booked === true && visit) {
        outcome.booked = true;
        outcome.jobId = String(visit.jobId || '');
        outcome.jobberUrl = jobberJobUrl(String(visit.jobId || ''));
        const date = String(visit.date || '');
        const time = String(visit.time || '');
        outcome.window = [date, time].filter(Boolean).join(', ');
        outcome.windowShort = shortWindow(date, time);
        const techs = Array.isArray(visit.technicians) ? visit.technicians.map(String) : [];
        outcome.technician = techs.join(' and ') || String(result.assignedTechName || '');
      }
    }
  }

  if (bookArgs && (outcome.booked || !outcome.name)) takeParams(bookArgs);
  const joined = joinUniqueTexts(issues);
  if (joined) outcome.issue = joined;

  outcome.kind = outcome.booked ? 'booked' : outcome.emergency ? 'emergency' : outcome.callback ? 'callback' : 'none';
  return outcome;
}

function who(outcome: CallOutcome, fallbackName: string): string {
  const name = outcome.name || fallbackName;
  return name || (outcome.phone ? formatPhoneDisplay(outcome.phone) : 'Unknown caller');
}

export function callEmailSubject(outcome: CallOutcome, opts: { fallbackName?: string; urgent?: boolean } = {}): string {
  const name = who(outcome, opts.fallbackName || '');
  if (outcome.booked && outcome.emergency) {
    return `🚨 Mike EMERGENCY (booked ${outcome.windowShort || 'service call'}): ${name}`;
  }
  if (outcome.booked) return `✅ Mike BOOKED: ${name}${outcome.windowShort ? ` ${outcome.windowShort}` : ''}`;
  if (outcome.emergency) return `🚨 Mike EMERGENCY: ${name}`;
  if (outcome.callback) return `📞 Mike callback: ${name}${opts.urgent ? ' ⚠️ URGENT' : ''}`;
  return `📞 Mike call: ${name}${opts.urgent ? ' ⚠️ URGENT' : ''}`;
}

export function whatMikeDid(outcome: CallOutcome): string {
  const lines: string[] = [];
  if (outcome.booked) {
    lines.push(`Booked a $200 service call: ${outcome.window || 'see Jobber'}${outcome.technician ? ` with ${outcome.technician}` : ''}.`);
  }
  if (outcome.emergency) {
    lines.push(outcome.booked
      ? 'Flagged an emergency (no-water). The visit above is the earliest weekday slot; the on-call team still needs to decide about sooner help.'
      : 'Flagged an emergency. No visit was booked. Call them back now.');
  }
  if (outcome.callback && !outcome.booked) lines.push('Asked the office to call this person back.');
  if (!outcome.booked && !outcome.emergency && !outcome.callback) lines.push('Took the call. No booking, emergency flag or callback request was made.');
  return lines.join(' ');
}

export type CallEmailInput = {
  outcome: CallOutcome;
  fallbackName?: string;
  fallbackPhone?: string;
  fallbackAddress?: string;
  fallbackIssue?: string;
  urgent?: boolean;
  summary?: string;
  transcript?: string;
  timeLabel?: string;
  durationLabel?: string;
  appUrl?: string;
  customerId?: string | null;
};

export function buildCallEmail(input: CallEmailInput): { subject: string; text: string } {
  const { outcome } = input;
  const name = outcome.name || input.fallbackName || '';
  const phone = outcome.phone || input.fallbackPhone || '';
  const address = [outcome.address || input.fallbackAddress || '', outcome.city].filter(Boolean).join(', ');
  const issue = outcome.issue || input.fallbackIssue || '';
  const app = input.appUrl || 'https://scws-jobs.vercel.app';
  const text = [
    `Outcome: ${whatMikeDid(outcome)}`,
    '',
    `Caller: ${name || 'Unknown'}`,
    `Number: ${phone ? formatPhoneDisplay(phone) : 'Unknown'}`,
    outcome.email ? `Email: ${outcome.email}` : null,
    `Address: ${address || 'Not given'}`,
    `Issue: ${issue || 'Not given'}`,
    input.timeLabel ? `Call time: ${input.timeLabel}${input.durationLabel ? ` (${input.durationLabel})` : ''}` : null,
    input.urgent ? '⚠️ Caller sounded urgent.' : null,
    outcome.booked ? `Jobber: ${outcome.jobberUrl || '(job created; link unavailable)'}` : null,
    '',
    'SUMMARY:',
    input.summary || 'No summary available',
    '',
    'Do not text the customer from this email.',
    '',
    'FULL TRANSCRIPT:',
    input.transcript || 'No transcript available',
    '',
    '---',
    input.customerId ? `View Customer: ${app}/customers/${input.customerId}` : null,
    `View Requests: ${app}/requests`,
  ].filter((line): line is string => line !== null).join('\n').trim();
  return { subject: callEmailSubject(outcome, { fallbackName: input.fallbackName, urgent: input.urgent }), text };
}
