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
};

function textParam(params: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
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
    reason: textParam(params, ['reason', 'issue', 'description', 'notes', 'summary', 'message', 'problem']),
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

export function bookingRowForOfficeRequest(request: OfficeRequest): BookingRequestInsert {
  const digits = request.phone.replace(/\D/g, '');
  const storedPhone = (digits || request.phone || 'unknown').slice(0, 20);
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

  return {
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

export async function saveSarahOfficeRequest(
  request: OfficeRequest,
  deps: { insertBooking: InsertBooking; sendAlert: SendAlert },
): Promise<{ success: boolean; message: string; emailSent: boolean; bookingId: string | null }> {
  const spoken = request.kind === 'emergency' ? EMERGENCY_SPOKEN_MESSAGE : CALLBACK_SPOKEN_MESSAGE;
  let bookingId: string | null = null;
  let saved = false;

  try {
    const inserted = await deps.insertBooking(bookingRowForOfficeRequest(request));
    bookingId = inserted?.id ?? null;
    saved = !inserted?.error;
  } catch (error) {
    console.error('[Receptionist] Office request insert failed:', error);
    saved = false;
  }

  let emailSent = false;
  const subject = alertSubject(request);
  const text = alertText(request, bookingId);
  for (const to of OFFICE_ALERT_EMAILS) {
    try {
      const sent = await deps.sendAlert({ to, subject, text });
      if (sent?.success) emailSent = true;
    } catch (error) {
      console.error(`[Receptionist] Office request email to ${to} failed:`, error);
    }
  }

  const success = saved || emailSent;
  return {
    success,
    message: success
      ? spoken
      : "I couldn't pass that to the office just now. Please hold and I'll try again.",
    emailSent,
    bookingId,
  };
}
