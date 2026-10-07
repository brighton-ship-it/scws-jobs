import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import twilio from 'twilio';
import { handleCollectionsInbound, EMPTY_TWIML } from './inbound.ts';
import { AUTOREPLY_TEXT, INFO_KEYWORDS, phoneHash, STOP_KEYWORDS } from './policy.ts';
import { createMemoryCollectionsStore, type SentRow } from './store.ts';
import { sendViaMessagingService } from './twilio-send.ts';

const TOKEN = 'test-auth-token';
const URL = 'https://example.com/api/sms/collections-inbound';
const FROM = '+17605550100';
const NOW = new Date('2026-01-13T18:00:00.000Z');

function signature(params: Record<string, string>): string {
  return twilio.getExpectedTwilioSignature(TOKEN, URL, params);
}

function sent(created_at: string): SentRow {
  return {
    client_id: 'client-1',
    phone_hash: phoneHash(FROM),
    created_at,
    status: 'sent',
  };
}

describe('handleCollectionsInbound', () => {
  it('rejects a bad Twilio signature', async () => {
    const store = createMemoryCollectionsStore();
    const result = await handleCollectionsInbound(
      {
        signature: 'nope',
        url: URL,
        params: { From: FROM, Body: 'hello' },
        authToken: TOKEN,
      },
      { store, now: () => NOW, autoreplyEnabled: true }
    );
    assert.equal(result.status, 403);
    assert.equal(result.sent, false);
    assert.equal(store.autoreplyLogs.length, 0);
  });

  it('does not send when the auto-reply flag is off', async () => {
    const store = createMemoryCollectionsStore({ sent: [sent('2026-01-10T18:00:00.000Z')] });
    let sentCount = 0;
    const params = { From: FROM, Body: 'Can I pay tomorrow?' };
    const result = await handleCollectionsInbound(
      { signature: signature(params), url: URL, params, authToken: TOKEN },
      {
        store,
        now: () => NOW,
        autoreplyEnabled: false,
        sendSms: async () => {
          sentCount += 1;
          return { sid: 'SM1' };
        },
      }
    );
    assert.equal(result.status, 200);
    assert.equal(result.body, EMPTY_TWIML);
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'disabled');
    assert.equal(sentCount, 0);
    assert.equal(store.autoreplyLogs[0]?.phone_last4, '0100');
    assert.equal(JSON.stringify(store.autoreplyLogs).includes(FROM), false);
  });

  it('never replies to STOP-family or help keywords', async () => {
    for (const keyword of [...STOP_KEYWORDS, ...INFO_KEYWORDS]) {
      const store = createMemoryCollectionsStore({ sent: [sent('2026-01-10T18:00:00.000Z')] });
      let sentCount = 0;
      const params = { From: FROM, Body: `${keyword.toLowerCase()}!` };
      const result = await handleCollectionsInbound(
        { signature: signature(params), url: URL, params, authToken: TOKEN },
        {
          store,
          now: () => NOW,
          autoreplyEnabled: true,
          sendSms: async () => {
            sentCount += 1;
            return { sid: 'SM1' };
          },
        }
      );
      assert.equal(result.sent, false, keyword);
      assert.equal(result.reason, 'keyword', keyword);
      assert.equal(sentCount, 0, keyword);
      if ((STOP_KEYWORDS as readonly string[]).includes(keyword)) {
        assert.equal(store.dnc.some((row) => row.phone_e164 === FROM), true, keyword);
      } else {
        assert.equal(store.dnc.length, 0, keyword);
      }
    }
  });

  it('throttles a second auto-reply inside 24 hours and requires a collection text in 30 days', async () => {
    const eligible = createMemoryCollectionsStore({ sent: [sent('2026-01-10T18:00:00.000Z')] });
    let body = '';
    const params = { From: FROM, Body: 'What is my balance?' };
    const first = await handleCollectionsInbound(
      { signature: signature(params), url: URL, params, authToken: TOKEN },
      {
        store: eligible,
        now: () => NOW,
        autoreplyEnabled: true,
        sendSms: async (input) => {
          body = input.body;
          assert.equal(input.messagingServiceSid.startsWith('MG'), true);
          return { sid: 'SM1' };
        },
      }
    );
    assert.equal(first.sent, true);
    assert.equal(body, AUTOREPLY_TEXT);

    const throttled = await handleCollectionsInbound(
      { signature: signature(params), url: URL, params, authToken: TOKEN },
      {
        store: eligible,
        now: () => new Date('2026-01-13T20:00:00.000Z'),
        autoreplyEnabled: true,
        sendSms: async () => ({ sid: 'SM2' }),
      }
    );
    assert.equal(throttled.reason, 'throttle_24h');
    assert.equal(throttled.sent, false);

    const stale = createMemoryCollectionsStore({ sent: [sent('2025-12-01T18:00:00.000Z')] });
    const ineligible = await handleCollectionsInbound(
      { signature: signature(params), url: URL, params, authToken: TOKEN },
      {
        store: stale,
        now: () => NOW,
        autoreplyEnabled: true,
        sendSms: async () => ({ sid: 'SM3' }),
      }
    );
    assert.equal(ineligible.reason, 'not_eligible');
  });

  it('does not store a body that contains 13 or more digits', async () => {
    const store = createMemoryCollectionsStore();
    const params = { From: FROM, Body: 'card 4111 1111 1111 1111 thanks' };
    await handleCollectionsInbound(
      { signature: signature(params), url: URL, params, authToken: TOKEN },
      { store, now: () => NOW, autoreplyEnabled: false }
    );
    assert.equal(store.autoreplyLogs[0]?.body, null);
    assert.equal(store.autoreplyLogs[0]?.body_length, params.Body.length);
  });
});

describe('sendViaMessagingService', () => {
  it('sends with the messaging service and never a raw from', async () => {
    let serviceSid = '';
    let hasFrom = false;
    const keys: string[] = [];
    const result = await sendViaMessagingService(
      { to: FROM, body: 'hi' },
      {
        createMessage: async (message) => {
          serviceSid = message.messagingServiceSid;
          hasFrom = Object.prototype.hasOwnProperty.call(message, 'from');
          keys.push('to', 'body', 'messagingServiceSid');
          return { sid: 'SM1' };
        },
      }
    );
    assert.equal(result.ok, true);
    assert.deepEqual(keys.sort(), ['body', 'messagingServiceSid', 'to']);
    assert.equal(serviceSid, 'MG66ff74e6d46a9e5439d0a2a718b3a14d');
    assert.equal(hasFrom, false);
  });
});
