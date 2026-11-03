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
import { CALLS_VIEW_KEY_COOKIE, callsViewCookieHeader, callsViewKeyMatches, readCallsViewKey } from '@/lib/calls-view-auth';

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

/**
 * Gate for call-data endpoints used by /ops/calls-live. Full ops auth -> scope 'full'.
 * Otherwise CALLS_VIEW_KEY -> scope 'calls' (caller must scrub to call fields only).
 */
export async function authorizeOpsOrCalls(request: NextRequest): Promise<
  { ok: true; scope: 'full' | 'calls'; setCookie: string | null } | { ok: false; response: NextResponse }
> {
  const full = await authorizeOps(request);
  if (full.ok) return { ok: true, scope: 'full', setCookie: full.setCookie };
  const cookieStore = await cookies();
  const provided = readCallsViewKey(request, cookieStore);
  if (callsViewKeyMatches(provided)) {
    const already = cookieStore.get(CALLS_VIEW_KEY_COOKIE)?.value;
    return { ok: true, scope: 'calls', setCookie: provided && provided !== already ? callsViewCookieHeader(provided) : null };
  }
  return full;
}
