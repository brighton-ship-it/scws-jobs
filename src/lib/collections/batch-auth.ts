/**
 * Collections batch auth: Bearer ADMIN_API_KEY, or the existing cron check.
 * No new secrets.
 */

import { authorizeCronRequest, readAuthorizationHeader } from '../cron-auth.ts';
import { timingSafeEqualString } from './policy.ts';

export type CollectionsAuth =
  | { ok: true; via: 'admin' | 'cron' }
  | { ok: false; reason: 'unauthorized' };

export function authorizeCollectionsRequest(
  request: { headers: Headers },
  env: { [key: string]: string | undefined } = process.env
): CollectionsAuth {
  const admin = env.ADMIN_API_KEY?.trim() || '';
  const header = readAuthorizationHeader(request.headers);
  if (admin && header) {
    const match = header.match(/^Bearer\s+(\S+)\s*$/i);
    const token = match?.[1] || '';
    if (token && timingSafeEqualString(token, admin)) return { ok: true, via: 'admin' };
  }

  const cron = authorizeCronRequest(request, env as NodeJS.ProcessEnv);
  if (cron.ok) return { ok: true, via: 'cron' };
  return { ok: false, reason: 'unauthorized' };
}
