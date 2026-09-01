/**
 * Auth for the internal Jobber quote GP tracker.
 *
 * Open /ops/quotes-gp after signing into the CRM (same session as other
 * admin/ops routes), or with QUOTES_GP_KEY (query `?key=`, header
 * `x-quotes-gp-key`, or cookie `quotes_gp_key`). ADMIN_SECRET is accepted
 * as a fallback so production does not need a second secret if one is set.
 *
 * This page is office-only. Never index it. Never put GP math on customer
 * quote titles or messages.
 */

export const QUOTES_GP_KEY_ENV = 'QUOTES_GP_KEY';
export const QUOTES_GP_KEY_FALLBACK_ENV = 'ADMIN_SECRET';
export const QUOTES_GP_KEY_HEADER = 'x-quotes-gp-key';
export const QUOTES_GP_KEY_COOKIE = 'quotes_gp_key';
export const QUOTES_GP_KEY_QUERY = 'key';

export type QuotesGpAuthResult =
  | { ok: true; via: 'session' | 'key' }
  | { ok: false; reason: 'unauthorized' };

export function getQuotesGpSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const primary = env[QUOTES_GP_KEY_ENV]?.trim();
  if (primary) return primary;
  const fallback = env[QUOTES_GP_KEY_FALLBACK_ENV]?.trim();
  return fallback || null;
}

export function readQuotesGpKey(
  request: { headers: Headers; url?: string },
  cookies?: { get(name: string): { value: string } | undefined }
): string | null {
  const header = request.headers.get(QUOTES_GP_KEY_HEADER)?.trim();
  if (header) return header;

  const auth = request.headers.get('authorization')?.trim();
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }

  if (request.url) {
    try {
      const url = new URL(request.url);
      const query = url.searchParams.get(QUOTES_GP_KEY_QUERY)?.trim();
      if (query) return query;
    } catch {
      // ignore malformed URL
    }
  }

  const cookie = cookies?.get(QUOTES_GP_KEY_COOKIE)?.value?.trim();
  return cookie || null;
}

export function keyMatchesQuotesGpSecret(
  provided: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const secret = getQuotesGpSecret(env);
  if (!secret || !provided) return false;
  return provided === secret;
}

export function authorizeQuotesGpKey(
  request: { headers: Headers; url?: string },
  options?: {
    cookies?: { get(name: string): { value: string } | undefined };
    env?: NodeJS.ProcessEnv;
  }
): QuotesGpAuthResult {
  const env = options?.env ?? process.env;
  const provided = readQuotesGpKey(request, options?.cookies);
  if (keyMatchesQuotesGpSecret(provided, env)) {
    return { ok: true, via: 'key' };
  }
  return { ok: false, reason: 'unauthorized' };
}

export function quotesGpCookieHeader(key: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${QUOTES_GP_KEY_COOKIE}=${encodeURIComponent(key)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax; HttpOnly${secure}`;
}
