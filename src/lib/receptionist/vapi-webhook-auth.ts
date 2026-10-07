/**
 * Vapi / Sarah webhook secret check.
 *
 * VAPI_WEBHOOK_AUTH_MODE = log (default) | enforce | off.
 * log: missing secret or a mismatch is recorded and the request continues,
 * so the live assistant keeps working until the secret is turned on.
 * enforce: missing secret or a mismatch is 401.
 * off: no check.
 *
 * There is no hard-coded fallback secret.
 */

import { readAuthorizationHeader } from '../cron-auth.ts';
import { timingSafeEqualString } from '../collections/policy.ts';

export type VapiWebhookAuthMode = 'log' | 'enforce' | 'off';

export type VapiWebhookAuthDecision = {
  ok: boolean;
  mode: VapiWebhookAuthMode;
  reason: 'ok' | 'mismatch' | 'secret_not_configured' | 'off';
  status?: 401;
};

export function vapiWebhookAuthMode(env: { [key: string]: string | undefined } = process.env): VapiWebhookAuthMode {
  const raw = (env.VAPI_WEBHOOK_AUTH_MODE || 'log').trim().toLowerCase();
  if (raw === 'enforce' || raw === 'off' || raw === 'log') return raw;
  return 'log';
}

export function readPresentedWebhookSecret(headers: { get(name: string): string | null }): string {
  const headerSecret = headers.get('x-vapi-secret')?.trim();
  if (headerSecret) return headerSecret;
  const authorization = readAuthorizationHeader(headers as Headers);
  if (!authorization) return '';
  const match = authorization.match(/^Bearer\s+(\S+)\s*$/i);
  return match?.[1] || '';
}

export function authorizeVapiWebhook(
  headers: { get(name: string): string | null },
  env: { [key: string]: string | undefined } = process.env,
  options?: {
    secretEnvName?: string;
    log?: (message: string) => void;
  }
): VapiWebhookAuthDecision {
  const mode = vapiWebhookAuthMode(env);
  const log = options?.log ?? ((message: string) => console.log(message));
  const secretName = options?.secretEnvName || 'VAPI_WEBHOOK_SECRET';

  if (mode === 'off') {
    log('[webhook-auth] auth_mode=off reason=off');
    return { ok: true, mode, reason: 'off' };
  }

  const configured = env[secretName]?.trim() || '';
  if (!configured) {
    log(`[webhook-auth] auth_mode=${mode} reason=secret_not_configured`);
    if (mode === 'enforce') return { ok: false, mode, reason: 'secret_not_configured', status: 401 };
    return { ok: true, mode, reason: 'secret_not_configured' };
  }

  const presented = readPresentedWebhookSecret(headers);
  if (presented && timingSafeEqualString(presented, configured)) {
    log(`[webhook-auth] auth_mode=${mode} reason=ok`);
    return { ok: true, mode, reason: 'ok' };
  }

  log(`[webhook-auth] auth_mode=${mode} reason=mismatch`);
  if (mode === 'enforce') return { ok: false, mode, reason: 'mismatch', status: 401 };
  return { ok: true, mode, reason: 'mismatch' };
}
