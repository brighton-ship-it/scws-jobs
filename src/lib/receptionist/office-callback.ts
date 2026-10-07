/**
 * Mid-call callback and emergency flags from Sarah.
 * Persist a booking_requests row and email the office. Never text the customer.
 * The string returned to Sarah must not include a phone number or a clock-time promise.
 */

/** Same three inboxes as end-of-call OFFICE_EMAILS on the receptionist webhook. */
export const OFFICE_ALERT_EMAILS = [
  'brighton@scwellservice.com',
  'lizbeth@scwellservice.com',
  'shanicey@scwellservice.com',
] as const;

export const CALLBACK_SPOKEN_MESSAGE =
  "I've passed this to the office and someone will call you back as soon as they can.";

export const EMERGENCY_SPOKEN_MESSAGE =
  "I've passed this to the office as an emergency and someone will call you back as soon as they can.";

const PHONE_OR_CLOCK =
  /(\+?\d[\d\s().-]{6,}\d)|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(am|pm)\b|\bwithin\s+\d+\b|\b\d+\s*(minutes?|mins?|hours?|hrs?)\b/i;

export function isSafeSarahMessage(message: string): boolean {
  return !PHONE_OR_CLOCK.test(message);
}

export type OfficeRequest = {
  kind: 'callback' | 'emergency';
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  reason: string;
  repeatCaller: boolean | null;
};

export type BookingRequestInsert = {
  service_type: string;
  customer_name: string;
  phone: string;
  email: string | null;
  address: string;
  city: string;
  notes: string;
  status: 'pending';
  source: 'phone';
  /** Set only when Sarah's webhook has a Vapi call id. Nullable in the database. */
  vapi_call_id?: string | null;
  /** One id, or several joined with `|` when one row covers multiple tool calls. */
  tool_call_id?: string | null;
};

export type OfficeRequestIdentity = {
  vapiCallId?: string | null;
  toolCallId?: string | null;
};

/** How long a same-phone office alert suppresses another email when no call id is available. */
export const OFFICE_ALERT_DEDUPE_MS = 10 * 60 * 1000;

export type OfficeAlertRow = {
  id: string;
  serviceType: string;
  notes: string;
  phone: string;
  address: string;
  city: string;
  customerName: string;
  email: string | null;
  vapiCallId: string | null;
  toolCallId: string | null;
  createdAt: string;
};

export type OfficeAlertPatch = {
  notes: string;
  serviceType: 'Emergency' | 'Callback';
  toolCallId: string | null;
  vapiCallId: string | null;
  address: string;
  city: string;
  customerName: string;
  email: string | null;
};

function textParam(params: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

/** Collapse whitespace and join the first copy of each distinct snippet. */
export function joinUniqueTexts(parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    const trimmed = (part || '').replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(trimmed);
  }
  return kept.join(' — ');
}

function flagParam(params: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
    const value = params[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^(true|yes|1)$/i.test(trimmed)) return true;
      if (/^(false|no|0)$/i.test(trimmed)) return false;
    }
  }
  return null;
}

export function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length === 10) return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  return phone.trim();
}

export function officeRequestFromTool(
  toolName: string,
  params: Record<string, unknown>,
  callPhone?: string,
): OfficeRequest {
  const flagged = toolName === 'flagEmergency'
    || flagParam(params, ['isEmergency', 'emergency', 'urgent']) === true;
  const phone = textParam(params, ['phone', 'callerPhone', 'customerPhone', 'phoneNumber'])
    || (callPhone || '').trim();
  return {
    kind: flagged ? 'emergency' : 'callback',
    name: textParam(params, ['name', 'callerName', 'customerName', 'customer_name', 'fullName']),
    phone,
    email: textParam(params, ['email', 'callerEmail']),
    address: textParam(params, ['address', 'serviceAddress', 'street']),
    city: textParam(params, ['city', 'town']),
    // First matching reason field, plus message/details even when an earlier field matched.
    // Identical text is kept once so createCallback.message and flagEmergency.details are not dropped.
    reason: joinUniqueTexts([
      textParam(params, ['reason', 'issue', 'description', 'notes', 'summary', 'problem']),
      textParam(params, ['message']),
      textParam(params, ['details']),
    ]),
    repeatCaller: flagParam(params, ['repeatCaller', 'repeat_caller', 'isRepeatCaller']),
  };
}

function whoLabel(request: OfficeRequest): string {
  const phone = request.phone ? formatPhoneDisplay(request.phone) : '';
  if (request.name && phone) return `${request.name} / ${phone}`;
  return request.name || phone || 'Unknown caller';
}

export function alertSubject(request: OfficeRequest): string {
  const who = whoLabel(request);
  if (request.kind === 'emergency') {
    const issue = (request.reason || 'emergency').replace(/\s+/g, ' ').slice(0, 80);
    return `🚨 Sarah EMERGENCY: ${who} – ${issue}`;
  }
  return `📞 Sarah callback: ${who}`;
}

export function storedPhoneFor(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return (digits || phone || 'unknown').slice(0, 20);
}

export function bookingRowForOfficeRequest(
  request: OfficeRequest,
  identity?: OfficeRequestIdentity,
): BookingRequestInsert {
  const storedPhone = storedPhoneFor(request.phone);
  const notes = [
    request.kind === 'emergency' ? 'Sarah flagged an emergency.' : 'Sarah requested a callback.',
    `Emergency: ${request.kind === 'emergency' ? 'yes' : 'no'}`,
    request.reason ? `Reason: ${request.reason}` : 'Reason: (not given)',
    request.address ? `Address: ${request.address}` : '',
    request.city ? `City: ${request.city}` : '',
    request.repeatCaller == null ? '' : `Repeat caller: ${request.repeatCaller ? 'yes' : 'no'}`,
    request.email ? `Email: ${request.email}` : '',
  ].filter(Boolean).join('\n');

  const displayPhone = request.phone ? formatPhoneDisplay(request.phone) : '';
  const customerName = request.name
    || (displayPhone ? `Caller: ${displayPhone}` : 'Unknown caller');

  const row: BookingRequestInsert = {
    service_type: request.kind === 'emergency' ? 'Emergency' : 'Callback',
    customer_name: customerName.slice(0, 255),
    phone: storedPhone,
    email: request.email || null,
    address: request.address || '',
    city: request.city || '',
    notes,
    status: 'pending',
    source: 'phone',
  };
  if (identity?.vapiCallId) row.vapi_call_id = identity.vapiCallId;
  if (identity?.toolCallId) row.tool_call_id = identity.toolCallId;
  return row;
}

export function combineOfficeRequests(requests: OfficeRequest[]): OfficeRequest {
  const first = requests[0];
  const pick = (read: (request: OfficeRequest) => string) =>
    requests.map(read).find((value) => value.trim()) || '';
  const repeat = requests.find((request) => request.repeatCaller != null)?.repeatCaller ?? null;
  return {
    kind: requests.some((request) => request.kind === 'emergency') ? 'emergency' : 'callback',
    name: pick((request) => request.name),
    phone: pick((request) => request.phone),
    email: pick((request) => request.email),
    address: pick((request) => request.address),
    city: pick((request) => request.city),
    reason: joinUniqueTexts(requests.map((request) => request.reason)),
    repeatCaller: repeat ?? first?.repeatCaller ?? null,
  };
}

export function splitToolCallIds(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split('|').map((part) => part.trim()).filter(Boolean);
}

export function appendToolCallId(existing: string | null, incoming: string | null): string | null {
  const ids = splitToolCallIds(existing);
  for (const id of splitToolCallIds(incoming)) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.length ? ids.join('|') : null;
}

export function phonesMatch(left: string, right: string): boolean {
  const normalize = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (!digits || digits === 'unknown') return '';
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  };
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && a === b);
}

function notesContain(notes: string, text: string): boolean {
  const norm = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const needle = norm(text);
  return Boolean(needle) && norm(notes).includes(needle);
}

export function appendOfficeNotes(existingNotes: string, request: OfficeRequest, upgrade: boolean): string {
  const lines: string[] = [];
  if (upgrade) lines.push('Sarah upgraded this callback to an emergency.');
  if (request.reason && !notesContain(existingNotes, request.reason)) lines.push(`Reason: ${request.reason}`);
  if (request.address && !notesContain(existingNotes, request.address)) lines.push(`Address: ${request.address}`);
  if (request.city && !notesContain(existingNotes, request.city)) lines.push(`City: ${request.city}`);
  if (lines.length === 0) return existingNotes;
  return `${existingNotes.trim()}\n${lines.join('\n')}`;
}

function pickNewest(rows: OfficeAlertRow[]): OfficeAlertRow {
  const emergencies = rows.filter((row) => row.serviceType === 'Emergency');
  const pool = emergencies.length ? emergencies : rows;
  return [...pool].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

/**
 * Prefer an exact tool-call repeat, then the same Vapi call, then the same phone
 * inside the dedupe window when the call id is missing or the stored row has none
 * (migration not applied yet). A different call id does not match by phone.
 */
export function findMatchingOfficeAlert(
  rows: OfficeAlertRow[],
  query: {
    toolCallId: string | null;
    vapiCallId: string | null;
    phone: string;
    sinceMs: number;
  },
): { row: OfficeAlertRow; matchedBy: 'tool' | 'call' | 'phone' } | null {
  const candidates = rows.filter((row) => row.serviceType === 'Emergency' || row.serviceType === 'Callback');
  const incomingIds = splitToolCallIds(query.toolCallId);
  if (incomingIds.length) {
    const toolHits = candidates.filter((row) => {
      const stored = splitToolCallIds(row.toolCallId);
      return incomingIds.some((id) => stored.includes(id));
    });
    if (toolHits.length) return { row: pickNewest(toolHits), matchedBy: 'tool' };
  }

  if (query.vapiCallId) {
    const callHits = candidates.filter((row) => row.vapiCallId && row.vapiCallId === query.vapiCallId);
    if (callHits.length) return { row: pickNewest(callHits), matchedBy: 'call' };
  }

  const phoneHits = candidates.filter((row) => {
    if (!phonesMatch(row.phone, query.phone)) return false;
    if (Date.parse(row.createdAt) < query.sinceMs) return false;
    if (query.vapiCallId && row.vapiCallId && row.vapiCallId !== query.vapiCallId) return false;
    return true;
  });
  if (phoneHits.length) return { row: pickNewest(phoneHits), matchedBy: 'phone' };
  return null;
}

export type OfficeAlertDisposition = 'insert' | 'repeat' | 'merge' | 'upgrade';

export function officeAlertDisposition(
  matchedBy: 'tool' | 'call' | 'phone' | null,
  existing: OfficeAlertRow | null,
  incomingKind: OfficeRequest['kind'],
): OfficeAlertDisposition {
  if (!existing || !matchedBy) return 'insert';
  if (matchedBy === 'tool') return 'repeat';
  if (existing.serviceType !== 'Emergency' && incomingKind === 'emergency') return 'upgrade';
  return 'merge';
}

function preferCustomerName(existing: string, incoming: string): string {
  const next = incoming.trim();
  const current = existing.trim();
  if (!next) return current.slice(0, 255);
  if (!current || current === 'Unknown caller' || current.startsWith('Caller:')) return next.slice(0, 255);
  return current.slice(0, 255);
}

const MISSING_DEDUPE_COLUMN = /vapi_call_id|tool_call_id/i;

/** PostgREST PGRST204 when the dedupe columns are not in the schema cache yet. */
export function isMissingOfficeDedupeColumnError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  if (!MISSING_DEDUPE_COLUMN.test(error.message ?? '')) return false;
  return error.code === 'PGRST204' || /schema cache|could not find/i.test(error.message ?? '');
}

export function omitOfficeDedupeColumns<T extends object>(
  row: T,
): Omit<T, 'vapi_call_id' | 'tool_call_id'> {
  const next = { ...row } as T & { vapi_call_id?: unknown; tool_call_id?: unknown };
  delete next.vapi_call_id;
  delete next.tool_call_id;
  return next;
}

export function alertText(request: OfficeRequest, bookingId?: string | null): string {
  return [
    request.kind === 'emergency'
      ? 'Sarah flagged an emergency during a live call.'
      : 'Sarah asked the office to call this person back.',
    '',
    `Name: ${request.name || 'Unknown'}`,
    `Phone: ${request.phone ? formatPhoneDisplay(request.phone) : 'Unknown'}`,
    `Email: ${request.email || 'None'}`,
    `Address: ${request.address || 'None'}`,
    `City: ${request.city || 'None'}`,
    `Reason: ${request.reason || 'None'}`,
    `Emergency: ${request.kind === 'emergency' ? 'yes' : 'no'}`,
    `Repeat caller: ${request.repeatCaller == null ? 'unknown' : request.repeatCaller ? 'yes' : 'no'}`,
    bookingId ? `Booking request: ${bookingId}` : '',
    '',
    'Do not text the customer. Call them back.',
  ].filter((line) => line !== '').join('\n');
}

export type InsertBooking = (row: BookingRequestInsert) => Promise<{ id?: string | null; error?: string | null }>;

export type SendAlert = (message: {
  to: string;
  subject: string;
  text: string;
}) => Promise<{ success?: boolean; error?: string }>;

export type UpdateOfficeAlert = (
  id: string,
  patch: OfficeAlertPatch,
) => Promise<{ error?: string | null }>;

export type LoadOfficeAlertCandidates = () => Promise<OfficeAlertRow[]>;

export type OfficeRequestDeps = {
  insertBooking: InsertBooking;
  sendAlert: SendAlert;
  loadCandidates?: LoadOfficeAlertCandidates;
  updateBooking?: UpdateOfficeAlert;
  now?: () => Date;
};

export type OfficeToolCall = {
  id: string | null;
  name: string;
  params: Record<string, unknown>;
};

export type OfficeToolOutcome = {
  id: string | null;
  body: { result: { success: boolean; message: string } };
};

const FAILURE_MESSAGE = "I couldn't pass that to the office just now. Please hold and I'll try again.";

function spokenFor(kind: OfficeRequest['kind']): string {
  return kind === 'emergency' ? EMERGENCY_SPOKEN_MESSAGE : CALLBACK_SPOKEN_MESSAGE;
}

async function deliverOfficeAlert(
  request: OfficeRequest,
  bookingId: string | null,
  sendAlert: SendAlert,
): Promise<boolean> {
  let emailSent = false;
  const subject = alertSubject(request);
  const text = alertText(request, bookingId);
  for (const to of OFFICE_ALERT_EMAILS) {
    try {
      const sent = await sendAlert({ to, subject, text });
      if (sent?.success) emailSent = true;
    } catch (error) {
      console.error(`[Receptionist] Office request email to ${to} failed:`, error);
    }
  }
  return emailSent;
}

function alertFromExisting(existing: OfficeAlertRow, request: OfficeRequest, upgrade: boolean): OfficeRequest {
  return {
    kind: upgrade ? 'emergency' : request.kind,
    name: request.name || (existing.customerName.startsWith('Caller:') ? '' : existing.customerName),
    phone: request.phone || existing.phone,
    email: request.email || existing.email || '',
    address: request.address || existing.address,
    city: request.city || existing.city,
    reason: joinUniqueTexts([request.reason]),
    repeatCaller: request.repeatCaller,
  };
}

export async function saveSarahOfficeRequest(
  request: OfficeRequest,
  deps: OfficeRequestDeps,
  identity?: OfficeRequestIdentity,
): Promise<{ success: boolean; message: string; emailSent: boolean; bookingId: string | null }> {
  const spoken = spokenFor(request.kind);
  const vapiCallId = identity?.vapiCallId || null;
  const toolCallId = identity?.toolCallId || null;
  const now = deps.now?.() ?? new Date();
  const sinceMs = now.getTime() - OFFICE_ALERT_DEDUPE_MS;

  let match: { row: OfficeAlertRow; matchedBy: 'tool' | 'call' | 'phone' } | null = null;
  if (deps.loadCandidates) {
    try {
      const candidates = await deps.loadCandidates();
      match = findMatchingOfficeAlert(candidates, {
        toolCallId,
        vapiCallId,
        phone: storedPhoneFor(request.phone),
        sinceMs,
      });
    } catch (error) {
      console.error('[Receptionist] Office alert lookup failed:', error);
      match = null;
    }
  }

  const disposition = officeAlertDisposition(match?.matchedBy ?? null, match?.row ?? null, request.kind);

  if (disposition === 'repeat' && match) {
    return {
      success: true,
      message: spoken,
      emailSent: false,
      bookingId: match.row.id,
    };
  }

  if ((disposition === 'merge' || disposition === 'upgrade') && match && deps.updateBooking) {
    const existing = match.row;
    const upgrade = disposition === 'upgrade';
    const patch: OfficeAlertPatch = {
      notes: appendOfficeNotes(existing.notes, request, upgrade),
      serviceType: upgrade || existing.serviceType === 'Emergency' ? 'Emergency' : 'Callback',
      toolCallId: appendToolCallId(existing.toolCallId, toolCallId),
      vapiCallId: existing.vapiCallId || vapiCallId,
      address: existing.address || request.address || '',
      city: existing.city || request.city || '',
      customerName: preferCustomerName(existing.customerName, request.name),
      email: existing.email || request.email || null,
    };

    if (upgrade) {
      // Email before marking the row urgent. A failed send leaves the callback
      // row unchanged so Sarah's retry still pages the office.
      const emailSent = await deliverOfficeAlert(
        alertFromExisting(existing, request, true),
        existing.id,
        deps.sendAlert,
      );
      if (!emailSent) {
        return {
          success: false,
          message: FAILURE_MESSAGE,
          emailSent: false,
          bookingId: existing.id,
        };
      }
    }

    try {
      const result = await deps.updateBooking(existing.id, patch);
      if (result?.error) console.error('[Receptionist] Office alert merge failed:', result.error);
    } catch (error) {
      console.error('[Receptionist] Office alert merge failed:', error);
    }

    return {
      success: true,
      message: spoken,
      emailSent: upgrade,
      bookingId: existing.id,
    };
  }

  let bookingId: string | null = null;
  let saved = false;
  try {
    const inserted = await deps.insertBooking(bookingRowForOfficeRequest(request, { vapiCallId, toolCallId }));
    bookingId = inserted?.id ?? null;
    saved = !inserted?.error;
  } catch (error) {
    console.error('[Receptionist] Office request insert failed:', error);
    saved = false;
  }

  const emailSent = await deliverOfficeAlert(request, bookingId, deps.sendAlert);
  const success = saved || emailSent;
  return {
    success,
    message: success ? spoken : FAILURE_MESSAGE,
    emailSent,
    bookingId,
  };
}

const OFFICE_TOOL_NAMES = new Set(['createCallback', 'flagEmergency']);

export function isOfficeAlertTool(name: string): boolean {
  return OFFICE_TOOL_NAMES.has(name);
}

/**
 * Collapse every office tool in one Vapi turn into a single booking row and
 * a single email. Parallel flagEmergency + createCallback(isEmergency) share
 * one emergency alert, and message/details from each tool are combined first.
 */
export async function resolveOfficeToolBatch(
  calls: OfficeToolCall[],
  options: {
    callPhone?: string;
    vapiCallId?: string | null;
    deps: OfficeRequestDeps;
  },
): Promise<OfficeToolOutcome[]> {
  if (calls.length === 0) return [];
  const requests = calls.map((call) => officeRequestFromTool(call.name, call.params || {}, options.callPhone));
  const combined = combineOfficeRequests(requests);
  const toolCallId = calls.map((call) => call.id).filter((id): id is string => Boolean(id)).join('|') || null;
  const saved = await saveSarahOfficeRequest(combined, options.deps, {
    vapiCallId: options.vapiCallId || null,
    toolCallId,
  });

  return calls.map((call, index) => ({
    id: call.id,
    body: {
      result: {
        success: saved.success,
        message: saved.success ? spokenFor(requests[index].kind) : saved.message,
      },
    },
  }));
}
