import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideText, textConfig, textAllowedFor, textBody, mikeCallFinished, newestPerPhone, callerTurns, trackingNumberForCaller, classifyInboundParents, parseTwilioLegs, WORDING, STOP_WORDS, type TextCandidate, type TextContext, type TwilioLeg } from './missed-call-text.ts';
import { PORTED_LINES, TRACKING_SOURCES } from '../phone-calls/config.ts';
import { applyMissedCallTextDecisions, runMissedCallTextPass, sendTextMessage, TextNotAllowedError, handleTextReply } from './missed-call-text-run.ts';

const NOW = new Date('2026-10-19T17:00:00Z'); // Mon 10:00 AM PT
const call = (over: Partial<TextCandidate> = {}): TextCandidate => ({
  key: 'vapi:abc', at: '2026-10-19T16:55:00Z', phone: '+16195550142', calledNumber: '+17604408520', trigger: 'mike_hangup',
  name: null, summary: 'Caller hung up after the greeting.', spam: false, vendor: false, ...over,
});
const ctx = (over: Partial<TextContext> = {}): TextContext => ({
  laterInbound: [], voiceAttempts: [], work: new Map(), activeJobPhones: new Set(), unpaidPhones: new Set(),
  holdPhones: new Set(), holdNotes: [], dncPhones: new Set(), texts: [], staffPhones: new Set(), bookings: [], ...over,
});
const FULL = { MISSED_CALL_TEXT_ENABLED: 'true' } as NodeJS.ProcessEnv;

describe('missed-call text config', () => {
  it('is off by default and never allows a number', () => {
    const c = textConfig({} as NodeJS.ProcessEnv);
    assert.equal(c.mode, 'off');
    assert.equal(textAllowedFor('+16195550142', c), false);
    assert.deepEqual(decideText(call(), ctx(), c, NOW, 'mobile'), { action: 'skip', reason: 'flag_off' });
  });
  it('test mode allows only the allowlist; full mode always blocks the owner test cell', () => {
    const t = textConfig({ MISSED_CALL_TEXT_TEST_NUMBERS: '+14083181171' } as NodeJS.ProcessEnv);
    assert.equal(t.mode, 'test');
    assert.equal(textAllowedFor('+14083181171', t), true);
    assert.equal(textAllowedFor('+16195550142', t), false);
    const f = textConfig(FULL);
    assert.equal(textAllowedFor('+14083181171', f), false);
    assert.equal(decideText(call({ phone: '+14083181171' }), ctx(), f, NOW, 'mobile').action, 'skip');
  });
  it('send refuses when the flag is off (no fetch)', async () => {
    let called = false;
    const fetchImpl = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
    await assert.rejects(sendTextMessage({ to: '+16195550142', body: 'x' }, {} as NodeJS.ProcessEnv, fetchImpl), TextNotAllowedError);
    assert.equal(called, false);
  });
  it('send posts one message and does not add a status callback', async () => {
    let method = '';
    let body = '';
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      method = init?.method || 'GET';
      body = String(init?.body || '');
      return new Response(JSON.stringify({ sid: 'SM1', status: 'queued' }), { status: 200 });
    }) as unknown as typeof fetch;
    const sent = await sendTextMessage({ to: '+16195550142', body: 'Hi' }, { ...FULL, TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok' }, fetchImpl);
    assert.equal(method, 'POST');
    assert.equal(sent.sid, 'SM1');
    assert.equal(sent.status, 'queued');
    const keys: string[] = [];
    new URLSearchParams(body).forEach((_value, key) => keys.push(key));
    keys.sort();
    assert.deepEqual(keys, ['Body', 'MessagingServiceSid', 'To']);
  });
});

describe('decideText', () => {
  const f = textConfig(FULL);
  it('sends one text to a mobile caller whose call ended unfinished', () => {
    const d = decideText(call(), ctx(), f, NOW, 'mobile');
    assert.equal(d.action, 'send');
    if (d.action === 'send') { assert.equal(d.to, '+16195550142'); assert.match(d.body, /cut off/); assert.match(d.body, /Reply STOP/); }
  });
  it('dedupes: nobody gets more than one text in 24h', () => {
    const d = decideText(call({ key: 'vapi:new' }), ctx({ texts: [{ key: 'vapi:old', phone: '6195550142', outcome: 'sent', sentAt: '2026-10-18T20:00:00Z' }] }), f, NOW, 'mobile');
    assert.deepEqual(d, { action: 'skip', reason: 'texted_24h' });
    const ok = decideText(call({ key: 'vapi:new' }), ctx({ texts: [{ key: 'vapi:old', phone: '6195550142', outcome: 'sent', sentAt: '2026-10-18T16:00:00Z' }] }), f, NOW, 'mobile');
    assert.equal(ok.action, 'send');
  });
  it('skips landlines, opted-out, spam, staff, and toll-free numbers', () => {
    assert.equal((decideText(call(), ctx(), f, NOW, 'landline') as any).reason, 'not_mobile:landline');
    assert.equal((decideText(call(), ctx({ dncPhones: new Set(['6195550142']) }), f, NOW, 'mobile') as any).reason, 'opted_out');
    assert.equal((decideText(call({ spam: true }), ctx(), f, NOW, 'mobile') as any).reason, 'spam');
    assert.equal((decideText(call({ summary: 'A recorded message, press 1 to speak to an agent.' }), ctx(), f, NOW, 'mobile') as any).reason, 'spam');
    assert.equal((decideText(call(), ctx({ staffPhones: new Set(['6195550142']) }), f, NOW, 'mobile') as any).reason, 'own_number');
    assert.equal((decideText(call({ phone: '+18005551212' }), ctx(), f, NOW, 'mobile') as any).reason, 'toll_free');
  });
  it('texts callers with an open job, a hold, an open invoice, a later call, or a shop callback', () => {
    assert.equal(decideText(call(), ctx({ activeJobPhones: new Set(['6195550142']) }), f, NOW, 'mobile').action, 'send');
    assert.equal(decideText(call(), ctx({ holdPhones: new Set(['6195550142']) }), f, NOW, 'mobile').action, 'send');
    assert.equal(decideText(call(), ctx({ unpaidPhones: new Set(['6195550142']) }), f, NOW, 'mobile').action, 'send');
    assert.equal(decideText(call(), ctx({ laterInbound: [{ phone: '6195550142', at: '2026-10-19T16:59:30Z' }] }), f, NOW, 'mobile').action, 'send');
    assert.equal(decideText(call(), ctx({ work: new Map([['6195550142', [Date.parse('2026-10-19T16:58:00Z')]]]) }), f, NOW, 'mobile').action, 'send');
    assert.equal(decideText(call(), ctx({ voiceAttempts: [{ at: '2026-10-19T16:57:00Z', phone: '6195550142', staff: 'Liz', durationSeconds: 30 }] }), f, NOW, 'mobile').action, 'send');
  });
  it('waits a minute after the call, and holds texts overnight until 8 AM', () => {
    const soon = decideText(call({ at: '2026-10-19T16:59:30Z' }), ctx(), f, NOW, 'mobile');
    assert.equal(soon.action, 'queue');
    const night = new Date('2026-10-19T05:30:00Z'); // Sun 10:30 PM PT
    const q = decideText(call({ at: '2026-10-19T05:20:00Z' }), ctx(), f, night, 'mobile');
    assert.equal(q.action, 'queue');
    if (q.action === 'queue') { assert.equal(q.reason, 'quiet_hours'); assert.equal(q.notBefore, '2026-10-19T15:00:00.000Z'); }
  });
  it('stale calls are not texted', () => {
    assert.equal((decideText(call({ at: '2026-10-18T17:00:00Z' }), ctx(), f, NOW, 'mobile') as any).reason, 'stale');
  });
  it('a terminal skip row blocks another text; a retryable skip row does not', () => {
    const landline = decideText(call(), ctx({ texts: [{ key: 'vapi:abc', phone: '6195550142', outcome: 'skipped', sentAt: null, reason: 'not_mobile:landline' }] }), f, NOW, 'mobile');
    assert.deepEqual(landline, { action: 'skip', reason: 'already_handled' });
    const line = decideText(call(), ctx({ texts: [{ key: 'vapi:abc', phone: '6195550142', outcome: 'skipped', sentAt: null, reason: 'line_not_enabled' }] }), f, NOW, 'mobile');
    assert.equal(line.action, 'send');
  });
});

describe('wording and helpers', () => {
  it('every option names SCWS, has STOP language, no money, links or phone numbers, and stays one segment-ish', () => {
    for (const opt of Object.values(WORDING)) for (const body of [opt.missed, opt.cutoff]) {
      assert.match(body, /Southern California Well Service/);
      assert.match(body, /Reply STOP to opt out\.$/);
      assert.doesNotMatch(body, /\$|https?:|\d{3}[-.)\s]\d{3}|invoice|bill|pay/i);
      assert.ok(body.length <= 200, `${body.length}`);
    }
    assert.equal(textBody('ring_hangup', 'A'), WORDING.A.missed);
    assert.equal(textBody('mike_unfinished', 'B'), WORDING.B.cutoff);
  });
  it('callback and emergency rows do not finish a Mike call; a job or assessment does', () => {
    const callback = { vapiCallId: 'v1', phone: '16195550142', at: '2026-10-19T16:56:00Z', serviceType: 'Callback' };
    assert.equal(mikeCallFinished({ vapiCallId: 'v1', phone: null, at: '2026-10-19T16:55:00Z' }, [callback]), false);
    assert.equal(mikeCallFinished({ vapiCallId: 'v2', phone: '+16195550142', at: '2026-10-19T16:55:00Z' }, [callback]), false);
    assert.equal(mikeCallFinished({ vapiCallId: 'v2', phone: '+16195550142', at: '2026-10-19T16:55:00Z' }, [{ ...callback, serviceType: 'Emergency' }]), false);
    assert.equal(mikeCallFinished({ vapiCallId: 'v3', phone: null, at: '2026-10-19T16:55:00Z' }, [{ ...callback, vapiCallId: 'v3', serviceType: 'Phone Inquiry' }]), false);
    assert.equal(mikeCallFinished({ vapiCallId: 'v1', phone: '+16195550142', at: '2026-10-19T16:55:00Z' }, [{ ...callback, serviceType: 'Job' }]), true);
    assert.equal(mikeCallFinished({ vapiCallId: null, phone: '+16195550142', at: '2026-10-19T16:55:00Z' }, [{ ...callback, vapiCallId: null, serviceType: 'On-site assessment' }]), true);
    assert.equal(mikeCallFinished({ vapiCallId: 'v2', phone: '+17605550000', at: '2026-10-19T16:55:00Z' }, [{ ...callback, serviceType: 'Job' }]), false);
  });
  it('newest call per phone; caller turns; STOP words', () => {
    const out = newestPerPhone([call({ key: 'a', at: '2026-10-19T16:00:00Z' }), call({ key: 'b', at: '2026-10-19T16:30:00Z' })]);
    assert.deepEqual(out.map((c) => c.key), ['b']);
    assert.equal(callerTurns('AI: Hi\nUser: no water\nAI: ok\nUser: Ramona'), 2);
    assert.ok(STOP_WORDS.test('STOP')); assert.ok(STOP_WORDS.test(' stop. ')); assert.ok(!STOP_WORDS.test("don't stop the visit"));
  });
});

describe('handleTextReply', () => {
  const noTools = { lookupCustomer: async () => ({}), checkServiceArea: async () => ({}), checkSchedule: async () => ({}), bookJob: async () => ({}), handOff: async () => ({}) };
  it('does nothing (no reads) with the flag off', async () => {
    let reads = 0;
    const db = { from: () => { reads++; throw new Error('should not read'); } };
    const r = await handleTextReply({ db, from: '+16195550142', body: 'hi', env: {} as NodeJS.ProcessEnv, now: NOW, tools: noTools, model: null });
    assert.deepEqual(r, { handled: false, reason: 'flag_off' });
    assert.equal(reads, 0);
  });
});

import { test as t2 } from 'node:test';
import assertA from 'node:assert/strict';
import { textConfig as tcA } from './missed-call-text.ts';
t2('approved wording A is the default and the flag stays off by default', () => {
  const c = tcA({} as any);
  assertA.equal(c.option, 'A');
  assertA.equal(c.mode, 'off');
});

describe('Brighton 10/29: text unless there was a real booking', () => {
  const f = textConfig(FULL);
  const MAIN = '+17604408520';
  const SHOP = '+17602763468';
  const MIKE = '+17604915348';
  const CALLER = '+16195550142';
  const lines = new Set(['7604408520']);
  const mikeNumbers = new Set(['7604915348']);
  const at = '2026-10-19T16:55:00Z';
  const parent = (sid: string, durationSeconds: number): TwilioLeg => ({
    sid, parentSid: null, from: CALLER, to: MAIN, direction: 'inbound', status: 'completed', at, durationSeconds,
  });
  const child = (sid: string, parentSid: string, to: string, durationSeconds: number, status = 'completed'): TwilioLeg => ({
    sid, parentSid, from: MAIN, to, direction: 'outbound-dial', status, at, durationSeconds,
  });
  const one = (legs: TwilioLeg[]) => classifyInboundParents({ legs, lines, mikeNumbers })[0];

  it('texts a 17s main-line hang-up before Mike', () => {
    const fromJson = one(parseTwilioLegs({
      calls: [{
        sid: 'CA17', parent_call_sid: null, from: CALLER, to: MAIN, direction: 'inbound',
        status: 'completed', start_time: 'Sun, 19 Oct 2026 16:55:00 +0000', duration: '17',
      }],
    }));
    assert.equal(fromJson.shopAnswered, false);
    assert.equal(fromJson.candidate?.trigger, 'ring_hangup');
    const sent = decideText(fromJson.candidate!, ctx(), f, NOW, 'mobile');
    assert.equal(sent.action, 'send');
    if (sent.action === 'send') assert.match(sent.body, /Sorry we missed your call/);
    const shopSeventeen = one([parent('CA17b', 17), child('CA17shop', 'CA17b', SHOP, 17)]);
    assert.equal(shopSeventeen.candidate?.trigger, 'ring_hangup');
    assert.equal(decideText(shopSeventeen.candidate!, ctx(), f, NOW, 'mobile').action, 'send');
  });

  it('texts when the shop leg only shows answered for 5 to 7 seconds', () => {
    for (const seconds of [5, 6, 7]) {
      const row = one([parent(`P${seconds}`, 40), child(`S${seconds}`, `P${seconds}`, SHOP, seconds)]);
      assert.equal(row.shopAnswered, false, String(seconds));
      assert.equal(row.candidate?.trigger, 'ring_hangup');
      assert.equal(decideText(row.candidate!, ctx(), f, NOW, 'mobile').action, 'send');
    }
  });

  it('texts a Mike call that only filed a callback request', () => {
    const row = one([parent('CAm', 90), child('CAmike', 'CAm', MIKE, 70)]);
    assert.equal(row.candidate?.trigger, 'mike_unfinished');
    const callback = { vapiCallId: 'v-cb', phone: CALLER, at: '2026-10-19T16:56:00Z', serviceType: 'Callback', kind: 'booking_request' as const };
    assert.equal(mikeCallFinished({ vapiCallId: 'v-cb', phone: CALLER, at }, [callback]), false);
    const sent = decideText({ ...row.candidate!, vapiCallId: 'v-cb' }, ctx({ bookings: [callback] }), f, NOW, 'mobile');
    assert.equal(sent.action, 'send');
    if (sent.action === 'send') assert.match(sent.body, /cut off/);
  });

  it('skips a Mike call that ended in a real booking', () => {
    const job = { vapiCallId: 'v-job', phone: CALLER, at: '2026-10-19T16:56:00Z', serviceType: 'Job', kind: 'booking_request' as const };
    const assessment = { vapiCallId: null, phone: '6195550142', at: '2026-10-19T16:58:00Z', serviceType: 'Assessment', kind: 'booking_request' as const };
    const jobberJob = { vapiCallId: null, phone: '6195550142', at: '2026-10-19T17:10:00Z', serviceType: null, kind: 'jobber_job' as const };
    const jobberRequest = { vapiCallId: null, phone: CALLER, at: '2026-10-19T16:57:00Z', serviceType: null, kind: 'jobber_request' as const };
    const callAt = { vapiCallId: 'v-job', phone: CALLER, at };
    assert.equal(mikeCallFinished(callAt, [job]), true);
    assert.equal(mikeCallFinished({ vapiCallId: null, phone: CALLER, at }, [assessment]), true);
    assert.equal(mikeCallFinished({ vapiCallId: null, phone: CALLER, at }, [jobberJob]), true);
    assert.equal(mikeCallFinished({ vapiCallId: null, phone: CALLER, at }, [jobberRequest]), true);
    assert.equal(mikeCallFinished({ vapiCallId: null, phone: CALLER, at }, [{ ...jobberJob, at: '2026-10-19T12:00:00Z' }]), false);
    const skipped = decideText(call({ vapiCallId: 'v-job' }), ctx({ bookings: [job] }), f, NOW, 'mobile');
    assert.deepEqual(skipped, { action: 'skip', reason: 'booked' });
  });

  it('skips a shop leg that was answered for 99 seconds', () => {
    const row = one([parent('CA99', 110), child('CA99shop', 'CA99', SHOP, 99)]);
    assert.equal(row.shopAnswered, true);
    assert.equal(row.candidate, null);
    const boundary = one([parent('CA20', 40), child('CA20shop', 'CA20', SHOP, 20)]);
    assert.equal(boundary.candidate, null);
    const under = one([parent('CA19', 40), child('CA19shop', 'CA19', SHOP, 19)]);
    assert.equal(under.candidate?.trigger, 'ring_hangup');
    assert.equal(decideText(under.candidate!, ctx(), f, NOW, 'mobile').action, 'send');
  });
});

describe('missed-call text line allowlist', () => {
  const env = { ...FULL, MISSED_CALL_TEXT_LINES: '7603312502,7602791262' } as NodeJS.ProcessEnv;
  it('texts every dial-plan line even when the env list is a subset', () => {
    const c = textConfig(env);
    for (const number of [...Object.keys(TRACKING_SOURCES), ...Object.values(PORTED_LINES).map((l) => l.number)]) {
      const d = decideText(call({ calledNumber: number, trigger: 'ring_hangup' }), ctx(), c, NOW, 'mobile');
      assert.notEqual((d as { reason?: string }).reason, 'line_not_enabled', number);
    }
    assert.equal(c.lines.has('7604408520'), true);
    assert.equal(c.lines.has('7607895955'), true);
    assert.equal(c.lines.has('7608256285'), true);
    assert.equal(c.lines.has('9516510957'), true);
  });
  it('skips numbers that are not on the dial plan and calls with no called number', () => {
    const c = textConfig(env);
    assert.equal(decideText(call({ calledNumber: '+17602763468', trigger: 'ring_hangup' }), ctx(), c, NOW, 'mobile').reason, 'line_not_enabled');
    assert.equal(decideText(call({ calledNumber: null }), ctx(), c, NOW, 'mobile').reason, 'line_not_enabled');
  });
});

it('MISSED_CALL_TEXT_LINES_EXTRA adds a number that is not already on the dial plan', () => {
  const c = textConfig({ MISSED_CALL_TEXT_LINES_EXTRA: '+17605550199' } as unknown as NodeJS.ProcessEnv);
  assert.equal(c.lines.has('7605550199'), true);
  assert.equal(c.lines.has('7604408520'), true);
});

function memoryTexts() {
  const rows: Array<Record<string, any>> = [];
  let seq = 0;
  return {
    rows,
    from(table: string) {
      if (table !== 'missed_call_texts') throw new Error(`unexpected table ${table}`);
      return {
        insert(row: Record<string, unknown>) {
          return {
            select() {
              return {
                single: async () => {
                  if (rows.some((existing) => existing.missed_call_key === row.missed_call_key)) {
                    return { data: null, error: { message: 'duplicate key value violates unique constraint "missed_call_texts_key"', code: '23505' } };
                  }
                  const id = `id-${++seq}`;
                  rows.push({ ...row, id });
                  return { data: { id }, error: null };
                },
              };
            },
          };
        },
        select() {
          const filters: Record<string, unknown> = {};
          const api = {
            eq(col: string, val: unknown) { filters[col] = val; return api; },
            limit: async () => ({
              data: rows.filter((row) => Object.entries(filters).every(([col, val]) => row[col] === val)).map((row) => ({ ...row })),
              error: null,
            }),
          };
          return api;
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: async (col: string, val: unknown) => {
              const row = rows.find((item) => item[col] === val);
              if (row) Object.assign(row, patch);
              return { error: null };
            },
          };
        },
      };
    },
  };
}

const TWILIO = { ...FULL, TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok' } as NodeJS.ProcessEnv;

describe('skip reasons are stored on missed_call_texts', () => {
  const booking = { vapiCallId: 'v-job', phone: '+16195550142', at: '2026-10-19T16:56:00Z', serviceType: 'Job', kind: 'booking_request' as const };
  const cases: Array<{ reason: string; call?: Partial<TextCandidate>; ctx?: Partial<TextContext>; env?: NodeJS.ProcessEnv; from: string; line: string | null }> = [
    { reason: 'flag_off', env: {} as NodeJS.ProcessEnv, from: '6195550142', line: '+17604408520' },
    { reason: 'not_allowlisted', env: { MISSED_CALL_TEXT_TEST_NUMBERS: '+17605550199' } as NodeJS.ProcessEnv, from: '6195550142', line: '+17604408520' },
    { reason: 'toll_free', call: { phone: '+18005551212', key: 'twilio:CA_TOLL' }, from: '8005551212', line: '+17604408520' },
    { reason: 'own_number', ctx: { staffPhones: new Set(['6195550142']) }, call: { key: 'twilio:CA_STAFF' }, from: '6195550142', line: '+17604408520' },
    { reason: 'test_number', call: { phone: '+14083181171', key: 'twilio:CA_TEST' }, from: '4083181171', line: '+17604408520' },
    { reason: 'opted_out', ctx: { dncPhones: new Set(['6195550142']) }, call: { key: 'twilio:CA_DNC' }, from: '6195550142', line: '+17604408520' },
    { reason: 'booked', ctx: { bookings: [booking] }, call: { key: 'twilio:CA_BOOKED', vapiCallId: 'v-job' }, from: '6195550142', line: '+17604408520' },
    { reason: 'texted_24h', ctx: { texts: [{ key: 'twilio:CA_OLD', phone: '6195550142', outcome: 'sent', sentAt: '2026-10-19T16:00:00Z' }] }, call: { key: 'twilio:CA_AGAIN' }, from: '6195550142', line: '+17604408520' },
    { reason: 'line_not_enabled', call: { calledNumber: '+17602763468', key: 'twilio:CA_LINE' }, from: '6195550142', line: '+17602763468' },
    { reason: 'stale', call: { at: '2026-10-18T17:00:00Z', key: 'twilio:CA_STALE' }, from: '6195550142', line: '+17604408520' },
    { reason: 'spam', call: { spam: true, key: 'twilio:CA_SPAM' }, from: '6195550142', line: '+17604408520' },
    { reason: 'vendor', call: { vendor: true, key: 'twilio:CA_VENDOR' }, from: '6195550142', line: '+17604408520' },
    { reason: 'no_phone', call: { phone: null, key: 'twilio:CA_NONE' }, from: 'unknown', line: '+17604408520' },
  ];

  it('writes CallSid, from, line, skip reason, and time for every skip, and does not text', async () => {
    for (const spec of cases) {
      const db = memoryTexts();
      const hits: string[] = [];
      const fetchImpl = (async (url: string, init?: RequestInit) => {
        hits.push(`${init?.method || 'GET'} ${url}`);
        return new Response('{}', { status: 500 });
      }) as unknown as typeof fetch;
      const candidate = call({ key: `twilio:${spec.reason}`, ...spec.call });
      const summary = await applyMissedCallTextDecisions({
        db,
        calls: [candidate],
        ctx: ctx(spec.ctx),
        env: spec.env ?? FULL,
        now: NOW,
        fetchImpl,
      });
      assert.equal(summary.sent, 0, spec.reason);
      assert.equal(summary.skipped, 1, spec.reason);
      assert.equal(summary.errors.length, 0, spec.reason);
      assert.equal(db.rows.length, 1, spec.reason);
      assert.equal(db.rows[0].outcome, 'skipped', spec.reason);
      assert.equal(db.rows[0].reason, spec.reason);
      assert.equal(db.rows[0].missed_call_key, candidate.key, spec.reason);
      assert.equal(db.rows[0].caller_phone, spec.from, spec.reason);
      assert.equal(db.rows[0].called_number, spec.line, spec.reason);
      assert.equal(db.rows[0].missed_at, candidate.at, spec.reason);
      assert.equal(typeof db.rows[0].updated_at, 'string', spec.reason);
      assert.equal(hits.some((hit) => hit.includes('Messages.json')), false, spec.reason);
    }
  });

  it('stores not_mobile from Twilio Lookup and does not send', async () => {
    const db = memoryTexts();
    const hits: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      hits.push(`${init?.method || 'GET'} ${url}`);
      return new Response(JSON.stringify({ line_type_intelligence: { type: 'landline' } }), { status: 200 });
    }) as unknown as typeof fetch;
    const summary = await applyMissedCallTextDecisions({
      db,
      calls: [call({ key: 'twilio:CA_LAND', trigger: 'ring_hangup' })],
      ctx: ctx(),
      env: TWILIO,
      now: NOW,
      fetchImpl,
    });
    assert.equal(summary.sent, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].reason, 'not_mobile:landline');
    assert.equal(db.rows[0].line_type, 'landline');
    assert.equal(db.rows[0].missed_call_key, 'twilio:CA_LAND');
    assert.equal(db.rows[0].caller_phone, '6195550142');
    assert.equal(db.rows[0].called_number, '+17604408520');
    assert.equal(hits.length, 1);
    assert.match(hits[0], /GET https:\/\/lookups\.twilio\.com\//);
    assert.equal(hits.some((hit) => hit.includes('Messages.json')), false);
  });

  it('leaves a stored not_mobile row in place on the next pass', async () => {
    const db = memoryTexts();
    const candidate = call({ key: 'twilio:CA_LAND' });
    const lookup = (async () => new Response(JSON.stringify({ line_type_intelligence: { type: 'landline' } }), { status: 200 })) as unknown as typeof fetch;
    await applyMissedCallTextDecisions({ db, calls: [candidate], ctx: ctx(), env: TWILIO, now: NOW, fetchImpl: lookup });
    const againCtx = ctx({ texts: [{ key: candidate.key, phone: '6195550142', outcome: 'skipped', sentAt: null, reason: 'not_mobile:landline' }] });
    let fetches = 0;
    const summary = await applyMissedCallTextDecisions({
      db,
      calls: [candidate],
      ctx: againCtx,
      env: TWILIO,
      now: NOW,
      fetchImpl: (async () => { fetches += 1; return new Response('{}', { status: 500 }); }) as unknown as typeof fetch,
    });
    assert.equal(summary.skipped, 0);
    assert.equal(summary.sent, 0);
    assert.equal(fetches, 0);
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].reason, 'not_mobile:landline');
  });

  it('updates a line_not_enabled row in place, and texts that caller once the line is known', async () => {
    const db = memoryTexts();
    db.rows.push({
      id: 'row-1',
      missed_call_key: 'twilio:CA_LATER',
      caller_phone: '6195550142',
      called_number: null,
      outcome: 'skipped',
      reason: 'line_not_enabled',
      trigger: 'ring_hangup',
      missed_at: '2026-10-19T16:55:00Z',
    });
    const still = await applyMissedCallTextDecisions({
      db,
      calls: [call({ key: 'twilio:CA_LATER', calledNumber: null, trigger: 'ring_hangup' })],
      ctx: ctx({ texts: [{ key: 'twilio:CA_LATER', phone: '6195550142', outcome: 'skipped', sentAt: null, reason: 'line_not_enabled' }] }),
      env: TWILIO,
      now: NOW,
    });
    assert.equal(still.skipped, 1);
    assert.equal(still.sent, 0);
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].id, 'row-1');
    assert.equal(db.rows[0].reason, 'line_not_enabled');

    const hits: Array<{ method: string; url: string; body: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      hits.push({ method: init?.method || 'GET', url: String(url), body: String(init?.body || '') });
      if (String(url).includes('lookups.twilio.com')) {
        return new Response(JSON.stringify({ line_type_intelligence: { type: 'mobile' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ sid: 'SM_LATER', status: 'queued' }), { status: 200 });
    }) as unknown as typeof fetch;
    const sent = await applyMissedCallTextDecisions({
      db,
      calls: [call({ key: 'twilio:CA_LATER', calledNumber: '+17604408520', trigger: 'ring_hangup' })],
      ctx: ctx({ texts: [{ key: 'twilio:CA_LATER', phone: '6195550142', outcome: 'skipped', sentAt: null, reason: db.rows[0].reason }] }),
      env: TWILIO,
      now: NOW,
      fetchImpl,
    });
    assert.equal(sent.sent, 1);
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].id, 'row-1');
    assert.equal(db.rows[0].outcome, 'sent');
    assert.equal(db.rows[0].twilio_message_sid, 'SM_LATER');
    const post = hits.find((hit) => hit.url.includes('Messages.json'));
    assert.ok(post);
    assert.equal(post?.method, 'POST');
    const params = new URLSearchParams(post?.body || '');
    assert.equal(params.get('To'), '+16195550142');
    assert.match(params.get('Body') || '', /Sorry we missed your call/);
    assert.equal(params.has('StatusCallback'), false);
  });

  it('does not store a row while the call is still inside the wait or quiet hours', async () => {
    const db = memoryTexts();
    const soon = await applyMissedCallTextDecisions({
      db,
      calls: [call({ at: '2026-10-19T16:59:30Z', key: 'twilio:CA_SOON' })],
      ctx: ctx(),
      env: FULL,
      now: NOW,
    });
    assert.equal(soon.queued, 1);
    assert.equal(soon.skipped, 0);
    assert.equal(db.rows.length, 0);
    const night = new Date('2026-10-19T05:30:00Z');
    const quiet = await applyMissedCallTextDecisions({
      db,
      calls: [call({ at: '2026-10-19T05:20:00Z', key: 'twilio:CA_NIGHT' })],
      ctx: ctx(),
      env: FULL,
      now: night,
    });
    assert.equal(quiet.queued, 1);
    assert.equal(db.rows.length, 0);
  });

  it('reports a skip that failed to save and does not text', async () => {
    const hits: string[] = [];
    const db = {
      from() {
        return {
          insert() {
            return { select: () => ({ single: async () => ({ data: null, error: { message: 'permission denied' } }) }) };
          },
        };
      },
    };
    const summary = await applyMissedCallTextDecisions({
      db,
      calls: [call({ key: 'twilio:CA_FAIL', phone: '+18005551212' })],
      ctx: ctx(),
      env: TWILIO,
      now: NOW,
      fetchImpl: (async (url: string) => { hits.push(String(url)); return new Response('{}'); }) as unknown as typeof fetch,
    });
    assert.equal(summary.sent, 0);
    assert.equal(summary.skipped, 1);
    assert.deepEqual(summary.errors, ['permission denied']);
    assert.equal(hits.length, 0);
  });

  it('still stores a sent row when the caller is mobile', async () => {
    const db = memoryTexts();
    const hits: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      hits.push(`${init?.method || 'GET'} ${url}`);
      if (String(url).includes('lookups.twilio.com')) {
        return new Response(JSON.stringify({ line_type_intelligence: { type: 'mobile' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ sid: 'SM_OK', status: 'queued' }), { status: 200 });
    }) as unknown as typeof fetch;
    const summary = await applyMissedCallTextDecisions({
      db,
      calls: [call({ key: 'twilio:CA_SEND', trigger: 'ring_hangup' })],
      ctx: ctx(),
      env: TWILIO,
      now: NOW,
      fetchImpl,
    });
    assert.equal(summary.sent, 1);
    assert.equal(summary.skipped, 0);
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].outcome, 'sent');
    assert.equal(db.rows[0].twilio_message_sid, 'SM_OK');
    assert.equal(db.rows[0].missed_call_key, 'twilio:CA_SEND');
    assert.equal(hits.filter((hit) => hit.includes('Messages.json')).length, 1);
  });

  it('the cron pass still reads nothing when the flag is off', async () => {
    let touched = false;
    const db = { from() { touched = true; return {}; } };
    const summary = await runMissedCallTextPass(db, {} as NodeJS.ProcessEnv, NOW, (async () => { touched = true; return new Response('{}'); }) as unknown as typeof fetch);
    assert.equal(summary.mode, 'off');
    assert.equal(summary.sent, 0);
    assert.equal(summary.skipped, 0);
    assert.equal(touched, false);
  });
});

it('a Mike hang-up keeps the inbound tracking number from the matching recording', () => {
  const at = '2026-10-19T16:55:00Z';
  const rows = [
    { phone: '+16195550142', at: '2026-10-19T16:50:00Z', calledNumber: '+17603312502' },
    { phone: '+16195550142', at: '2026-10-19T16:54:40Z', calledNumber: '+17604408520' },
    { phone: '+17605550000', at: '2026-10-19T16:54:50Z', calledNumber: '+17607895955' },
  ];
  assert.equal(trackingNumberForCaller('+16195550142', at, rows), '+17604408520');
  assert.equal(trackingNumberForCaller('+16195550142', '2026-10-19T18:00:00Z', rows), null);
});
