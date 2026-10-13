import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  adsStartedAtIso,
  assignAdsVoices,
  backfillPartyPatch,
  customerPhoneOrFilter,
  importAdsCalls,
  matchAdsCallToVoice,
  matchPhoneToParty,
  parseAdsDateTime,
  parseVoiceActivities,
  phoneLookupVariants,
  planAdsCallTimeRepairs,
  repairAdsStartedAtStoredAsUtc,
  storedAdsCall,
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
    assert.equal(saved[0].started_at, '2026-10-01T15:04:05.000Z');
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

describe('ads call started_at', () => {
  it('stores PDT and PST wall clocks as UTC instants', () => {
    const pdt = storedAdsCall({ ...draft, startedAt: '2026-10-13 07:28:49' }, null, null);
    const pst = storedAdsCall({ ...draft, startedAt: '2026-01-13 07:28:49' }, null, null);
    assert.equal(pdt.started_at, '2026-10-13T14:28:49.000Z');
    assert.equal(pst.started_at, '2026-01-13T15:28:49.000Z');
    assert.equal(adsStartedAtIso('2026-10-13T14:28:49.000Z'), '2026-10-13T14:28:49.000Z');
    assert.equal(Date.parse(String(pdt.started_at)), Date.parse('2026-10-13T14:28:49.000Z'));
  });

  it('repairs legacy UTC-labeled wall clocks once, including rows outside the import', () => {
    assert.equal(repairAdsStartedAtStoredAsUtc('2026-10-13T07:28:49+00:00'), '2026-10-13T14:28:49.000Z');
    assert.equal(repairAdsStartedAtStoredAsUtc('2026-01-07T15:33:23+00:00'), '2026-01-07T23:33:23.000Z');
    const shifted = repairAdsStartedAtStoredAsUtc('2026-10-13T07:28:49+00:00');
    assert.notEqual(repairAdsStartedAtStoredAsUtc(shifted), shifted);

    const rows = [
      { call_view_resource: 'recent', started_at: '2026-10-13T14:28:49.000Z' },
      { call_view_resource: 'old-pdt', started_at: '2026-10-13T07:28:49+00:00' },
      { call_view_resource: 'old-pst', started_at: '2026-01-13T07:43:28+00:00' },
    ];
    const imported = new Set(['recent']);
    const first = planAdsCallTimeRepairs(rows, imported);
    assert.deepEqual(
      first.map((patch) => patch.call_view_resource),
      ['old-pdt', 'old-pst']
    );
    assert.equal(first[0].started_at, '2026-10-13T14:28:49.000Z');
    assert.equal(first[1].started_at, '2026-01-13T15:43:28.000Z');
    const ledger = new Set([...imported, ...first.map((patch) => patch.call_view_resource)]);
    const again = planAdsCallTimeRepairs(
      rows.map((row) => {
        const patch = first.find((item) => item.call_view_resource === row.call_view_resource);
        return patch ? { ...row, started_at: patch.started_at } : row;
      }),
      ledger
    );
    assert.deepEqual(again, []);
  });
});

describe('ads caller matching', () => {
  it('finds a customer past the first 5000 rows by phone variant', async () => {
    const customers = Array.from({ length: 5001 }, (_, index) => ({
      id: `c-${index}`,
      phone: String(2000000000 + index),
    }));
    customers[5000] = { id: '3168a076-12f0-4b74-8333-42f502a40d15', phone: '16198557276' };
    const variants = new Set(phoneLookupVariants('6198557276'));
    assert.equal(variants.has('6198557276'), true);
    assert.equal(variants.has('16198557276'), true);
    assert.match(customerPhoneOrFilter('(619) 855-7276') || '', /phone\.eq\."16198557276"/);
    const preloaded = customers.slice(0, 5000).map((row) => ({
      id: row.id,
      phone: row.phone,
      kind: 'customer' as const,
    }));
    assert.equal(matchPhoneToParty('6198557276', preloaded), null);
    assert.equal(customers.find((row) => variants.has(row.phone))?.id, '3168a076-12f0-4b74-8333-42f502a40d15');

    const saved: StoredAdsCall[] = [];
    const result = await importAdsCalls({
      drafts: [{ ...draft, startedAt: '2026-10-13 07:28:49', durationSeconds: 83 }],
      voiceCalls: [
        {
          id: 'voice-known',
          startedAt: '2026-10-13T14:28:50.000Z',
          durationSeconds: 83,
          callerPhone: '6198557276',
        },
      ],
      parties: [],
      lookupCustomer: async (phone) => {
        const wanted = new Set(phoneLookupVariants(phone));
        const row = customers.find((customer) => wanted.has(customer.phone));
        return row ? { id: row.id, phone: row.phone, kind: 'customer' } : null;
      },
      save: async (row) => {
        saved.push(row);
      },
    });
    assert.equal(result.matchedCustomer, 1);
    assert.equal(saved[0].customer_id, '3168a076-12f0-4b74-8333-42f502a40d15');
    assert.equal(saved[0].started_at, '2026-10-13T14:28:49.000Z');
    assert.deepEqual(
      backfillPartyPatch(
        { customer_id: null, jobber_client_id: null },
        { id: 'jobber-1', phone: '7609988435', kind: 'jobber_client' }
      ),
      { jobber_client_id: 'jobber-1' }
    );
    assert.equal(
      backfillPartyPatch(
        { customer_id: 'already', jobber_client_id: null },
        { id: 'jobber-1', phone: '7609988435', kind: 'jobber_client' }
      ),
      null
    );
  });

  it('does not reuse one voice call for two ad calls', async () => {
    const voice = {
      id: 'only-one',
      startedAt: '2026-10-13T14:28:49.000Z',
      durationSeconds: 60,
      callerPhone: '+17604152616',
    };
    const drafts = [
      { ...draft, resourceName: 'closer', startedAt: '2026-10-13 07:28:49', durationSeconds: 60 },
      { ...draft, resourceName: 'other', startedAt: '2026-10-13 07:28:55', durationSeconds: 60 },
    ];
    const assigned = assignAdsVoices(drafts, [voice]);
    assert.equal(assigned.size, 1);
    assert.equal(assigned.get('closer')?.id, 'only-one');
    const saved: StoredAdsCall[] = [];
    await importAdsCalls({
      drafts,
      voiceCalls: [voice],
      parties: [],
      save: async (row) => {
        saved.push(row);
      },
    });
    assert.deepEqual(
      saved.map((row) => row.voice_call_id),
      ['only-one', null]
    );
  });

  it('builds a voice id from time and qualifier so a repeated qualifier is not shared', () => {
    const calls = parseVoiceActivities({
      items: [
        {
          id: { time: '2026-10-13T14:28:49.000Z', uniqueQualifier: '-5731400795139174326' },
          events: [{ parameters: [{ name: 'caller_phone_number', value: '+17604152616' }] }],
        },
        {
          id: { time: '2026-10-13T16:05:00.000Z', uniqueQualifier: '-5731400795139174326' },
          events: [{ parameters: [{ name: 'caller_phone_number', value: '+18184148884' }] }],
        },
      ],
    });
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].id, calls[1].id);
    assert.equal(calls[0].id, '2026-10-13T14:28:49.000Z:-5731400795139174326:0');
    assert.equal(calls[1].callerPhone, '+18184148884');
  });
});
