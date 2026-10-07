/**
 * Collections sender. Always uses the Messaging Service SID, never a raw From.
 */

import twilio from 'twilio';
import {
  COLLECTIONS_E164,
  collectionsMessagingServiceSid,
  isStopKeyword,
  toE164US,
} from './policy.ts';

export type CollectionsSendResult =
  | { ok: true; sid: string }
  | { ok: false; error: string; errorCode?: string };

export type CollectionsOptOuts = {
  stopPhones: string[];
  error21610Phones: string[];
};

type MessageCreate = (payload: {
  to: string;
  body: string;
  messagingServiceSid: string;
}) => Promise<{ sid?: string | null }>;

export async function sendViaMessagingService(
  input: { to: string; body: string },
  deps?: {
    env?: NodeJS.ProcessEnv;
    createMessage?: MessageCreate;
  }
): Promise<CollectionsSendResult> {
  const messagingServiceSid = collectionsMessagingServiceSid(deps?.env);
  const payload = {
    to: input.to,
    body: input.body,
    messagingServiceSid,
  };

  try {
    if (deps?.createMessage) {
      const created = await deps.createMessage(payload);
      if (!created.sid) return { ok: false, error: 'send_failed' };
      return { ok: true, sid: created.sid };
    }

    const env = deps?.env ?? process.env;
    const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
    const authToken = env.TWILIO_AUTH_TOKEN?.trim();
    if (!accountSid || !authToken) return { ok: false, error: 'twilio_not_configured' };

    const client = twilio(accountSid, authToken);
    const created = await client.messages.create(payload);
    return { ok: true, sid: created.sid };
  } catch (error: unknown) {
    const code = (error as { code?: unknown })?.code;
    return {
      ok: false,
      error: 'send_failed',
      errorCode: code == null ? undefined : String(code),
    };
  }
}

export async function listCollectionsOptOuts(deps?: {
  env?: NodeJS.ProcessEnv;
  listMessages?: (filter: { to?: string; limit: number }) => Promise<Array<{
    body?: string | null;
    from?: string | null;
    to?: string | null;
    errorCode?: number | string | null;
  }>>;
}): Promise<CollectionsOptOuts> {
  const listMessages = deps?.listMessages;
  const messages = listMessages
    ? {
        inbound: await listMessages({ to: COLLECTIONS_E164, limit: 200 }),
        recent: await listMessages({ limit: 200 }),
      }
    : await listWithTwilio(deps?.env);

  const stopPhones = new Set<string>();
  const error21610Phones = new Set<string>();

  for (const message of messages.inbound) {
    if (!isStopKeyword(message.body || '')) continue;
    const e164 = toE164US(message.from);
    if (e164) stopPhones.add(e164);
  }
  for (const message of messages.recent) {
    if (String(message.errorCode || '') !== '21610') continue;
    const e164 = toE164US(message.to);
    if (e164) error21610Phones.add(e164);
  }

  return { stopPhones: Array.from(stopPhones), error21610Phones: Array.from(error21610Phones) };
}

async function listWithTwilio(env: NodeJS.ProcessEnv = process.env): Promise<{
  inbound: Array<{ body?: string | null; from?: string | null; to?: string | null; errorCode?: number | string | null }>;
  recent: Array<{ body?: string | null; from?: string | null; to?: string | null; errorCode?: number | string | null }>;
}> {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) {
    throw new Error('twilio_not_configured');
  }
  const client = twilio(accountSid, authToken);
  const [inbound, recent] = await Promise.all([
    client.messages.list({ to: COLLECTIONS_E164, limit: 200 }),
    client.messages.list({ limit: 200 }),
  ]);
  return { inbound, recent };
}
