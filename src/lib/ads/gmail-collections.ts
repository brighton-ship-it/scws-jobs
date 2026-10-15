/**
 * Collection emails sent from shop Gmail. Read-only.
 * A mailbox the app cannot open is "unavailable", never a zero.
 */
import { refreshGoogleAccessToken } from './google-ads-api.ts';
import { staffLabel } from './staff-lines.ts';
import type { CollectionEvent } from './callbacks.ts';

export interface GmailCollectionConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GmailCollectionMessage {
  id?: string | null;
  /** Gmail internalDate, milliseconds as a string. */
  internalDate?: string | null;
  from?: string | null;
  to?: string | null;
  cc?: string | null;
  subject?: string | null;
  snippet?: string | null;
  date?: string | null;
}

const INVOICE_NUM = /(?:invoice(?:\s+number)?\s*#?\s*|#)(\d{3,6})\b/gi;
const COLLECTION = /\binvoice\b|past due|balance|payment|pay link|unpaid/i;
const REVIEW_ONLY = /how'?d we do|how did we do|google review|leave (us )?a review|review request/i;

export function gmailCollectionConfig(env: NodeJS.ProcessEnv = process.env): GmailCollectionConfig | null {
  const clientId = env.GOOGLE_GMAIL_CLIENT_ID?.trim() || env.GOOGLE_VOICE_CLIENT_ID?.trim() || env.GOOGLE_ADS_CLIENT_ID?.trim() || '';
  const clientSecret = env.GOOGLE_GMAIL_CLIENT_SECRET?.trim() || env.GOOGLE_VOICE_CLIENT_SECRET?.trim() || env.GOOGLE_ADS_CLIENT_SECRET?.trim() || '';
  const refreshToken = env.GOOGLE_GMAIL_REFRESH_TOKEN?.trim() || env.GOOGLE_VOICE_REFRESH_TOKEN?.trim() || '';
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export function invoiceNumbersIn(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(INVOICE_NUM)) {
    const num = match[1];
    if (!num || seen.has(num)) continue;
    seen.add(num);
    out.push(num);
  }
  return out;
}

export function parseAddressList(header: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of String(header ?? '').matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const email = match[0].toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/** Sent collection mail. Review requests with no invoice number are not attempts. */
export function collectionEmailEvents(messages: GmailCollectionMessage[], mailbox: string): CollectionEvent[] {
  const events: CollectionEvent[] = [];
  const seen = new Set<string>();
  for (const msg of messages) {
    const subject = msg.subject ?? '';
    const snippet = msg.snippet ?? '';
    const blob = `${subject}\n${snippet}`;
    const nums = invoiceNumbersIn(blob);
    if (REVIEW_ONLY.test(blob) && nums.length === 0) continue;
    if (nums.length === 0 && !COLLECTION.test(blob)) continue;
    const atRaw = msg.internalDate && /^\d+$/.test(msg.internalDate) ? Number(msg.internalDate) : Date.parse(msg.date ?? '');
    if (!Number.isFinite(atRaw)) continue;
    const toEmails = [...parseAddressList(msg.to), ...parseAddressList(msg.cc)];
    const id = msg.id || `${atRaw}:${subject}:${toEmails.join(',')}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const actor = parseAddressList(msg.from)[0] || mailbox;
    events.push({
      at: new Date(atRaw).toISOString(),
      channel: 'email',
      source: 'gmail',
      by: staffLabel(actor, null),
      toEmails,
      invoiceNumbers: nums,
      sid: msg.id ?? null,
    });
  }
  return events;
}

function headerMap(headers: Array<{ name?: string; value?: string }> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of headers ?? []) {
    const name = header.name?.toLowerCase();
    if (name && header.value) out[name] = header.value;
  }
  return out;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next;
      next += 1;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function loadGmailCollection(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ events: CollectionEvent[]; ok: boolean; mailbox: string | null; note: string | null }> {
  const config = gmailCollectionConfig(env);
  if (!config) {
    return { events: [], ok: false, mailbox: null, note: 'Gmail unavailable (no shop mailbox is connected).' };
  }
  let token: string;
  try {
    token = await refreshGoogleAccessToken(config, fetchImpl);
  } catch {
    return { events: [], ok: false, mailbox: null, note: 'Gmail unavailable (Google refused the mailbox login).' };
  }
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const profile = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers });
  if (profile.status === 403 || profile.status === 401) {
    return { events: [], ok: false, mailbox: null, note: 'Gmail unavailable (the connected Google account cannot read mail).' };
  }
  if (!profile.ok) {
    return { events: [], ok: false, mailbox: null, note: `Gmail unavailable (profile ${profile.status}).` };
  }
  const profileJson = await profile.json() as { emailAddress?: string };
  const mailbox = profileJson.emailAddress?.trim().toLowerCase() || null;

  const ids: string[] = [];
  let pageToken: string | null = null;
  const query = 'in:sent (subject:invoice OR subject:"past due" OR "invoice #") newer_than:200d';
  for (let page = 0; page < 3 && ids.length < 300; page += 1) {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetchImpl(url.toString(), { headers });
    if (response.status === 403 || response.status === 401) {
      return { events: [], ok: false, mailbox, note: 'Gmail unavailable (the connected Google account cannot read mail).' };
    }
    if (!response.ok) {
      return { events: [], ok: false, mailbox, note: `Gmail unavailable (list ${response.status}).` };
    }
    const body = await response.json() as { messages?: Array<{ id?: string }>; nextPageToken?: string };
    for (const message of body.messages ?? []) if (message.id) ids.push(message.id);
    pageToken = body.nextPageToken || null;
    if (!pageToken) break;
  }

  let failed = 0;
  const messages = await mapPool(ids.slice(0, 300), 8, async (id) => {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`);
    url.searchParams.set('format', 'metadata');
    for (const name of ['Subject', 'From', 'To', 'Cc', 'Date']) url.searchParams.append('metadataHeaders', name);
    const response = await fetchImpl(url.toString(), { headers });
    if (!response.ok) {
      failed += 1;
      return null;
    }
    const body = await response.json() as {
      id?: string;
      internalDate?: string;
      snippet?: string;
      payload?: { headers?: Array<{ name?: string; value?: string }> };
    };
    const h = headerMap(body.payload?.headers);
    return {
      id: body.id ?? id,
      internalDate: body.internalDate ?? null,
      snippet: body.snippet ?? null,
      subject: h.subject ?? null,
      from: h.from ?? null,
      to: h.to ?? null,
      cc: h.cc ?? null,
      date: h.date ?? null,
    } satisfies GmailCollectionMessage;
  });
  const loaded = messages.filter((msg): msg is GmailCollectionMessage => !!msg);
  if (ids.length > 0 && loaded.length === 0) {
    return { events: [], ok: false, mailbox, note: 'Gmail unavailable (message headers could not be read).' };
  }
  const notes: string[] = [];
  if (ids.length >= 300) notes.push('Gmail count includes the newest 300 sent invoice messages.');
  if (failed > 0) notes.push(`Gmail skipped ${failed} messages that could not be read.`);
  return {
    events: collectionEmailEvents(loaded, mailbox ?? ''),
    ok: true,
    mailbox,
    note: notes.length ? notes.join(' ') : null,
  };
}
