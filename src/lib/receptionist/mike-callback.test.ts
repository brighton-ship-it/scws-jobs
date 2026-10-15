import test from 'node:test';
import assert from 'node:assert/strict';
import { callbackCandidates, summarizeOutreach, type CallbackSource } from '../ads/callbacks.ts';
import { MIKE_FORWARD_NUMBER } from '../ads/phone-call-log.ts';
import {
  amdKind,
  businessCallerId,
  callbackConfig,
  decideMikeCallback,
  dropBookedByMike,
  formatMikeStatus,
  fromLineBusy,
  CALLBACK_SAY_VOICE,
  hangupTwiml,
  humanTwiml,
  phoneForCallbackTool,
  isOpenAt,
  machineTwiml,
  matchInFlightCallback,
  mikeOutreachAttempts,
  mikeStatusLabel,
  nextOpenAt,
  mikeFirstMessage,
  mikeCallbackFirstMessage,
  callbackAssistantOverrides,
  CALLBACK_SILENCE_GREETING_SECONDS,
  CALLBACK_VOICE_VOLUME,
  callbackPublicBase,
  phraseMatches,
  planMikeCallbacks,
  sourcesWithoutMikeLegs,
  visitCreatedInstants,
  voicemailScript,
  zonedTimeToUtc,
  type CallbackCandidate,
  type CallbackContext,
  type PlannedCallback,
  type StoredAttempt,
} from './mike-callback.ts';
import { DialNotAllowedError, placeTwilioCallback, placeVapiCallback } from './mike-callback-dial.ts';
import { callbackPassBlocked, executeMikeCallbacks } from './mike-callback-run.ts';

const FULL = { MIKE_CALLBACKS_ENABLED: 'true', NEXT_PUBLIC_APP_URL: 'https://scws.example' } as NodeJS.ProcessEnv;
const now = new Date('2026-10-14T20:00:00Z'); // Wednesday 1:00 PM Pacific

function missed(over: Partial<CallbackCandidate> = {}): CallbackCandidate {
  return {
    key: 'log:miss-1',
    at: '2026-10-14T19:00:00Z',
    phone: '+17605550100',
    calledNumber: '+17603312502',
    outcome: 'missed',
    durationSeconds: 0,
    ringSeconds: 22,
    name: 'Ada',
    line: 'Ads',
    summary: null,
    spam: false,
    vendor: false,
    aiBooked: false,
    ...over,
  };
}

function ctx(over: Partial<CallbackContext> = {}): CallbackContext {
  return {
    laterInbound: [],
    voiceAttempts: [],
    work: new Map(),
    attempts: [],
    unpaidPhones: new Set(),
    holdPhones: new Set(),
    holdNotes: [],
    dncPhones: new Set(),
    ...over,
  };
}

function decision(over: Partial<CallbackCandidate> = {}, context = ctx(), env: NodeJS.ProcessEnv = FULL, at = now) {
  return decideMikeCallback(missed(over), context, callbackConfig(env), at, env);
}

test('callbacks are off unless the flag or a test allowlist is set', () => {
  assert.equal(callbackConfig({} as NodeJS.ProcessEnv).mode, 'off');
  assert.equal(callbackConfig({ MIKE_CALLBACKS_ENABLED: 'false' } as NodeJS.ProcessEnv).mode, 'off');
  assert.equal(callbackConfig({ MIKE_CALLBACK_TEST_NUMBERS: '+1 (760) 555-0199' } as NodeJS.ProcessEnv).mode, 'test');
  assert.equal(callbackConfig({ MIKE_CALLBACKS_ENABLED: 'true', MIKE_CALLBACK_TEST_NUMBERS: '+17605550199' } as NodeJS.ProcessEnv).mode, 'full');
  assert.equal(callbackConfig(FULL).openMinutes, 8 * 60);
  assert.equal(callbackConfig(FULL).closeMinutes, 17 * 60);
  assert.deepEqual(Array.from(callbackConfig(FULL).days), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
});

test('business hours are Mon-Fri 8am-5pm Pacific and after-hours waits for the next morning', () => {
  const config = callbackConfig(FULL);
  const eight = zonedTimeToUtc(2026, 10, 14, 8, 0, 'America/Los_Angeles');
  assert.equal(eight.toISOString(), '2026-10-14T15:00:00.000Z');
  assert.equal(isOpenAt(new Date('2026-10-14T14:59:00Z'), config), false);
  assert.equal(isOpenAt(new Date('2026-10-14T15:00:00Z'), config), true);
  assert.equal(isOpenAt(new Date('2026-10-14T23:59:00Z'), config), true);
  assert.equal(isOpenAt(new Date('2026-10-15T00:00:00Z'), config), false);
  assert.equal(isOpenAt(new Date('2026-10-17T18:00:00Z'), config), false);
  assert.equal(nextOpenAt(new Date('2026-10-14T14:59:00Z'), config).toISOString(), '2026-10-14T15:00:00.000Z');
  assert.equal(nextOpenAt(new Date('2026-10-15T00:00:00Z'), config).toISOString(), '2026-10-15T15:00:00.000Z');
  assert.equal(nextOpenAt(new Date('2026-10-17T18:00:00Z'), config).toISOString(), '2026-10-19T15:00:00.000Z');

  const early = decision({ at: '2026-10-13T20:00:00Z' }, ctx(), FULL, new Date('2026-10-14T14:59:00Z'));
  assert.equal(early.action, 'queue');
  if (early.action === 'queue') {
    assert.equal(early.reason, 'after_hours');
    assert.equal(early.notBefore, '2026-10-14T15:00:00.000Z');
  }
  const open = decision({ at: '2026-10-13T20:00:00Z' }, ctx(), FULL, new Date('2026-10-14T15:00:00Z'));
  assert.equal(open.action, 'dial');
  const closed = decision({ at: '2026-10-14T23:00:00Z' }, ctx(), FULL, new Date('2026-10-15T00:00:00Z'));
  assert.equal(closed.action, 'queue');
  if (closed.action === 'queue') assert.equal(closed.notBefore, '2026-10-15T15:00:00.000Z');
  const weekend = decision({ at: '2026-10-16T23:00:00Z' }, ctx(), FULL, new Date('2026-10-17T18:00:00Z'));
  assert.equal(weekend.action, 'queue');
  if (weekend.action === 'queue') assert.equal(weekend.notBefore, '2026-10-19T15:00:00.000Z');
});

test('waits five minutes, then dials from the number the customer called', () => {
  const soon = decision({ at: '2026-10-14T19:57:00Z' });
  assert.equal(soon.action, 'queue');
  if (soon.action === 'queue') assert.equal(soon.reason, 'too_soon');
  const ready = decision();
  assert.deepEqual(ready, { action: 'dial', to: '+17605550100', from: '+17603312502' });
  assert.notEqual(businessCallerId('+17604915348', FULL), '+17604915348');
  assert.equal(businessCallerId(MIKE_FORWARD_NUMBER, FULL), null);
  assert.equal(businessCallerId('+16193208264', FULL), null);
  assert.equal(businessCallerId('+17604408520', FULL), '+17604408520');
});

test('flag off and test mode never select a customer who is not allowlisted', () => {
  assert.equal(decision({}, ctx(), {} as NodeJS.ProcessEnv).action, 'skip');
  assert.deepEqual(decision({}, ctx(), {} as NodeJS.ProcessEnv), { action: 'skip', reason: 'flag_off' });
  const testEnv = { MIKE_CALLBACK_TEST_NUMBERS: '+17605550199', NEXT_PUBLIC_APP_URL: 'https://scws.example' } as NodeJS.ProcessEnv;
  assert.deepEqual(decision({}, ctx(), testEnv), { action: 'skip', reason: 'not_allowlisted' });
  const allowed = decision({ phone: '+17605550199' }, ctx(), testEnv);
  assert.equal(allowed.action, 'dial');
  if (allowed.action === 'dial') assert.equal(allowed.to, '+17605550199');
});

test('skips the same people the callback list skips, plus holds, unpaid invoices, and opt-outs', () => {
  assert.equal(decision({ ringSeconds: 4, durationSeconds: 0 }).reason, 'hangup');
  assert.equal(decision({ spam: true }).reason, 'spam');
  assert.equal(decision({ vendor: true }).reason, 'vendor');
  assert.equal(decision({ aiBooked: true }).reason, 'mike_booked');
  assert.equal(decision({ outcome: 'voicemail' }).reason, 'not_missed');
  assert.equal(decision({ outcome: 'forwarded_ai' }).reason, 'not_missed');
  assert.equal(decision({ phone: '+17604408520' }).reason, 'own_number');
  assert.equal(decision({ calledNumber: '+17604915348' }).reason, 'no_from_number');

  const work = new Map<string, number[]>([['7605550100', [Date.parse('2026-10-14T19:30:00Z')]]]);
  assert.equal(decision({}, ctx({ work })).reason, 'jobber_work');
  assert.equal(decision({}, ctx({
    laterInbound: [{ phone: '+17605550100', at: '2026-10-14T19:10:00Z' }],
  })).reason, 'called_again');
  assert.equal(decision({}, ctx({
    laterInbound: [{ phone: '+17605550100', at: '2026-10-14T19:02:00Z' }],
  })).action, 'dial');
  assert.equal(decision({}, ctx({
    voiceAttempts: [{ at: '2026-10-14T19:20:00Z', phone: '+17605550100', staff: 'Liz', durationSeconds: 0 }],
  })).reason, 'voice_callback');
  assert.equal(decision({}, ctx({ unpaidPhones: new Set(['7605550100']) })).reason, 'unpaid_invoice');
  assert.equal(decision({}, ctx({ dncPhones: new Set(['7605550100']) })).reason, 'do_not_call');
  assert.equal(decision({ summary: 'Asked us to do not call' }).reason, 'do_not_call');
  assert.equal(decision({ name: 'Kevin Coleman' }).reason, 'collections_hold');
  assert.equal(decision({ name: 'Steven Garcia', summary: 'On a payment plan' }).reason, 'collections_hold');
  assert.equal(decision({ name: 'Steven Garcia' }).action, 'dial');
  assert.equal(decision({}, ctx({
    holdNotes: [{ phone: '7605550100', text: 'Steven payment plan' }],
  })).reason, 'collections_hold');
  assert.equal(phraseMatches('Kevin Coleman', ['kevin coleman', 'steven payment plan']), true);
  assert.equal(phraseMatches('Steven Garcia', ['steven payment plan']), false);
});

test('one dial per missed call and at most two per number in seven days', () => {
  const prior = (outcome: string, at: string, key = 'log:miss-1'): StoredAttempt => ({
    missedCallKey: key, phone: '+17605550100', fromNumber: '+17603312502', missedAt: '2026-10-14T19:00:00Z',
    attemptedAt: at, outcome, reason: null,
  });
  assert.equal(decision({}, ctx({ attempts: [prior('voicemail', '2026-10-14T19:10:00Z')] })).reason, 'already_attempted');
  assert.equal(decision({}, ctx({ attempts: [prior('queued', '2026-10-14T19:10:00Z')] })).action, 'dial');
  const otherMisses: StoredAttempt[] = [
    prior('voicemail', '2026-10-13T18:00:00Z', 'log:old-1'),
    prior('no-answer', '2026-10-12T18:00:00Z', 'log:old-2'),
  ];
  assert.equal(decision({}, ctx({ attempts: otherMisses })).reason, 'weekly_cap');
  assert.equal(decision({}, ctx({ attempts: [otherMisses[0]] })).action, 'dial');
  assert.equal(decision({}, ctx({
    attempts: [prior('voicemail', '2026-10-01T18:00:00Z', 'log:ancient')],
  })).action, 'dial');
});

test('a busy tracking line waits instead of overlapping two bridges', () => {
  const busy: StoredAttempt = {
    missedCallKey: 'log:other', phone: '+17605550222', fromNumber: '+17603312502',
    missedAt: '2026-10-14T19:40:00Z', attemptedAt: '2026-10-14T19:50:00Z', outcome: 'dialing', reason: null,
  };
  assert.equal(fromLineBusy('+17603312502', [busy], now), true);
  const queued = decision({}, ctx({ attempts: [busy] }));
  assert.equal(queued.action, 'queue');
  if (queued.action === 'queue') assert.equal(queued.reason, 'line_busy');
  assert.equal(matchInFlightCallback('+17603312502', [busy], now)?.phone, '+17605550222');
  assert.equal(matchInFlightCallback('+17605550222', [busy], now)?.phone, '+17605550222');
  assert.equal(matchInFlightCallback('+17605550100', [busy], now), null);
  assert.equal(matchInFlightCallback('+17603312502', [busy, { ...busy, missedCallKey: 'log:third', phone: '+17605550333' }], now), null);
});

test('dashboard copy names Mike, and a voicemail does not clear the callback', () => {
  const attempt: StoredAttempt = {
    missedCallKey: 'log:miss-1', phone: '+17605550100', fromNumber: '+17603312502',
    missedAt: '2026-10-14T19:00:00Z', attemptedAt: '2026-10-14T23:21:00Z', outcome: 'voicemail', reason: null,
  };
  assert.equal(formatMikeStatus(attempt, new Date('2026-10-14T23:30:00Z')), 'Mike tried 4:21 PM, voicemail');
  assert.equal(mikeStatusLabel('+17605550100', '2026-10-14T19:00:00Z', [attempt], new Date('2026-10-14T23:30:00Z')), 'Mike tried 4:21 PM, voicemail');
  assert.equal(formatMikeStatus({ ...attempt, outcome: 'skipped', reason: 'unpaid_invoice', attemptedAt: null }, now), 'Mike skipped 12:00 PM, unpaid invoice');
  const outreach = mikeOutreachAttempts([attempt]);
  assert.equal(outreach[0].staff, 'Mike');
  const view = summarizeOutreach({
    phone: '7605550100', attempts: outreach, fromMs: Date.parse('2026-09-18T07:00:00Z'),
    now: new Date('2026-10-14T23:30:00Z'), anchorAt: '2026-10-14T19:00:00Z', trackCold: true,
  });
  assert.equal(view.attempts, 1);
  assert.equal(view.lastBy, 'Mike');
  const sources: CallbackSource[] = [
    { at: '2026-10-14T23:21:00Z', phone: '+17605550100', kind: 'outbound', durationSeconds: 18, staff: 'Ads' },
    { at: '2026-10-14T23:40:00Z', phone: '+17605550100', kind: 'outbound', durationSeconds: 40, staff: 'Liz' },
  ];
  const kept = sourcesWithoutMikeLegs(sources, [attempt]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].staff, 'Liz');
});

test('Mike speaks the recording disclosure; the callback bridge does not Say it', () => {
  const greeting = mikeFirstMessage();
  assert.match(greeting, /Mike/);
  assert.match(greeting, /Southern California Well Service/);
  assert.match(greeting, /this call's recorded/);
  const voicemail = voicemailScript('+17603312502');
  assert.match(voicemail, /760\) 331-2502/);
  assert.match(voicemail, /number you dialed/);
  assert.doesNotMatch(voicemail, /again|try you|we'll call/i);
  assert.equal(amdKind('machine_end_beep'), 'machine');
  assert.equal(amdKind('human'), 'human');
  assert.equal(amdKind('fax'), 'fax');
  assert.equal(amdKind('unknown'), 'human');
  const machine = machineTwiml(voicemail);
  assert.match(machine, new RegExp(`<Say voice="${CALLBACK_SAY_VOICE}">`));
  assert.doesNotMatch(machine, /Polly\.Joanna/);
  assert.match(machine, /<Hangup/);
  assert.doesNotMatch(machine, /<Dial/);
  const callbackGreeting = mikeCallbackFirstMessage();
  assert.match(callbackGreeting, /returning your call/);
  assert.match(callbackGreeting, /this call's recorded/);
  const human = humanTwiml({ customerPhone: '+14083181171', actionUrl: 'https://scws.example/bridge' });
  assert.doesNotMatch(human, /<Say/);
  assert.doesNotMatch(human, /<Play/);
  assert.match(human, /<Dial/);
  assert.match(human, /<Sip>sip:scws-mike-callback@sip\.vapi\.ai\?X-callback=true&amp;X-customerPhone=%2B14083181171<\/Sip>/);
  assert.doesNotMatch(human, /<Number>/);
  assert.equal(phoneForCallbackTool('+17603312502', '4083181171'), '4083181171');
  assert.equal(phoneForCallbackTool('+14083181171', '4083181171'), '+14083181171');
  assert.equal(phoneForCallbackTool('', '4083181171'), '4083181171');
  assert.match(hangupTwiml(), /<Hangup/);
  assert.deepEqual(visitCreatedInstants({ visits: { nodes: [{ createdAt: '2026-10-14T18:00:00Z' }, { startAt: '2026-10-15T16:00:00Z' }] } }), ['2026-10-14T18:00:00Z', '2026-10-15T16:00:00Z']);
});

test('shared missed-call rows keep the tracking number and ignore Mike-handled calls', () => {
  const candidates = callbackCandidates({
    recordings: [{
      call_sid: 'CAREC', started_at: '2026-10-14T19:00:00Z', caller_number: '+17605550100',
      tracking_number: '+17604630493', answered: false, dial_status: 'no-answer', duration_seconds: 0, ring_seconds: 25,
    }],
    log: [{
      direction: 'inbound', outcome: 'missed', voice_call_key: 'v1', started_at: '2026-10-14T19:00:30Z',
      caller_phone: '+17605550100', called_number: '+17604408520', duration_seconds: 0, ring_seconds: 25,
    }, {
      direction: 'inbound', outcome: 'forwarded_ai', voice_call_key: 'v2', started_at: '2026-10-14T18:00:00Z',
      caller_phone: '+17605550111', called_number: '+17604408520', duration_seconds: 40, receptionist_call_id: 'booked',
    }],
    mike: [],
    bookedMike: new Set(['booked']),
  });
  const plans = planMikeCallbacks(candidates, ctx(), callbackConfig(FULL), now, FULL);
  assert.equal(plans.length, 1);
  const booked = dropBookedByMike(candidates, [{
    missedCallKey: 'recording:CAREC', phone: '+17605550100', fromNumber: '+17604630493',
    missedAt: '2026-10-14T19:00:00Z', attemptedAt: '2026-10-14T19:10:00Z', outcome: 'booked', reason: null,
  }]);
  assert.equal(booked.some((row) => row.key === 'recording:CAREC'), false);
  assert.equal(plans[0].call.key, 'recording:CAREC');
  assert.equal(plans[0].decision.action, 'dial');
  if (plans[0].decision.action === 'dial') assert.equal(plans[0].decision.from, '+17604630493');
});

function dialPlan(phone: string, key: string): PlannedCallback {
  return {
    call: missed({ key, phone }),
    decision: { action: 'dial', to: phone, from: '+17603312502' },
  };
}

test('the executor places no call when the flag is off, and only the allowlist in test mode', async () => {
  let placed: string[] = [];
  const deps = {
    now,
    env: {} as NodeJS.ProcessEnv,
    save: async () => {},
    claim: async () => ({ id: 'row-1' }),
    mark: async () => {},
    place: async (input: { to: string; from: string }) => {
      placed.push(`${input.from}->${input.to}`);
      return { sid: 'CA_TEST' };
    },
  };
  const off = await executeMikeCallbacks([dialPlan('+17605550100', 'a')], deps);
  assert.equal(off.dialed, 0);
  assert.deepEqual(placed, []);

  placed = [];
  const testRun = await executeMikeCallbacks(
    [dialPlan('+17605550100', 'a'), dialPlan('+17605550199', 'b')],
    { ...deps, env: { MIKE_CALLBACK_TEST_NUMBERS: '+17605550199', NEXT_PUBLIC_APP_URL: 'https://scws.example', TWILIO_ACCOUNT_SID: 'AC_TEST', TWILIO_AUTH_TOKEN: 'tok' } as NodeJS.ProcessEnv },
  );
  assert.equal(testRun.dialed, 1);
  assert.deepEqual(placed, ['+17603312502->+17605550199']);

  let fetches = 0;
  await assert.rejects(
    () => placeTwilioCallback(
      { to: '+17605550100', from: '+17603312502', voiceUrl: 'https://scws.example/voice', statusUrl: 'https://scws.example/status', amdUrl: 'https://scws.example/amd' },
      { TWILIO_ACCOUNT_SID: 'AC_TEST', TWILIO_AUTH_TOKEN: 'secret-token', NEXT_PUBLIC_APP_URL: 'https://scws.example' } as NodeJS.ProcessEnv,
      async () => { fetches += 1; return new Response('{}'); },
    ),
    (error: unknown) => error instanceof DialNotAllowedError,
  );
  assert.equal(fetches, 0);
});

test('a live dial posts to Twilio from the tracking number and does not echo the auth token', async () => {
  let body = '';
  let url = '';
  let auth = '';
  const result = await placeTwilioCallback(
    { to: '+17605550199', from: '+17603312502', voiceUrl: 'https://scws.example/voice', statusUrl: 'https://scws.example/status', amdUrl: 'https://scws.example/amd' },
    { MIKE_CALLBACK_TEST_NUMBERS: '+17605550199', NEXT_PUBLIC_APP_URL: 'https://scws.example', TWILIO_ACCOUNT_SID: 'AC_TEST', TWILIO_AUTH_TOKEN: 'secret-token' } as NodeJS.ProcessEnv,
    async (input, init) => {
      url = String(input);
      auth = String((init?.headers as Record<string, string>).Authorization || '');
      body = String(init?.body || '');
      return new Response(JSON.stringify({ sid: 'CA_FAKE' }), { status: 200 });
    },
  );
  assert.equal(result.sid, 'CA_FAKE');
  assert.match(url, /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/AC_TEST\/Calls\.json$/);
  assert.match(body, /From=%2B17603312502/);
  assert.match(body, /To=%2B17605550199/);
  assert.match(body, /MachineDetection=DetectMessageEnd/);
  assert.match(body, /AsyncAmd=true/);
  assert.match(body, /AsyncAmdStatusCallback=/);
  assert.doesNotMatch(body, /secret-token/);
  assert.match(auth, /^Basic /);
});

test('a Vapi callback waits for the callee and does not echo the key', async () => {
  let body = '';
  let auth = '';
  const env = {
    MIKE_CALLBACK_TEST_NUMBERS: '+14083181171',
    NEXT_PUBLIC_APP_URL: 'https://scws.example',
  } as NodeJS.ProcessEnv;
  const result = await placeVapiCallback(
    {
      to: '+14083181171',
      from: '+17604630493',
      voiceUrl: 'https://scws.example/voice',
      statusUrl: 'https://scws.example/status',
      amdUrl: 'https://scws.example/amd',
      name: 'Brighton',
    },
    env,
    { key: 'vapi-secret', phoneNumberId: 'pn_test', assistantId: 'asst_test' },
    async (_input, init) => {
      auth = String((init?.headers as Record<string, string>).Authorization || '');
      body = String(init?.body || '');
      return new Response(JSON.stringify({ id: 'call_test' }), { status: 200 });
    },
  );
  assert.equal(result.vapiCallId, 'call_test');
  const payload = JSON.parse(body) as {
    assistantId: string;
    phoneNumberId: string;
    customer: { number: string; name?: string };
    assistantOverrides: ReturnType<typeof callbackAssistantOverrides>;
  };
  assert.equal(payload.assistantId, 'asst_test');
  assert.equal(payload.phoneNumberId, 'pn_test');
  assert.equal(payload.customer.number, '+14083181171');
  assert.equal(payload.customer.name, 'Brighton');
  assert.equal(payload.assistantOverrides.firstMessage, '');
  assert.equal(payload.assistantOverrides.firstMessageMode, 'assistant-waits-for-user');
  assert.equal(payload.assistantOverrides.backgroundSound, 'off');
  assert.equal(payload.assistantOverrides.hooks[0].on, 'customer.speech.timeout');
  assert.equal(payload.assistantOverrides.hooks[0].options.timeoutSeconds, CALLBACK_SILENCE_GREETING_SECONDS);
  assert.equal(payload.assistantOverrides.hooks[0].options.triggerMaxCount, 1);
  assert.equal(payload.assistantOverrides.hooks[0].options.triggerResetMode, 'never');
  assert.equal(payload.assistantOverrides.hooks[0].do[0].exact, mikeCallbackFirstMessage());
  assert.equal('prompt' in payload.assistantOverrides.hooks[0].do[0], false);
  assert.equal('interruptionsEnabled' in payload.assistantOverrides.hooks[0].do[0], false);
  assert.equal(payload.assistantOverrides.firstMessageInterruptionsEnabled, true);
  assert.deepEqual(payload.assistantOverrides.stopSpeakingPlan, { numWords: 0, voiceSeconds: 0.2, backoffSeconds: 1 });
  assert.doesNotMatch(body, /output no words|Transcript so far|HARD RULE|say","prompt/);
  assert.equal(payload.assistantOverrides.voice.generationConfig.volume, CALLBACK_VOICE_VOLUME);
  assert.equal(payload.assistantOverrides.voice.generationConfig.speed, 1);
  assert.ok(CALLBACK_VOICE_VOLUME < 1);
  assert.ok(CALLBACK_VOICE_VOLUME >= 0.5);
  assert.equal('experimentalControls' in payload.assistantOverrides.voice, false);
  assert.equal(payload.assistantOverrides.voice.fallbackPlan.voices[0].useSpeakerBoost, false);
  assert.equal(payload.assistantOverrides.voice.fallbackPlan.voices[0].style, 0);
  assert.equal(payload.assistantOverrides.variableValues.customerPhone, '+14083181171');
  assert.equal(payload.assistantOverrides.variableValues.callback, 'true');
  assert.doesNotMatch(body, /vapi-secret/);
  assert.match(auth, /^Bearer /);
});

test('an http public URL and a failed exclusion read never dial', () => {
  assert.equal(callbackPublicBase({ NEXT_PUBLIC_APP_URL: 'http://scws.example' } as NodeJS.ProcessEnv), null);
  assert.equal(callbackPublicBase({ NEXT_PUBLIC_APP_URL: 'https://scws.example' } as NodeJS.ProcessEnv), 'https://scws.example');
  assert.equal(callbackPassBlocked(['call log: timeout']), 'call log: timeout');
  assert.equal(callbackPassBlocked(['invoices: missing']), 'invoices: missing');
  assert.equal(callbackPassBlocked(['holds: permission denied']), 'holds: permission denied');
  assert.equal(callbackPassBlocked([]), null);
});
