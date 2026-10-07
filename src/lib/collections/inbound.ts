/**
 * Inbound texts to the collections number. Disabled unless
 * COLLECTIONS_AUTOREPLY_ENABLED is true. Always replies with empty TwiML
 * after a valid Twilio signature so the existing poll routine still sees the message.
 */

import twilio from 'twilio';
import {
  AUTOREPLY_TEXT,
  AUTOREPLY_THROTTLE_MS,
  bodyHasLongDigitRun,
  collectionsAutoreplyEnabled,
  collectionsMessagingServiceSid,
  FREQUENCY_WINDOW_MS,
  isNoReplyKeyword,
  isStopKeyword,
  phoneHash,
  phoneLast4,
  toE164US,
} from './policy.ts';
import type { CollectionsStore } from './store.ts';

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export type InboundResult = {
  status: number;
  contentType: string;
  body: string;
  sent: boolean;
  reason: string;
};

export type InboundDeps = {
  now?: () => Date;
  store: CollectionsStore;
  sendSms?: (input: { to: string; body: string; messagingServiceSid: string }) => Promise<{
    sid?: string;
    errorCode?: string;
    error?: string;
  }>;
  validate?: (authToken: string, signature: string, url: string, params: Record<string, string>) => boolean;
  autoreplyEnabled?: boolean;
  log?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
};

export function twilioParamsFromBody(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function publicWebhookUrl(request: { url: string; headers: { get(name: string): string | null } }): string {
  const incoming = new URL(request.url);
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').split(',')[0].trim();
  const proto = (request.headers.get('x-forwarded-proto') || incoming.protocol.replace(':', '')).split(',')[0].trim();
  if (!host) return incoming.toString();
  return `${proto}://${host}${incoming.pathname}${incoming.search}`;
}

function defaultValidate(authToken: string, signature: string, url: string, params: Record<string, string>): boolean {
  return twilio.validateRequest(authToken, signature, url, params);
}

export async function handleCollectionsInbound(
  input: {
    signature: string | null;
    url: string;
    params: Record<string, string>;
    authToken: string | null;
  },
  deps: InboundDeps
): Promise<InboundResult> {
  const log = deps.log ?? ((message: string) => console.log(message));
  const validate = deps.validate ?? defaultValidate;
  const token = input.authToken?.trim() || '';
  const signature = input.signature?.trim() || '';
  if (!token || !signature || !validate(token, signature, input.url, input.params)) {
    log('[collections-inbound] signature_rejected');
    return { status: 403, contentType: 'text/plain', body: 'Forbidden', sent: false, reason: 'invalid_signature' };
  }

  const from = toE164US(input.params.From || input.params.from);
  const text = String(input.params.Body ?? input.params.body ?? '');
  const now = (deps.now ?? (() => new Date()))();
  const enabled = deps.autoreplyEnabled ?? collectionsAutoreplyEnabled(deps.env);

  if (!from) {
    log('[collections-inbound] invalid_from');
    return okTwiml('invalid_phone', false);
  }

  const hash = phoneHash(from);
  const last4 = phoneLast4(from);
  const keyword = isNoReplyKeyword(text);
  const stop = isStopKeyword(text);
  const storeBody = bodyHasLongDigitRun(text) ? null : text.slice(0, 2000);

  if (stop) {
    try {
      await deps.store.upsertDoNotText({ phone_e164: from, source: 'inbound_stop', note: 'STOP keyword' });
    } catch {
      log('[collections-inbound] dnc_upsert_failed');
    }
  }

  try {
    await deps.store.insertAutoreply({
      phone_hash: hash,
      phone_last4: last4,
      body_length: text.length,
      keyword,
      body: storeBody,
      direction: 'inbound',
      twilio_sid: input.params.MessageSid || input.params.SmsSid || null,
    });
  } catch {
    log('[collections-inbound] log_failed');
  }

  if (keyword) {
    log(`[collections-inbound] last4=${last4} keyword=1 sent=0`);
    return okTwiml('keyword', false);
  }
  if (!enabled) {
    log(`[collections-inbound] last4=${last4} enabled=0 sent=0`);
    return okTwiml('disabled', false);
  }

  const sentSince = new Date(now.getTime() - FREQUENCY_WINDOW_MS).toISOString();
  const replySince = new Date(now.getTime() - AUTOREPLY_THROTTLE_MS).toISOString();
  let eligible = false;
  let throttled = false;
  try {
    eligible = await deps.store.hasSentCollectionSince(hash, sentSince);
    throttled = (await deps.store.countAutorepliesSince(hash, replySince)) > 0;
  } catch {
    log('[collections-inbound] eligibility_failed');
    return okTwiml('eligibility_failed', false);
  }

  if (!eligible) {
    log(`[collections-inbound] last4=${last4} eligible=0 sent=0`);
    return okTwiml('not_eligible', false);
  }
  if (throttled) {
    log(`[collections-inbound] last4=${last4} throttled=1 sent=0`);
    return okTwiml('throttle_24h', false);
  }
  if (!deps.sendSms) {
    log(`[collections-inbound] last4=${last4} send_not_configured`);
    return okTwiml('send_not_configured', false);
  }

  const sent = await deps.sendSms({
    to: from,
    body: AUTOREPLY_TEXT,
    messagingServiceSid: collectionsMessagingServiceSid(deps.env),
  });
  if (!sent.sid || sent.error) {
    log(`[collections-inbound] last4=${last4} send_failed code=${sent.errorCode || ''}`);
    return okTwiml('send_failed', false);
  }

  try {
    await deps.store.insertAutoreply({
      phone_hash: hash,
      phone_last4: last4,
      body_length: AUTOREPLY_TEXT.length,
      keyword: false,
      body: AUTOREPLY_TEXT,
      direction: 'autoreply',
      twilio_sid: sent.sid,
    });
  } catch {
    log('[collections-inbound] autoreply_log_failed');
  }

  log(`[collections-inbound] last4=${last4} sent=1`);
  return okTwiml('sent', true);
}

function okTwiml(reason: string, sent: boolean): InboundResult {
  return { status: 200, contentType: 'text/xml', body: EMPTY_TWIML, sent, reason };
}
