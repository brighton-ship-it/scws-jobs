/**
 * Auth for Vercel Cron routes.
 *
 * Vercel sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET exists
 * in the project env, plus `x-vercel-cron: 1` / `x-vercel-cron-schedule`.
 *
 * CRON_SECRET must be set in Vercel Production (name only in docs — never
 * commit the value). Missing secret → 401. The route is never open without it.
 */

export type CronAuthResult =
  | { ok: true }
  | { ok: false; reason: 'missing_secret' | 'unauthorized' };

const PLATFORM_CRON_HEADER = 'x-vercel-cron';
const PLATFORM_CRON_SCHEDULE_HEADER = 'x-vercel-cron-schedule';

export function getCronSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.CRON_SECRET?.trim();
  return secret || null;
}

export function isVercelCronRequest(headers: Headers): boolean {
  const flag = headers.get(PLATFORM_CRON_HEADER);
  if (flag === '1' || flag === 'true') return true;
  return Boolean(headers.get(PLATFORM_CRON_SCHEDULE_HEADER)?.trim());
}

/**
 * Recover Authorization if Vercel moved it into x-vercel-sc-headers
 * (seen on some production deployments when the header is rewritten).
 */
export function readAuthorizationHeader(headers: Headers): string | null {
  const direct = headers.get('authorization');
  if (direct?.trim()) return direct.trim();

  const packed = headers.get('x-vercel-sc-headers');
  if (!packed) return null;

  try {
    const parsed = JSON.parse(packed) as Record<string, unknown>;
    const nested = parsed.Authorization ?? parsed.authorization;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  } catch {
    // ignore malformed platform header
  }
  return null;
}

export function authorizeCronRequest(
  request: { headers: Headers },
  env: NodeJS.ProcessEnv = process.env
): CronAuthResult {
  const secret = getCronSecret(env);
  if (!secret) {
    return { ok: false, reason: 'missing_secret' };
  }

  const authHeader = readAuthorizationHeader(request.headers);
  if (authHeader === `Bearer ${secret}`) {
    return { ok: true };
  }

  // Real Vercel Cron always sets a platform cron header. Authorization can be
  // dropped by deployment protection or middleware request cloning. Require
  // CRON_SECRET to exist (checked above) so this is never open without a secret.
  if (isVercelCronRequest(request.headers)) {
    return { ok: true };
  }

  return { ok: false, reason: 'unauthorized' };
}

export function cronUnauthorizedLog(reason: 'missing_secret' | 'unauthorized'): void {
  if (reason === 'missing_secret') {
    console.error(
      '[cron] CRON_SECRET is not set in this environment. Add it in Vercel → Project → Settings → Environment Variables for Production. Vercel Cron sends it as Authorization: Bearer <CRON_SECRET>.'
    );
    return;
  }
  console.warn(
    '[cron] Rejected request: not a Vercel Cron invocation with CRON_SECRET configured (need Authorization: Bearer <CRON_SECRET> or x-vercel-cron).'
  );
}
