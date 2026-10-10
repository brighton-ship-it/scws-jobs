import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  importAdsCalls,
  matchAdsCallToVoice,
  matchPhoneToParty,
  parseAdsDateTime,
  parseVoiceActivities,
  type StoredAdsCall,
} from './call-match.ts';
import type { AdsCallDraft } from './google-ads-api.ts';

const draft: AdsCallDraft = {
  resourceName: 'customers/1/callViews/9',
  startedAt: '2026-10-01T15:04:05.000Z',
  durationSeconds: 83,
  campaignId: '11',
  campaignName: 'Search-1',
  adGroupName: 'Pump',
  keyword: null,
  callerAreaCode: '760',
  callStatus: 'RECEIVED',
  callSource: 'AD',
};

describe('ads call matching', () => {
  it('joins a voice log within 30s and 15s of duration', () => {
    const match = matchAdsCallToVoice(draft, [
      {
        id: 'too-far',
        startedAt: '2026-10-01T15:06:00.000Z',
        durationSeconds: 83,
        callerPhone: '+17605550000',
      },
      {
        id: 'voice-1',
        startedAt: '2026-10-01T15:04:20.000Z',
        durationSeconds: 90,
        callerPhone: '+1 (760) 555-1212',
      },
    ]);
    assert.equal(match?.id, 'voice-1');
    assert.equal(
      matchPhoneToParty(match?.callerPhone, [
        { id: 'cust-1', phone: '7605551212', kind: 'customer' },
        { id: 'jobber-9', phone: '7605551212', kind: 'jobber_client' },
      ])?.id,
      'cust-1'
    );
  });

  it('rejects a duration that is not the same call', () => {
    const match = matchAdsCallToVoice(draft, [
      {
        id: 'other',
        startedAt: '2026-10-01T15:04:10.000Z',
        durationSeconds: 400,
        callerPhone: '7605551212',
      },
    ]);
    assert.equal(match, null);
  });

  it('parses a Voice admin activity', () => {
    const calls = parseVoiceActivities({
      items: [
        {
          id: { time: '2026-10-01T15:04:20.000Z', uniqueQualifier: 'q1', applicationName: 'voice' },
          events: [
            {
              name: 'call',
              parameters: [
                { name: 'caller_phone_number', value: '+17605551212' },
                { name: 'duration_seconds', intValue: '90' },
              ],
            },
          ],
        },
      ],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].callerPhone, '+17605551212');
    assert.equal(calls[0].durationSeconds, 90);
  });

  it('persists campaign, duration, and the matched phone', async () => {
    const saved: StoredAdsCall[] = [];
    const result = await importAdsCalls({
      drafts: [draft],
      voiceCalls: [
        {
          id: 'voice-1',
          startedAt: '2026-10-01T15:04:20.000Z',
          durationSeconds: 83,
          callerPhone: '7605551212',
        },
      ],
      parties: [],
      lookupJobber: async () => ({ id: 'jobber-9', phone: '7605551212', kind: 'jobber_client' }),
      save: async (row) => {
        saved.push(row);
      },
    });
    assert.equal(result.matchedVoice, 1);
    assert.equal(result.matchedJobber, 1);
    assert.equal(saved[0].caller_phone, '7605551212');
    assert.equal(saved[0].campaign_name, 'Search-1');
    assert.equal(saved[0].duration_seconds, 83);
    assert.equal(saved[0].jobber_client_id, 'jobber-9');
    assert.equal(saved[0].keyword, null);
  });
});

describe('real Voice audit log shape', () => {
  it('reads PARAM_SOURCE, ms PARAM_DURATION and matches PT Ads times', () => {
    const voice = parseVoiceActivities({
      items: [
        {
          id: { time: '2026-10-07T22:33:22.100Z', uniqueQualifier: 'q' },
          events: [
            {
              parameters: [
                { name: 'PARAM_SOURCE', value: '+18587359149' },
                { name: 'PARAM_DURATION', intValue: '63000' },
              ],
            },
          ],
        },
      ],
    });
    assert.equal(voice[0].callerPhone, '+18587359149');
    assert.equal(voice[0].durationSeconds, 63);
    assert.equal(parseAdsDateTime('2026-10-07 15:33:23'), Date.parse('2026-10-07T22:33:23Z'));
    assert.equal(parseAdsDateTime('2026-01-07 15:33:23'), Date.parse('2026-01-07T23:33:23Z'));
    const m = matchAdsCallToVoice(
      { ...draft, startedAt: '2026-10-07 15:33:23', durationSeconds: 63 },
      voice
    );
    assert.equal(m?.callerPhone, '+18587359149');
  });
});
