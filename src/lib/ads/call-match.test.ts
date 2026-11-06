import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADS_CALL_VOICE_LOOKBACK_DAYS,
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
  planNullPhoneRestores,
  planVoiceIdFills,
  preserveResolvedAdsCall,
  repairAdsStartedAtStoredAsUtc,
  storedAdsCall,
  voiceActivityStartIso,
  type StoredAdsCall,
} from './call-match.ts';
import { callViewDateWindow, callViewGaql, type AdsCallDraft } from './google-ads-api.ts';
import { ADS_CALL_PHONE_BACKFILL_20261014 } from './ads-call-phone-backfill-20261014.ts';

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

const resolved = {
  call_view_resource: draft.resourceName,
  caller_phone: '6199252869',
  voice_call_id: '2026-09-17T20:23:41.000Z:q:0',
  customer_id: 'cust-doug',
  jobber_client_id: 'jobber-doug',
  match_method: 'voice_time' as const,
};

describe('ads call re-import does not drop a resolved phone', () => {
  it('keeps phone, voice id, customer, Jobber client, and match method when Voice misses', () => {
    const incoming = storedAdsCall({ ...draft, startedAt: '2026-09-17 13:23:41', durationSeconds: 140, campaignName: 'Leads-Search-1' }, null, null);
    assert.equal(incoming.caller_phone, null);
    assert.equal(incoming.match_method, 'unmatched');
    const kept = preserveResolvedAdsCall(incoming, resolved);
    assert.equal(kept.caller_phone, '6199252869');
    assert.equal(kept.voice_call_id, resolved.voice_call_id);
    assert.equal(kept.customer_id, 'cust-doug');
    assert.equal(kept.jobber_client_id, 'jobber-doug');
    assert.equal(kept.match_method, 'voice_time');
    assert.equal(kept.duration_seconds, 140);
    assert.equal(kept.campaign_name, 'Leads-Search-1');
    assert.equal(kept.started_at, '2026-09-17T20:23:41.000Z');
  });

  it('keeps a resolved row when the Voice log fails for the whole window', async () => {
    const saved: StoredAdsCall[] = [];
    const result = await importAdsCalls({
      drafts: [{ ...draft, startedAt: '2026-09-17 13:23:41', durationSeconds: 137, campaignName: 'Leads-Search-1' }],
      voiceCalls: [],
      parties: [],
      existing: [resolved],
      lookupCustomer: async () => {
        throw new Error('lookup should not run without a voice phone');
      },
      save: async (row) => {
        saved.push(row);
      },
    });
    assert.equal(result.matchedVoice, 0);
    assert.equal(saved[0].caller_phone, '6199252869');
    assert.equal(saved[0].voice_call_id, resolved.voice_call_id);
    assert.equal(saved[0].customer_id, 'cust-doug');
    assert.equal(saved[0].jobber_client_id, 'jobber-doug');
    assert.equal(saved[0].match_method, 'voice_time');
    assert.equal(saved[0].campaign_name, 'Leads-Search-1');
  });

  it('replaces a stored phone with a new voice match and keeps party links for that same phone', async () => {
    const saved: StoredAdsCall[] = [];
    await importAdsCalls({
      drafts: [{ ...draft, startedAt: '2026-09-17 13:23:41', durationSeconds: 137 }],
      voiceCalls: [
        {
          id: 'voice-new',
          startedAt: '2026-09-17T20:23:41.000Z',
          durationSeconds: 137,
          callerPhone: '+1 (619) 925-2869',
        },
      ],
      parties: [],
      existing: [resolved],
      save: async (row) => {
        saved.push(row);
      },
    });
    assert.equal(saved[0].caller_phone, '6199252869');
    assert.equal(saved[0].voice_call_id, 'voice-new');
    assert.equal(saved[0].match_method, 'voice_time');
    assert.equal(saved[0].customer_id, 'cust-doug');
    assert.equal(saved[0].jobber_client_id, 'jobber-doug');
  });

  it('drops party links when the new voice match is a different caller', () => {
    const incoming = storedAdsCall(
      draft,
      { id: 'voice-other', startedAt: draft.startedAt!, durationSeconds: 83, callerPhone: '7605551212' },
      null
    );
    const kept = preserveResolvedAdsCall(incoming, resolved);
    assert.equal(kept.caller_phone, '7605551212');
    assert.equal(kept.voice_call_id, 'voice-other');
    assert.equal(kept.customer_id, null);
    assert.equal(kept.jobber_client_id, null);
  });
});

describe('restore phones already nulled by a previous import', () => {
  const nulled = {
    call_view_resource: 'customers/1/callViews/doug',
    started_at: '2026-09-17T20:23:41.000Z',
    duration_seconds: 137,
    campaign_name: 'Leads-Search-1',
    caller_phone: null,
  };

  it('re-matches Voice outside the 30-day call_view window and does not reuse a voice id', () => {
    const now = new Date('2026-10-18T12:52:00.000Z');
    const rolling = now.getTime() - 30 * 86400_000;
    const aligned = Date.parse(voiceActivityStartIso(now, 30));
    assert.ok(aligned < rolling);
    assert.equal(new Date(aligned).toISOString(), '2026-09-18T07:00:00.000Z');
    assert.equal(callViewDateWindow(now, 30).from, '2026-09-18');
    assert.match(callViewGaql(now, 30), /BETWEEN '2026-09-18' AND '2026-10-19'/);
    const wide = Date.parse(voiceActivityStartIso(now, ADS_CALL_VOICE_LOOKBACK_DAYS));
    assert.ok(wide <= Date.parse('2026-09-14T14:01:14Z'));

    const voice = {
      id: 'voice-doug',
      startedAt: '2026-09-17T20:23:41.000Z',
      durationSeconds: 137,
      callerPhone: '+16199252869',
    };
    const taken = {
      id: 'voice-taken',
      startedAt: '2026-09-17T20:23:41.000Z',
      durationSeconds: 137,
      callerPhone: '+17605550000',
    };
    const restores = planNullPhoneRestores([nulled], [voice, taken], { usedVoiceIds: new Set(['voice-taken']) });
    assert.deepEqual(restores, [
      {
        call_view_resource: nulled.call_view_resource,
        caller_phone: '6199252869',
        voice_call_id: 'voice-doug',
        match_method: 'voice_time',
      },
    ]);
  });

  it('uses the snapshot phone only when Voice has no match', () => {
    const restores = planNullPhoneRestores([nulled], [], {
      snapshots: [
        { at: '2026-09-17T20:23:41+00:00', phone: '7608151349', campaign: 'Leads-Search-1' },
        { at: '2026-09-17T20:23:41+00:00', phone: '9995550100', campaign: 'Leads-Search-Drilling' },
      ],
    });
    assert.equal(restores.length, 1);
    assert.equal(restores[0].caller_phone, '7608151349');
    assert.equal(restores[0].voice_call_id, null);
    assert.equal(restores[0].match_method, 'phone_only');
    const skipped = planNullPhoneRestores([{ ...nulled, caller_phone: '7608151349' }], [], {
      snapshots: [{ at: '2026-09-17T20:23:41+00:00', phone: '6199252869', campaign: 'Leads-Search-1' }],
    });
    assert.deepEqual(skipped, []);
  });

  it('carries the 37 phones cleared between the Oct 14 and Oct 18 dashboards', () => {
    assert.equal(ADS_CALL_PHONE_BACKFILL_20261014.length, 37);
    const call = ADS_CALL_PHONE_BACKFILL_20261014.find((row) => row.at.startsWith('2026-09-17T20:23:41'));
    assert.equal(call?.campaign, 'Leads-Search-1');
    assert.equal(call?.phone, '7608151349');
    const restores = planNullPhoneRestores(
      ADS_CALL_PHONE_BACKFILL_20261014.map((row, index) => ({
        call_view_resource: `r-${index}`,
        started_at: row.at,
        duration_seconds: null,
        campaign_name: row.campaign,
        caller_phone: null,
      })),
      [],
      { snapshots: ADS_CALL_PHONE_BACKFILL_20261014 }
    );
    assert.equal(restores.length, 37);
  });

  it('fills a missing voice id only when the log is the same caller', () => {
    const row = { ...nulled, caller_phone: '7608151349', voice_call_id: null };
    const same = planVoiceIdFills(
      [row],
      [{ id: 'v1', startedAt: '2026-09-17T20:23:41.000Z', durationSeconds: 137, callerPhone: '+1 760-815-1349' }]
    );
    assert.deepEqual(same, [{ call_view_resource: row.call_view_resource, voice_call_id: 'v1', match_method: 'voice_time' }]);
    const other = planVoiceIdFills(
      [row],
      [{ id: 'v2', startedAt: '2026-09-17T20:23:41.000Z', durationSeconds: 137, callerPhone: '6199252869' }]
    );
    assert.deepEqual(other, []);
  });
});

/** SCWS Forward, the number Twilio rings before the AI. Not a customer. */
const FORWARD = '+17602763468';
const isForward = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '').endsWith('7602763468');

describe('shop-answered ad calls after the Twilio port', () => {
  // 10:42 AM PT on Oct 28 2026 is 17:42 UTC (PDT).
  const shopDraft: AdsCallDraft = {
    ...draft,
    resourceName: 'customers/1/callViews/shop-1042',
    startedAt: '2026-10-28 10:42:00',
    durationSeconds: 287, // 4m47s on the Google clock, including notice + ring
    campaignName: 'Leads-Search-1',
    callerAreaCode: '619',
  };
  // 1:21 PM and 1:24 PM PT on Oct 29.
  const earlier: AdsCallDraft = {
    ...draft,
    resourceName: 'customers/1/callViews/shop-1321',
    startedAt: '2026-10-29 13:21:00',
    durationSeconds: 62,
    campaignName: 'Leads-Search-1',
    callerAreaCode: '858',
  };
  const later: AdsCallDraft = {
    ...draft,
    resourceName: 'customers/1/callViews/ai-1324',
    startedAt: '2026-10-29 13:24:00',
    durationSeconds: 55,
    campaignName: 'Leads-Search-1',
    callerAreaCode: '858',
  };

  it('keeps the customer when a closer event is the SCWS Forward number', async () => {
    const saved: StoredAdsCall[] = [];
    await importAdsCalls({
      drafts: [shopDraft],
      voiceCalls: [
        {
          id: 'forward-leg',
          startedAt: '2026-10-28T17:42:02.000Z',
          durationSeconds: 287,
          callerPhone: FORWARD,
        },
        {
          id: 'ring-group',
          startedAt: '2026-10-28T17:42:20.000Z',
          durationSeconds: 262,
          callerPhone: '+16193160492',
        },
      ],
      parties: [],
      existing: [{
        call_view_resource: shopDraft.resourceName,
        caller_phone: '7602763468',
        voice_call_id: 'forward-leg',
        customer_id: null,
        jobber_client_id: null,
        match_method: 'voice_time',
      }],
      ownCaller: isForward,
      discardCaller: isForward,
      save: async (row) => { saved.push(row); },
    });
    assert.equal(saved[0].caller_phone, '6193160492');
    assert.equal(saved[0].voice_call_id, 'ring-group');
    assert.equal(saved[0].campaign_name, 'Leads-Search-1');
  });

  it('does not let the 1:21 shop call take the 1:24 call that already matched', () => {
    const assigned = assignAdsVoices(
      [earlier, later],
      [
        { id: 'fwd', startedAt: '2026-10-29T20:21:02.000Z', durationSeconds: 62, callerPhone: FORWARD },
        { id: 'shop', startedAt: '2026-10-29T20:21:18.000Z', durationSeconds: 40, callerPhone: '+18585312478' },
        { id: 'later', startedAt: '2026-10-29T20:24:06.000Z', durationSeconds: 52, callerPhone: '+18585312478' },
      ],
      { ownCaller: isForward, discardCaller: isForward },
    );
    assert.equal(assigned.get(earlier.resourceName)?.id, 'shop');
    assert.equal(assigned.get(later.resourceName)?.id, 'later');
  });

  it('clears a stored forward number when no external caller matches', () => {
    const incoming = storedAdsCall({ ...shopDraft, startedAt: '2026-10-28 10:42:00' }, null, null);
    const kept = preserveResolvedAdsCall(incoming, {
      call_view_resource: shopDraft.resourceName,
      caller_phone: '7602763468',
      voice_call_id: 'forward-leg',
      customer_id: 'cust-shop',
      jobber_client_id: null,
      match_method: 'voice_time',
    }, isForward);
    assert.equal(kept.caller_phone, null);
    assert.equal(kept.customer_id, null);
    assert.equal(kept.match_method, 'unmatched');
  });

  it('keeps a staff caller when that is the only match, and drops a forward-only match', async () => {
    const staff = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '').endsWith('6193208264');
    const saved: StoredAdsCall[] = [];
    await importAdsCalls({
      drafts: [
        { ...draft, resourceName: 'customers/1/callViews/staff', durationSeconds: 40 },
        { ...shopDraft, resourceName: 'customers/1/callViews/forward-only' },
      ],
      voiceCalls: [
        { id: 'liz', startedAt: draft.startedAt!, durationSeconds: 40, callerPhone: '+16193208264' },
        { id: 'only-forward', startedAt: '2026-10-28T17:42:01.000Z', durationSeconds: 287, callerPhone: FORWARD },
      ],
      parties: [],
      existing: [{
        call_view_resource: 'customers/1/callViews/forward-only',
        caller_phone: '7602763468',
        voice_call_id: 'only-forward',
        customer_id: null,
        jobber_client_id: null,
        match_method: 'voice_time',
      }],
      ownCaller: (phone) => staff(phone) || isForward(phone),
      discardCaller: isForward,
      save: async (row) => { saved.push(row); },
    });
    const byId = Object.fromEntries(saved.map((row) => [row.call_view_resource, row]));
    assert.equal(byId['customers/1/callViews/staff'].caller_phone, '6193208264');
    assert.equal(byId['customers/1/callViews/forward-only'].caller_phone, null);
  });

  it('still stores a test caller that is not one of our lines', async () => {
    const saved: StoredAdsCall[] = [];
    await importAdsCalls({
      drafts: [{ ...draft, resourceName: 'customers/1/callViews/test', durationSeconds: 40 }],
      voiceCalls: [{ id: 'brighton', startedAt: draft.startedAt!, durationSeconds: 40, callerPhone: '+14083181171' }],
      parties: [],
      ownCaller: isForward,
      save: async (row) => { saved.push(row); },
    });
    assert.equal(saved[0].caller_phone, '4083181171');
  });

  it('keeps a strict match ahead of a closer shop-window leg', () => {
    const assigned = assignAdsVoices(
      [shopDraft],
      [
        { id: 'other-caller', startedAt: '2026-10-28T17:42:08.000Z', durationSeconds: 250, callerPhone: '+17605550199' },
        { id: 'same-call', startedAt: '2026-10-28T17:42:24.000Z', durationSeconds: 280, callerPhone: '+16193160492' },
      ],
      { ownCaller: isForward, discardCaller: isForward },
    );
    assert.equal(assigned.get(shopDraft.resourceName)?.id, 'same-call');
  });

  it('does not treat a missing Voice duration as the same call', () => {
    const match = matchAdsCallToVoice(shopDraft, [
      { id: 'no-duration', startedAt: '2026-10-28T17:42:01.000Z', durationSeconds: null, callerPhone: '+16193160492' },
    ]);
    assert.equal(match, null);
  });
});
