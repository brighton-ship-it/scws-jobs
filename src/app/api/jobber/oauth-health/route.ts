import { NextRequest } from 'next/server';
import { handleJobberOauthHealthRequest } from '@/lib/jobber/oauth-health';

export const dynamic = 'force-dynamic';

/**
 * GET /api/jobber/oauth-health
 * Auth: Authorization: Bearer <CRON_SECRET> or a JOBBER_MCP_API_KEYS key.
 * Reports whether the durable Jobber token store is configured (encryption
 * key present + Supabase reachable). Never returns token or key values.
 */
export async function GET(request: NextRequest) {
  return handleJobberOauthHealthRequest(request);
}
