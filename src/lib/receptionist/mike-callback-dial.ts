/**
 * Place one outbound callback through Twilio.
 * The From number is the tracking or business line the customer dialed.
 * Fetch is injected so tests never touch the network.
 */
import { callbackConfig, callbackPublicBase, type CallbackConfig } from './mike-callback.ts';
import { digits10 } from '../ads/call-dashboard.ts';

export class DialNotAllowedError extends Error {
  constructor() {
    super('dial_not_allowed');
    this.name = 'DialNotAllowedError';
  }
}

export function assertDialAllowed(to: string, config: CallbackConfig): void {
  const phone = digits10(to);
  if (!phone) throw new DialNotAllowedError();
  if (config.mode === 'full') return;
  if (config.mode === 'test' && config.testNumbers.has(phone)) return;
  throw new DialNotAllowedError();
}

export function twilioConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID?.trim() && env.TWILIO_AUTH_TOKEN?.trim());
}

export interface PlaceCallbackInput {
  to: string;
  from: string;
  voiceUrl: string;
  statusUrl: string;
}

export async function placeTwilioCallback(
  input: PlaceCallbackInput,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sid: string }> {
  const config = callbackConfig(env);
  assertDialAllowed(input.to, config);
  if (!callbackPublicBase(env)) throw new Error('public_url_missing');
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) throw new Error('dialer_not_configured');
  if (!input.voiceUrl.startsWith(callbackPublicBase(env) || 'https://invalid')) throw new Error('public_url_missing');

  const body = new URLSearchParams();
  body.set('To', input.to);
  body.set('From', input.from);
  body.set('Url', input.voiceUrl);
  body.set('Method', 'POST');
  body.set('StatusCallback', input.statusUrl);
  body.set('StatusCallbackMethod', 'POST');
  body.append('StatusCallbackEvent', 'completed');
  body.set('MachineDetection', 'DetectMessageEnd');
  body.set('MachineDetectionTimeout', '30');
  body.set('Timeout', '25');

  const response = await fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );
  const payload = await response.json().catch(() => ({})) as { sid?: string; message?: string };
  if (!response.ok || !payload.sid) {
    const detail = payload.message ? payload.message.slice(0, 180) : `Twilio ${response.status}`;
    throw new Error(`twilio_error: ${detail}`);
  }
  return { sid: payload.sid };
}
