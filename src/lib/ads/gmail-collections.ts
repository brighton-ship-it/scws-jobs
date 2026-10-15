/**
 * Collection emails sent from shop Gmail. Read-only.
 * A mailbox the app cannot open is "unavailable", never a zero.
 *
 * Keyless path: Vercel OIDC → GCP workload identity → impersonate
 * scws-gmail-readonly → signJwt with sub=<mailbox> and gmail.readonly.
 * No service-account JSON key and no user refresh token.
 */
import { staffLabel } from './staff-lines.ts';
import type { CollectionEvent } from './callbacks.ts';

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

export interface GmailCollectionResult {
  events: CollectionEvent[];
  /** True when at least one shop mailbox could be listed. */
  ok: boolean;
  /** Mailboxes that returned a sent list, comma-separated. */
  mailbox: string | null;
  /** Display names of mailboxes that could not be read. */
  unavailable: string[];
  note: string | null;
}

export interface GmailFederationConfig {
  projectId: string;
  projectNumber: string;
  serviceAccountEmail: string;
  poolId: string;
  providerId: string;
}

/** Shop inboxes that send collection mail. Matches the Voice staff lines. */
export const SHOP_GMAIL_MAILBOXES: Array<{ name: string; email: string }> = [
  { name: 'Brighton', email: 'brighton@scwellservice.com' },
  { name: 'Liz', email: 'lizbeth@scwellservice.com' },
  { name: 'Shanicey', email: 'shanicey@scwellservice.com' },
];

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const PT = 'America/Los_Angeles';

/** One customer address and the earliest open invoice that uses it. */
export interface GmailSearchTarget {
  email: string;
  afterIso: string;
}

/** Gmail `after:` excludes that calendar day, so step back one Pacific day. */
export function gmailAfterDay(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: PT }).format(new Date(t));
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return null;
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const yyyy = prev.getUTCFullYear();
  const mm = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(prev.getUTCDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

/** Earliest open invoice per customer address. Mail before that invoice is ignored later. */
export function gmailSearchTargets(invoices: Array<{ emails?: string[] | null; issuedAt: string }>): GmailSearchTarget[] {
  const earliest = new Map<string, number>();
  for (const inv of invoices) {
    const issued = Date.parse(inv.issuedAt);
    if (!Number.isFinite(issued)) continue;
    for (const raw of inv.emails ?? []) {
      const email = String(raw).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      const prev = earliest.get(email);
      if (prev == null || issued < prev) earliest.set(email, issued);
    }
  }
  return [...earliest.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([email, ms]) => ({ email, afterIso: new Date(ms).toISOString() }));
}

/** `in:sent after:<day> (to:a OR to:b ...)`, chunked so each query stays short. */
export function gmailSentQueries(targets: GmailSearchTarget[]): string[] {
  if (!targets.length) return [];
  const chunks: GmailSearchTarget[][] = [];
  let current: GmailSearchTarget[] = [];
  let length = 40;
  for (const target of targets) {
    const piece = `to:${target.email}`.length + 4;
    if (current.length && length + piece > 1400) {
      chunks.push(current);
      current = [];
      length = 40;
    }
    current.push(target);
    length += piece;
  }
  if (current.length) chunks.push(current);
  return chunks.map((chunk) => {
    const earliest = Math.min(...chunk.map((target) => Date.parse(target.afterIso)));
    const day = gmailAfterDay(new Date(earliest).toISOString()) ?? '1970/01/01';
    const tos = chunk.map((target) => `to:${target.email}`).join(' OR ');
    return `in:sent after:${day} (${tos})`;
  });
}

/** Stable cache key for a customer-address set. Does not include tokens. */
export function gmailTargetKey(targets: GmailSearchTarget[]): string {
  let hash = 2166136261;
  const raw = targets.map((target) => `${target.email}:${target.afterIso.slice(0, 10)}`).join('|');
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${targets.length}:${(hash >>> 0).toString(16)}`;
}

const INVOICE_NUM = /(?:invoice(?:\s+number)?\s*#?\s*|#)(\d{3,6})\b/gi;
const COLLECTION = /\binvoice\b|past due|balance|payment|pay link|unpaid/i;
const REVIEW_ONLY = /how'?d we do|how did we do|google review|leave (us )?a review|review request/i;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function gmailFederationConfig(env: NodeJS.ProcessEnv = process.env): GmailFederationConfig | null {
  // scws-ads. Env overrides this when it is set; the number is not a secret.
  const projectNumber = env.GCP_PROJECT_NUMBER?.trim() || '950015473137';
  if (!/^\d+$/.test(projectNumber)) return null;
  return {
    projectId: env.GCP_PROJECT_ID?.trim() || 'scws-ads',
    projectNumber,
    serviceAccountEmail: env.GCP_SERVICE_ACCOUNT_EMAIL?.trim() || 'scws-gmail-readonly@scws-ads.iam.gserviceaccount.com',
    poolId: env.GCP_WORKLOAD_IDENTITY_POOL_ID?.trim() || 'vercel',
    providerId: env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID?.trim() || 'vercel',
  };
}

/** STS audience for the Vercel workload-identity provider. */
export function workloadIdentityAudience(config: GmailFederationConfig): string {
  return `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.poolId}/providers/${config.providerId}`;
}

/** Domain-wide delegation claims. Scope is read-only Gmail and nothing else. */
export function delegationClaims(input: {
  serviceAccountEmail: string;
  mailbox: string;
  nowSeconds: number;
  lifetimeSeconds?: number;
}): { iss: string; sub: string; scope: string; aud: string; iat: number; exp: number } {
  const lifetime = input.lifetimeSeconds ?? 3600;
  return {
    iss: input.serviceAccountEmail,
    sub: input.mailbox,
    scope: GMAIL_READONLY_SCOPE,
    aud: TOKEN_URL,
    iat: input.nowSeconds,
    exp: input.nowSeconds + lifetime,
  };
}

/** Platform OIDC token. The env value wins over a caller-supplied header. */
export function vercelOidcToken(env: NodeJS.ProcessEnv = process.env, header?: string | null): string | null {
  const fromEnv = env.VERCEL_OIDC_TOKEN?.trim() || '';
  if (fromEnv) return fromEnv;
  const fromHeader = header?.trim() || '';
  return fromHeader || null;
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

function shortGoogleError(status: number, raw: string): string {
  let message = `HTTP ${status}`;
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string } | string;
      error_description?: string;
    };
    if (typeof parsed.error === 'string') message = parsed.error_description || parsed.error;
    else if (parsed.error?.message) message = parsed.error.message;
    else if (parsed.error_description) message = parsed.error_description;
  } catch {
    if (raw && !raw.includes('ya29.') && !raw.includes('eyJ')) message = raw.slice(0, 120);
  }
  return message
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[token]')
    .replace(/eyJ[A-Za-z0-9_-]{20,}/g, '[jwt]')
    .slice(0, 180);
}

async function postForm(
  url: string,
  fields: Record<string, string>,
  fetchImpl: typeof fetch,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown>; error: string }> {
  const body = new URLSearchParams(fields);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers },
    body,
  });
  const raw = await response.text();
  let json: Record<string, unknown> = {};
  try { json = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { json = {}; }
  return { ok: response.ok, status: response.status, json, error: response.ok ? '' : shortGoogleError(response.status, raw) };
}

async function postJson(
  url: string,
  payload: unknown,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown>; error: string }> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  let json: Record<string, unknown> = {};
  try { json = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { json = {}; }
  return { ok: response.ok, status: response.status, json, error: response.ok ? '' : shortGoogleError(response.status, raw) };
}

function iamCredentialsUrl(serviceAccountEmail: string, method: 'generateAccessToken' | 'signJwt'): string {
  return `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:${method}`;
}

/** Federated token, then an access token for the read-only service account. */
async function serviceAccountAccessToken(
  config: GmailFederationConfig,
  oidcToken: string,
  fetchImpl: typeof fetch,
): Promise<{ token: string | null; error: string | null }> {
  const sts = await postForm('https://sts.googleapis.com/v1/token', {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    audience: workloadIdentityAudience(config),
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    subject_token: oidcToken,
  }, fetchImpl);
  const federated = typeof sts.json.access_token === 'string' ? sts.json.access_token : '';
  if (!sts.ok || !federated) {
    return { token: null, error: `Gmail unavailable (Google refused the Vercel workload token: ${sts.error || 'no token'}).` };
  }
  const minted = await postJson(iamCredentialsUrl(config.serviceAccountEmail, 'generateAccessToken'), {
    scope: ['https://www.googleapis.com/auth/cloud-platform'],
    lifetime: '3600s',
  }, federated, fetchImpl);
  const token = typeof minted.json.accessToken === 'string' ? minted.json.accessToken : '';
  if (!minted.ok || !token) {
    return { token: null, error: `Gmail unavailable (the workload identity could not impersonate the service account: ${minted.error || 'no token'}).` };
  }
  return { token, error: null };
}

/** Sign a domain-wide token for one mailbox. Never requests a send scope. */
async function delegatedGmailToken(
  config: GmailFederationConfig,
  serviceAccountToken: string,
  mailbox: string,
  fetchImpl: typeof fetch,
  nowSeconds: number,
): Promise<{ token: string | null; error: string | null }> {
  const claims = delegationClaims({
    serviceAccountEmail: config.serviceAccountEmail,
    mailbox,
    nowSeconds,
  });
  const signed = await postJson(iamCredentialsUrl(config.serviceAccountEmail, 'signJwt'), {
    payload: JSON.stringify(claims),
  }, serviceAccountToken, fetchImpl);
  const assertion = typeof signed.json.signedJwt === 'string' ? signed.json.signedJwt : '';
  if (!signed.ok || !assertion) {
    return { token: null, error: signed.error || 'signJwt failed' };
  }
  const exchanged = await postForm(TOKEN_URL, {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }, fetchImpl);
  const token = typeof exchanged.json.access_token === 'string' ? exchanged.json.access_token : '';
  if (!exchanged.ok || !token) return { token: null, error: exchanged.error || 'jwt-bearer failed' };
  return { token, error: null };
}

async function listSentIds(
  query: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ ids: string[]; ok: boolean; truncated: boolean; error: string | null }> {
  const ids: string[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    let response = await fetchImpl(url.toString(), { headers });
    if (response.status === 429 || response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      response = await fetchImpl(url.toString(), { headers });
    }
    if (!response.ok) {
      const raw = await response.text();
      return { ids: [], ok: false, truncated: false, error: shortGoogleError(response.status, raw) };
    }
    const body = await response.json() as { messages?: Array<{ id?: string }>; nextPageToken?: string };
    for (const message of body.messages ?? []) if (message.id) ids.push(message.id);
    pageToken = body.nextPageToken || null;
    if (!pageToken) return { ids, ok: true, truncated: false, error: null };
  }
  return { ids, ok: true, truncated: true, error: null };
}

async function readMailbox(
  mailbox: { name: string; email: string },
  accessToken: string,
  targets: GmailSearchTarget[],
  fetchImpl: typeof fetch,
): Promise<{ events: CollectionEvent[]; ok: boolean; truncated: boolean; failed: number; note: string | null }> {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
  const profile = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers });
  if (!profile.ok) {
    const raw = await profile.text();
    return { events: [], ok: false, truncated: false, failed: 0, note: `${mailbox.name} Gmail unavailable (${shortGoogleError(profile.status, raw)}).` };
  }
  const profileJson = await profile.json() as { emailAddress?: string };
  const address = profileJson.emailAddress?.trim().toLowerCase() || '';
  if (address && address !== mailbox.email) {
    return { events: [], ok: false, truncated: false, failed: 0, note: `${mailbox.name} Gmail unavailable (opened a different mailbox).` };
  }

  const queries = gmailSentQueries(targets);
  const listed = await mapPool(queries, 4, (query) => listSentIds(query, headers, fetchImpl));
  const failedList = listed.find((page) => !page.ok);
  if (failedList) {
    return { events: [], ok: false, truncated: false, failed: 0, note: `${mailbox.name} Gmail unavailable (${failedList.error || 'list failed'}).` };
  }
  const ids = [...new Set(listed.flatMap((page) => page.ids))];
  const truncated = listed.some((page) => page.truncated);

  let failed = 0;
  const messages = await mapPool(ids, 8, async (id) => {
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
    return { events: [], ok: false, truncated: false, failed, note: `${mailbox.name} Gmail unavailable (message headers could not be read).` };
  }
  return {
    events: collectionEmailEvents(loaded, mailbox.email),
    ok: true,
    truncated,
    failed,
    note: null,
  };
}

function unavailableResult(note: string): GmailCollectionResult {
  return {
    events: [],
    ok: false,
    mailbox: null,
    unavailable: SHOP_GMAIL_MAILBOXES.map((box) => box.name),
    note,
  };
}

export async function loadGmailCollection(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  oidcToken: string | null = vercelOidcToken(env),
  nowSeconds = Math.floor(Date.now() / 1000),
  targets: GmailSearchTarget[] = [],
): Promise<GmailCollectionResult> {
  const config = gmailFederationConfig(env);
  if (!config) return unavailableResult('Gmail unavailable (GCP project number is not set).');
  if (!oidcToken) return unavailableResult('Gmail unavailable (Vercel OIDC token is missing).');

  let serviceToken: string;
  try {
    const minted = await serviceAccountAccessToken(config, oidcToken, fetchImpl);
    if (!minted.token) return unavailableResult(minted.error || 'Gmail unavailable (Google refused the Vercel workload token).');
    serviceToken = minted.token;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error';
    return unavailableResult(`Gmail unavailable (Google refused the Vercel workload token: ${message.slice(0, 160)}).`);
  }

  const reads = await Promise.all(SHOP_GMAIL_MAILBOXES.map(async (box) => {
    try {
      const delegated = await delegatedGmailToken(config, serviceToken, box.email, fetchImpl, nowSeconds);
      if (!delegated.token) {
        return { box, events: [] as CollectionEvent[], ok: false, truncated: false, failed: 0, note: `${box.name} Gmail unavailable (${delegated.error || 'delegation failed'}).` };
      }
      return { box, ...(await readMailbox(box, delegated.token, targets, fetchImpl)) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error';
      return { box, events: [] as CollectionEvent[], ok: false, truncated: false, failed: 0, note: `${box.name} Gmail unavailable (${message.slice(0, 160)}).` };
    }
  }));

  const open = reads.filter((read) => read.ok);
  const closed = reads.filter((read) => !read.ok);
  const notes = [
    ...closed.map((read) => read.note).filter((note): note is string => !!note),
  ];
  if (reads.some((read) => read.truncated)) notes.push('Gmail search for a mailbox was still paging when it stopped, so some older mail may be missing.');
  const failed = reads.reduce((sum, read) => sum + read.failed, 0);
  if (failed > 0) notes.push(`Gmail skipped ${failed} messages that could not be read.`);
  return {
    events: open.flatMap((read) => read.events),
    ok: open.length > 0,
    mailbox: open.length ? open.map((read) => read.box.email).join(', ') : null,
    unavailable: closed.map((read) => read.box.name),
    note: notes.length ? notes.join(' ') : null,
  };
}
