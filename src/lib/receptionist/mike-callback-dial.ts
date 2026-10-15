/**
 * Place one outbound callback through Twilio.
 * The From number is the tracking or business line the customer dialed.
 * Fetch is injected so tests never touch the network.
 */
import {
  callbackAssistantOverrides,
  callbackConfig,
  callbackPublicBase,
  type CallbackConfig,
} from './mike-callback.ts';
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
  amdUrl: string;
  name?: string | null;
}

export interface PlacedCallback {
  sid: string;
  vapiCallId?: string | null;
}

/** JSON map of digits10(from) → Vapi BYO phone number id. Those ids place the call; they do not change Twilio inbound voice URLs. */
export function vapiCallbackNumberId(from: string, env: NodeJS.ProcessEnv): string | null {
  const raw = env.MIKE_CALLBACK_VAPI_NUMBERS?.trim();
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    const key = digits10(from);
    if (!key) return null;
    const id = map[key] || map[`+1${key}`] || '';
    return id.trim() || null;
  } catch {
    return null;
  }
}

export async function placeTwilioCallback(
  input: PlaceCallbackInput,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<PlacedCallback> {
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
  // Async AMD fetches the voice URL the moment a person answers. Blocking
  // DetectMessageEnd left about five seconds of silence before Mike could speak.
  body.set('MachineDetection', 'DetectMessageEnd');
  body.set('AsyncAmd', 'true');
  body.set('AsyncAmdStatusCallback', input.amdUrl);
  body.set('AsyncAmdStatusCallbackMethod', 'POST');
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

/**
 * Vapi places one call from the tracking number. There is no Twilio bridge
 * on this path, and no say hook, so a second Mike cannot join the audio.
 */
export async function placeVapiCallback(
  input: PlaceCallbackInput,
  env: NodeJS.ProcessEnv,
  auth: { key: string; phoneNumberId: string; assistantId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<PlacedCallback> {
  const config = callbackConfig(env);
  assertDialAllowed(input.to, config);
  const customer: { number: string; name?: string } = { number: input.to };
  const name = input.name?.trim();
  if (name) customer.name = name;
  const response = await fetchImpl('https://api.vapi.ai/call', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      assistantId: auth.assistantId,
      phoneNumberId: auth.phoneNumberId,
      customer,
      assistantOverrides: callbackAssistantOverrides(input.to),
    }),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok || !payload.id) {
    const detail = payload.message ? payload.message.slice(0, 180) : `Vapi ${response.status}`;
    throw new Error(`vapi_error: ${detail}`);
  }
  return { sid: payload.id, vapiCallId: payload.id };
}

export async function placeMikeCallback(
  input: PlaceCallbackInput,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<PlacedCallback> {
  const key = env.VAPI_PRIVATE_KEY?.trim();
  const assistantId = env.MIKE_CALLBACK_ASSISTANT_ID?.trim();
  const phoneNumberId = vapiCallbackNumberId(input.from, env);
  if (key && assistantId && phoneNumberId) {
    return placeVapiCallback(input, env, { key, phoneNumberId, assistantId }, fetchImpl);
  }
  return placeTwilioCallback(input, env, fetchImpl);
}

export async function replaceLiveCallTwiml(
  callSid: string,
  twiml: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token || !callSid) return;
  const body = new URLSearchParams();
  body.set('Twiml', twiml);
  await fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls/${encodeURIComponent(callSid)}.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );
}
