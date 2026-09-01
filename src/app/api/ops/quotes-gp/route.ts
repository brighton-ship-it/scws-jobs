/**
 * GET /api/ops/quotes-gp
 *
 * Internal read-only Jobber quote GP page.
 * Auth: CRM session (same as other admin routes) OR QUOTES_GP_KEY
 *   (header x-quotes-gp-key, query ?key=, cookie quotes_gp_key).
 *   ADMIN_SECRET is accepted if QUOTES_GP_KEY is unset.
 *
 * Open the page at /ops/quotes-gp — never customer-facing.
 * Does not send, edit, or price-change Jobber quotes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/require-auth';
import {
  QUOTES_GP_KEY_COOKIE,
  authorizeQuotesGpKey,
  quotesGpCookieHeader,
  readQuotesGpKey,
} from '@/lib/quotes-gp-auth';
import { fetchQuotesGpPage } from '@/lib/jobber/quote-gp-tracker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

async function authorizeOps(request: NextRequest): Promise<
  { ok: true; setCookie: string | null } | { ok: false; response: NextResponse }
> {
  const cookieStore = await cookies();
  const keyAuth = authorizeQuotesGpKey(request, { cookies: cookieStore });
  if (keyAuth.ok) {
    const provided = readQuotesGpKey(request, cookieStore);
    const already = cookieStore.get(QUOTES_GP_KEY_COOKIE)?.value;
    const setCookie = provided && provided !== already ? quotesGpCookieHeader(provided) : null;
    return { ok: true, setCookie };
  }

  try {
    const { user, response } = await requireUser();
    if (user) return { ok: true, setCookie: null };
    if (response) return { ok: false, response };
  } catch {
    // Demo / missing Supabase — key is the only gate.
  }

  return { ok: false, response: unauthorized() };
}

function withAuthCookie(response: NextResponse, setCookie: string | null): NextResponse {
  if (setCookie) {
    response.headers.append('Set-Cookie', setCookie);
  }
  return response;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeOps(request);
  if (!auth.ok) return auth.response;

  const url = request.nextUrl;
  const after = url.searchParams.get('after');
  const firstRaw = url.searchParams.get('first');
  const status = url.searchParams.get('status');
  const createdAfter = url.searchParams.get('createdAfter');
  const createdBefore = url.searchParams.get('createdBefore');
  const first = firstRaw ? Number(firstRaw) : undefined;

  try {
    const page = await fetchQuotesGpPage({
      after,
      first,
      status,
      createdAfter,
      createdBefore,
    });
    return withAuthCookie(
      NextResponse.json({
        ...page,
        note: 'Internal office tracker. Read-only. Street prices stay street. FLAG/GP stay off customer titles and messages.',
      }),
      auth.setCookie
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load Jobber quotes';
    const statusCode = /JOBBER_ACCESS_TOKEN|not set/i.test(message) ? 503 : 502;
    console.error('[quotes-gp]', message);
    return withAuthCookie(
      NextResponse.json({ error: message }, { status: statusCode }),
      auth.setCookie
    );
  }
}
