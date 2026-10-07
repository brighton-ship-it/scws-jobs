/**
 * Pure rules for collections SMS: phone choice, pay-link hosts, send window,
 * opt-out keywords, and pacing limits. Nothing here sends a message.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

export const COLLECTIONS_E164 = '+17608237963';
export const DEFAULT_MESSAGING_SERVICE_SID = 'MG66ff74e6d46a9e5439d0a2a718b3a14d';
export const OFFICE_VOICE = '(760) 440-8520';
export const PACING_MS = 2000;
export const FREQUENCY_LIMIT = 3;
export const FREQUENCY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTOREPLY_THROTTLE_MS = 24 * 60 * 60 * 1000;
export const AUTOREPLY_TEXT =
  'Thanks for getting back to us! For any questions about your account, please call our office at (760) 440-8520. - Southern California Well Service';

export const STOP_KEYWORDS = [
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'REVOKE',
  'OPTOUT',
] as const;

export const INFO_KEYWORDS = ['HELP', 'INFO', 'START', 'UNSTOP', 'YES'] as const;

const PAYABLE_STATUSES = new Set(['awaiting_payment', 'past_due']);
const ALLOWED_LINK_HOSTS = new Set(['clienthub.getjobber.com', 'secure.getjobber.com']);
const OPEN_WEEKDAYS = new Set(['Tue', 'Wed', 'Thu']);

export type CollectionsPhone = {
  number?: string | null;
  primary?: boolean | null;
  description?: string | null;
  smsAllowed?: boolean | null;
};

export type CollectionsEmail = {
  address?: string | null;
  primary?: boolean | null;
};

export function collectionsMessagingServiceSid(env: NodeJS.ProcessEnv = process.env): string {
  return env.TWILIO_COLLECTIONS_MESSAGING_SERVICE_SID?.trim() || DEFAULT_MESSAGING_SERVICE_SID;
}

export function collectionsAutoreplyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.COLLECTIONS_AUTOREPLY_ENABLED || '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) {
    timingSafeEqual(leftBuf, leftBuf);
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

export function toE164US(phone: unknown): string | null {
  if (phone == null) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function phoneLast4(e164: string | null | undefined): string {
  const digits = String(e164 || '').replace(/\D/g, '');
  return digits.slice(-4);
}

export function phoneHash(e164: string): string {
  return createHash('sha256').update(e164).digest('hex');
}

export function linkHost(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return 'invalid-url';
  }
}

export function normalizeInvoiceStatus(status: string | null | undefined): string {
  return (status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function normalizeInvoiceNumber(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/^inv-?/, '');
}

export function isPayableStatus(status: string | null | undefined): boolean {
  return PAYABLE_STATUSES.has(normalizeInvoiceStatus(status));
}

export function payableRefusal(status: string | null | undefined, balance: number | null | undefined): string | null {
  if (!isPayableStatus(status)) return 'invoice_status';
  if (typeof balance !== 'number' || !Number.isFinite(balance) || !(balance > 0)) return 'zero_balance';
  return null;
}

export function isAllowedPayLink(link: string | null | undefined): boolean {
  if (!link) return false;
  try {
    const url = new URL(link.trim());
    return url.protocol === 'https:' && ALLOWED_LINK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** Client-hub root when the invoice link has an /invoice(s)/ suffix. */
export function clientHubRoot(link: string): string | null {
  try {
    const url = new URL(link);
    const match = url.pathname.match(/^(.*)\/invoices?(?:\/|$)/i);
    if (!match?.[1]) return null;
    const root = `${url.origin}${match[1]}`;
    return isAllowedPayLink(root) ? root : null;
  } catch {
    return null;
  }
}

export function selectPayLink(paymentUrl: string | null | undefined, publicUrl: string | null | undefined): string | null {
  for (const candidate of [paymentUrl, publicUrl]) {
    const trimmed = candidate?.trim();
    if (trimmed && isAllowedPayLink(trimmed)) return trimmed;
  }
  return null;
}

function isMobile(phone: CollectionsPhone): boolean {
  return (phone.description || '').trim().toLowerCase() === 'mobile';
}

export function selectSmsPhone(
  phones: CollectionsPhone[] | null | undefined
):
  | { ok: true; e164: string; last4: string }
  | { ok: false; reason: 'no_phone' | 'sms_not_allowed' | 'ambiguous_phone' | 'invalid_phone' } {
  const list = phones || [];
  if (list.length === 0) return { ok: false, reason: 'no_phone' };

  const allowed = list.filter((phone) => phone.smsAllowed !== false);
  if (allowed.length === 0) return { ok: false, reason: 'sms_not_allowed' };

  const mobiles = allowed.filter(isMobile);
  let chosen: CollectionsPhone | null = null;
  if (mobiles.length === 1) {
    chosen = mobiles[0];
  } else if (mobiles.length > 1) {
    return { ok: false, reason: 'ambiguous_phone' };
  } else {
    const primaries = allowed.filter((phone) => phone.primary === true);
    if (primaries.length !== 1) return { ok: false, reason: 'ambiguous_phone' };
    chosen = primaries[0];
  }

  const e164 = toE164US(chosen.number);
  if (!e164) return { ok: false, reason: 'invalid_phone' };
  return { ok: true, e164, last4: phoneLast4(e164) };
}

export function selectClientEmail(
  emails: CollectionsEmail[] | null | undefined
): { ok: true; email: string } | { ok: false; reason: 'no_email' | 'ambiguous_email' } {
  const list = (emails || [])
    .map((entry) => ({
      address: (entry?.address || '').trim(),
      primary: entry?.primary === true,
    }))
    .filter((entry) => entry.address.includes('@'));
  if (list.length === 0) return { ok: false, reason: 'no_email' };
  if (list.length === 1) return { ok: true, email: list[0].address };
  const primaries = list.filter((entry) => entry.primary);
  if (primaries.length === 1) return { ok: true, email: primaries[0].address };
  return { ok: false, reason: 'ambiguous_email' };
}

export function normalizeSmsKeyword(body: string | null | undefined): string | null {
  const token = String(body || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!token) return null;
  if ((STOP_KEYWORDS as readonly string[]).includes(token)) return token;
  if ((INFO_KEYWORDS as readonly string[]).includes(token)) return token;
  return null;
}

export function isStopKeyword(body: string | null | undefined): boolean {
  const token = normalizeSmsKeyword(body);
  return token != null && (STOP_KEYWORDS as readonly string[]).includes(token);
}

export function isNoReplyKeyword(body: string | null | undefined): boolean {
  return normalizeSmsKeyword(body) != null;
}

/** True when the text contains 13 or more digits (possible card number). */
export function bodyHasLongDigitRun(body: string): boolean {
  return body.replace(/\D/g, '').length >= 13;
}

export function isCollectionsWindow(date: Date): boolean {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  if (!OPEN_WEEKDAYS.has(parts.weekday || '')) return false;
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  const minute = Number(parts.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const mins = hour * 60 + minute;
  return mins >= 10 * 60 && mins <= 17 * 60 + 59;
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function collectionMessage(input: {
  template?: string | null;
  invoiceNumbers: string[];
  link: string;
  firstName?: string | null;
  balance?: number | null;
}): string {
  const numbers = input.invoiceNumbers.filter(Boolean).join(', ');
  const label = input.invoiceNumbers.filter(Boolean).length > 1 ? 'invoices' : 'invoice';
  const amount =
    typeof input.balance === 'number' && Number.isFinite(input.balance) && input.balance > 0
      ? ` for ${formatUsd(input.balance)}`
      : '';
  const template = input.template?.trim();
  if (template) {
    const rendered = template
      .replaceAll('{{invoiceNumbers}}', numbers)
      .replaceAll('{{link}}', input.link)
      .replaceAll('{{firstName}}', input.firstName || '')
      .replaceAll('{{balance}}', typeof input.balance === 'number' ? formatUsd(input.balance) : '');
    if (rendered.includes(input.link)) return rendered;
    return `${rendered}\nPay here: ${input.link}`;
  }
  return `Southern California Well Service — ${label} ${numbers}${amount}. Pay here: ${input.link}\nQuestions: ${OFFICE_VOICE}`;
}

export function templateVersion(template?: string | null): string {
  const trimmed = template?.trim();
  if (!trimmed) return 'default';
  return `custom:${createHash('sha256').update(trimmed).digest('hex').slice(0, 12)}`;
}
