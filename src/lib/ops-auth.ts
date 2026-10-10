/**
 * Shared gate for internal /ops pages and /api/ops routes: CRM session OR the
 * office key (QUOTES_GP_KEY, fallback ADMIN_SECRET) via header, ?key=, or the
 * long-lived HttpOnly cookie set on first use (so a wall TV stays signed in 30 days).
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/require-auth';
import {
  QUOTES_GP_KEY_COOKIE, authorizeQuotesGpKey, quotesGpCookieHeader, readQuotesGpKey,
} from '@/lib/quotes-gp-auth';

export async function authorizeOps(request: NextRequest): Promise<
  { ok: true; setCookie: string | null } | { ok: false; response: NextResponse }
> {
  const cookieStore = await cookies();
  const keyAuth = authorizeQuotesGpKey(request, { cookies: cookieStore });
  if (keyAuth.ok) {
    const provided = readQuotesGpKey(request, cookieStore);
    const already = cookieStore.get(QUOTES_GP_KEY_COOKIE)?.value;
    return { ok: true, setCookie: provided && provided !== already ? quotesGpCookieHeader(provided) : null };
  }
  try {
    const { user } = await requireUser();
    if (user) return { ok: true, setCookie: null };
  } catch {
    // demo / missing Supabase: key is the only gate
  }
  return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
}
