import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideText, textConfig, textAllowedFor, textBody, mikeCallFinished, newestPerPhone, callerTurns, WORDING, STOP_WORDS, type TextCandidate, type TextContext } from './missed-call-text.ts';
import { sendTextMessage, TextNotAllowedError, handleTextReply } from './missed-call-text-run.ts';

const NOW = new Date('2026-10-19T17:00:00Z'); // Mon 10:00 AM PT
const call = (over: Partial<TextCandidate> = {}): TextCandidate => ({
  key: 'vapi:abc', at: '2026-10-19T16:55:00Z', phone: '+16195550142', calledNumber: null, trigger: 'mike_hangup',
  name: null, summary: 'Caller hung up after the greeting.', spam: false, vendor: false, ...over,
});
const ctx = (over: Partial<TextContext> = {}): TextContext => ({
  laterInbound: [], voiceAttempts: [], work: new Map(), activeJobPhones: new Set(), unpaidPhones: new Set(),
  holdPhones: new Set(), holdNotes: [], dncPhones: new Set(), texts: [], staffPhones: new Set(), ...over,
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
  it('skips landlines, opted-out, active-job customers, spam, staff, holds and open invoices', () => {
    assert.equal((decideText(call(), ctx(), f, NOW, 'landline') as any).reason, 'not_mobile:landline');
    assert.equal((decideText(call(), ctx({ dncPhones: new Set(['6195550142']) }), f, NOW, 'mobile') as any).reason, 'opted_out');
    assert.equal((decideText(call(), ctx({ activeJobPhones: new Set(['6195550142']) }), f, NOW, 'mobile') as any).reason, 'active_job');
    assert.equal((decideText(call({ spam: true }), ctx(), f, NOW, 'mobile') as any).reason, 'spam');
    assert.equal((decideText(call({ summary: 'A recorded message, press 1 to speak to an agent.' }), ctx(), f, NOW, 'mobile') as any).reason, 'spam');
    assert.equal((decideText(call(), ctx({ staffPhones: new Set(['6195550142']) }), f, NOW, 'mobile') as any).reason, 'own_number');
    assert.equal((decideText(call(), ctx({ holdPhones: new Set(['6195550142']) }), f, NOW, 'mobile') as any).reason, 'hold');
    assert.equal((decideText(call(), ctx({ unpaidPhones: new Set(['6195550142']) }), f, NOW, 'mobile') as any).reason, 'existing_customer_open_invoice');
    assert.equal((decideText(call({ phone: '+18005551212' }), ctx(), f, NOW, 'mobile') as any).reason, 'toll_free');
  });
  it('skips when they called back, got Jobber work, or the shop called them', () => {
    assert.equal((decideText(call(), ctx({ laterInbound: [{ phone: '6195550142', at: '2026-10-19T16:59:30Z' }] }), f, NOW, 'mobile') as any).reason, 'called_again');
    assert.equal((decideText(call(), ctx({ work: new Map([['6195550142', [Date.parse('2026-10-19T16:58:00Z')]]]) }), f, NOW, 'mobile') as any).reason, 'jobber_work');
    assert.equal((decideText(call(), ctx({ voiceAttempts: [{ at: '2026-10-19T16:57:00Z', phone: '6195550142', staff: 'Liz', durationSeconds: 30 }] }), f, NOW, 'mobile') as any).reason, 'shop_called_back');
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
  it('Mike calls with a callback or emergency row count as finished', () => {
    const rows = [{ vapiCallId: 'v1', phone: '16195550142', at: '2026-10-19T16:56:00Z', serviceType: 'Callback' }];
    assert.equal(mikeCallFinished({ vapiCallId: 'v1', phone: null, at: '2026-10-19T16:55:00Z' }, rows), true);
    assert.equal(mikeCallFinished({ vapiCallId: 'v2', phone: '+16195550142', at: '2026-10-19T16:55:00Z' }, rows), true);
    assert.equal(mikeCallFinished({ vapiCallId: 'v2', phone: '+17605550000', at: '2026-10-19T16:55:00Z' }, rows), false);
    assert.equal(mikeCallFinished({ vapiCallId: 'v3', phone: null, at: '2026-10-19T16:55:00Z' }, [{ ...rows[0], vapiCallId: 'v3', serviceType: 'Phone Inquiry' }]), false);
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

describe('missed-call text line allowlist', () => {
  const env = { ...FULL, MISSED_CALL_TEXT_LINES: '7603312502,7602791262' } as NodeJS.ProcessEnv;
  it('skips calls to lines not enabled (main Google Voice line) and unknown lines', () => {
    const c = textConfig(env);
    assert.equal(decideText(call({ calledNumber: '+17604408520', trigger: 'ring_hangup' }), ctx(), c, NOW, 'mobile').reason, 'line_not_enabled');
    assert.equal(decideText(call({ calledNumber: null }), ctx(), c, NOW, 'mobile').reason, 'line_not_enabled');
  });
  it('allows calls to an enabled Twilio line', () => {
    const d = decideText(call({ calledNumber: '+17603312502', trigger: 'ring_hangup' }), ctx(), textConfig(env), NOW, 'mobile');
    assert.notEqual((d as any).reason, 'line_not_enabled');
  });
});
