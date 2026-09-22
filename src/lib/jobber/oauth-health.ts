/**
 * Secret-free Jobber durable-store diagnostic.
 *
 * Reports whether JOBBER_TOKEN_ENCRYPTION_KEY is set and whether
 * Supabase can be reached. Never includes token or key values.
 */

import { authorizeCronRequest } from '../cron-auth.ts';
import { authorizeJobberMcpRequest } from '../mcp/jobber-auth.ts';
import {
  diagnoseJobberDurableStore,
  type JobberDurableStoreDiagnosis,
} from './token-store.ts';

export type JobberOauthHealthBody = JobberDurableStoreDiagnosis & {
  ok: boolean;
};

export function authorizeJobberOauthHealthRequest(
  request: { headers: Headers },
  env: NodeJS.ProcessEnv = process.env
): { ok: true } | { ok: false; status: 401 } {
  const cron = authorizeCronRequest(request, env);
  if (cron.ok) return { ok: true };
  const mcp = authorizeJobberMcpRequest(request, env);
  if (mcp.ok) return { ok: true };
  return { ok: false, status: 401 };
}

export function jobberOauthHealthHttpStatus(diagnosis: JobberDurableStoreDiagnosis): number {
  if (!diagnosis.ready) return 503;
  if (diagnosis.settingsTable === 'missing') return 503;
  if (diagnosis.loadError) return 503;
  if (diagnosis.reachable === false) return 503;
  return 200;
}

export async function jobberOauthHealthBody(
  env: NodeJS.ProcessEnv = process.env
): Promise<JobberOauthHealthBody> {
  const diagnosis = await diagnoseJobberDurableStore({ env });
  return {
    ok: diagnosis.ready && diagnosis.reachable !== false,
    ...diagnosis,
  };
}

export async function handleJobberOauthHealthRequest(
  request: { headers: Headers },
  env: NodeJS.ProcessEnv = process.env
): Promise<Response> {
  const auth = authorizeJobberOauthHealthRequest(request, env);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  const body = await jobberOauthHealthBody(env);
  return new Response(JSON.stringify(body), {
    status: jobberOauthHealthHttpStatus(body),
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
