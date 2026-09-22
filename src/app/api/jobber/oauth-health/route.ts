import { NextRequest } from 'next/server';
import { handleJobberOauthHealthRequest } from '@/lib/jobber/oauth-health';

export const dynamic = 'force-dynamic';

/**
 * GET /api/jobber/oauth-health
 * Auth: Authorization: Bearer <CRON_SECRET> or a JOBBER_MCP_API_KEYS key.
 * Reports auth mode (`durable` or `env_bootstrap`), `expiresAt`, and whether
 * `public.settings` is present. Never returns token or key values.
 * `settingsTable: "missing"` or `loadError` means the durable read failed —
 * that is not a Jobber 401.
 */
export async function GET(request: NextRequest) {
  return handleJobberOauthHealthRequest(request);
}
