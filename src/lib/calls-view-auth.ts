/**
 * Calls-only key for office staff (e.g. Liz): opens /ops/calls-live and the call data it needs
 * (/api/ops/call-dashboard?view=calls, /api/ops/phone-calls) and nothing else in /ops.
 * Env: CALLS_VIEW_KEY. Share link: /ops/calls-live?ckey=<CALLS_VIEW_KEY>.
 * Kept separate from the office key: it is never accepted by authorizeQuotesGpKey / OPS routes.
 */
export const CALLS_VIEW_KEY_ENV = 'CALLS_VIEW_KEY';
export const CALLS_VIEW_KEY_HEADER = 'x-calls-view-key';
export const CALLS_VIEW_KEY_COOKIE = 'calls_view_key';
export const CALLS_VIEW_KEY_QUERY = 'ckey';
export const CALLS_VIEW_KEY_STORAGE = 'calls_view_key';

/** Dashboard payload fields a calls-only session may receive. Everything else is dropped. */
export const CALLS_VIEW_FIELDS = ['callFeed', 'generatedAt', 'jobberDataAsOf', 'mirrorAsOf'] as const;

function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function readCallsViewKey(
  request: { headers: Headers; url?: string },
  cookies?: { get(name: string): { value: string } | undefined }
): string | null {
  const header = request.headers.get(CALLS_VIEW_KEY_HEADER)?.trim();
  if (header) return header;
  if (request.url) {
    try { const q = new URL(request.url).searchParams.get(CALLS_VIEW_KEY_QUERY)?.trim(); if (q) return q; } catch { /* ignore */ }
  }
  return cookies?.get(CALLS_VIEW_KEY_COOKIE)?.value?.trim() || null;
}

export function callsViewKeyMatches(provided: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env[CALLS_VIEW_KEY_ENV]?.trim();
  if (!provided || !secret) return false;
  return safeEqual(provided, secret);
}

/** Allowlist scrub for calls-only sessions. */
export function scrubForCallsView(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { scope: 'calls' };
  for (const k of CALLS_VIEW_FIELDS) if (k in payload) out[k] = payload[k];
  return out;
}

export function callsViewCookieHeader(key: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${CALLS_VIEW_KEY_COOKIE}=${encodeURIComponent(key)}; Path=/api/ops; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax; HttpOnly${secure}`;
}
