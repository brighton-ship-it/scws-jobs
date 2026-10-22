import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { desiredRingSeconds, dialTimeoutAttribute, BUSINESS_HOURS_RING_SECONDS } from './ring-timeout.ts';
import { buildAiHandoffTwiml, buildInboundTwiml } from './twiml.ts';
import { AI_RECEPTIONIST } from './config.ts';
import { OFFICE_ALERT_EMAILS } from '../receptionist/office-callback.ts';
import {
  abandonAlertDecision,
  confirmedAbandon,
  callDashboardUrl,
  lineLabel,
  missedAlertCopy,
  missedAlertRecipients,
  notifyMissedInboundCall,
  ringSecondsForAlert,
  statusCallbackPlan,
  MISSED_ALERT_MARKER,
} from './missed-alert.ts';

const SHOP = '+17602763468';
const MIKE = AI_RECEPTIONIST;

describe('business-hours ring timeout', () => {
  it('defaults to 15 seconds of ringing, and the TwiML attribute is 10 because Twilio adds about 5', () => {
    assert.equal(BUSINESS_HOURS_RING_SECONDS, 15);
    assert.equal(desiredRingSeconds(null, {} as NodeJS.ProcessEnv), 15);
    assert.equal(dialTimeoutAttribute(15), 10);
    assert.equal(desiredRingSeconds('15', {} as NodeJS.ProcessEnv), 15);
    assert.equal(dialTimeoutAttribute(desiredRingSeconds('15', { PHONE_CALL_RING_TIMEOUT: '60' } as NodeJS.ProcessEnv)), 10);
  });
  it('honors an explicit override and clamps it', () => {
    assert.equal(desiredRingSeconds(null, { PHONE_CALL_RING_TIMEOUT: '20' } as NodeJS.ProcessEnv), 20);
    assert.equal(dialTimeoutAttribute(20), 15);
    assert.equal(desiredRingSeconds('3', {} as NodeJS.ProcessEnv), 10);
    assert.equal(desiredRingSeconds('999', {} as NodeJS.ProcessEnv), 120);
    assert.equal(desiredRingSeconds('nope', {} as NodeJS.ProcessEnv), 15);
  });
});

describe('inbound TwiML rolls to Mike in the same dial', () => {
  const x = buildInboundTwiml({
    shopNumbers: [SHOP],
    nextNumber: MIKE,
    baseUrl: 'https://scws-jobs.vercel.app/',
    timeout: dialTimeoutAttribute(15),
    notice: 'This call may be recorded for quality and training purposes.',
    actionQuery: '?ai=1&rolled=1&notice=1',
  });
  it('rings the shop, then Mike, with one dial and no second webhook before Mike', () => {
    assert.equal(x.match(/<Dial /g)?.length, 1);
    assert.match(x, /sequential="true"/);
    assert.match(x, /timeout="10"/);
    assert.ok(x.indexOf('<Say') < x.indexOf('<Dial'));
    assert.ok(x.indexOf(SHOP) < x.indexOf(MIKE));
    assert.equal(x.split(SHOP).length - 1, 1);
    assert.match(x, /status\?ai=1&amp;rolled=1&amp;notice=1"/);
    assert.doesNotMatch(x, /<Number>\+17604915348<\/Number>\s*<Number>/);
  });
  it('does not add Mike or sequential when the AI fallback is off', () => {
    const plain = buildInboundTwiml({ shopNumbers: [SHOP], baseUrl: 'https://x.test', timeout: 10 });
    assert.doesNotMatch(plain, /sequential/);
    assert.doesNotMatch(plain, /17604915348/);
  });
  it('a fallback Mike leg cannot dial him twice', () => {
    const handoff = buildAiHandoffTwiml(MIKE, 'https://x.test', '?rolled=1&leg=mike');
    assert.match(handoff, /<Number>\+17604915348<\/Number>/);
    assert.match(handoff, /rolled=1/);
    assert.equal(handoff.match(/<Dial /g)?.length, 1);
    assert.equal(statusCallbackPlan({ dialStatus: 'no-answer', canHandoff: false }).handoff, false);
  });
});

describe('status callback', () => {
  it('does not email or hand off when the shop or Mike answered', () => {
    assert.deepEqual(statusCallbackPlan({ dialStatus: 'completed', canHandoff: true }), { handoff: false, alert: false });
    assert.deepEqual(statusCallbackPlan({ dialStatus: 'answered', canHandoff: false }), { handoff: false, alert: false });
  });
  it('hands off a shop timeout only when Mike is not already in the dial, and does not email yet', () => {
    assert.deepEqual(statusCallbackPlan({ dialStatus: 'no-answer', canHandoff: true }), { handoff: true, alert: false });
    assert.deepEqual(statusCallbackPlan({ dialStatus: 'busy', canHandoff: true }), { handoff: true, alert: false });
  });
  it('emails when the caller hangs up, because returned TwiML will not run', () => {
    assert.deepEqual(statusCallbackPlan({ dialStatus: 'canceled', canHandoff: true }), { handoff: false, alert: true });
    assert.deepEqual(statusCallbackPlan({ dialStatus: 'canceled', canHandoff: false }), { handoff: false, alert: true });
  });
  it('emails when Mike was already in the dial and nobody answered', () => {
    for (const dialStatus of ['no-answer', 'busy', 'failed', '']) {
      assert.deepEqual(statusCallbackPlan({ dialStatus, canHandoff: false }), { handoff: false, alert: true });
    }
  });
});

describe('abandon before the dial', () => {
  const pending = { dial_status: null, processing_status: 'pending' };
  it('alerts when the final status closes a call that never reached the dial', () => {
    const decision = abandonAlertDecision({ params: { CallSid: 'CA1', CallStatus: 'completed', CallDuration: '4' }, row: pending });
    assert.deepEqual(decision, { closeOut: true, alert: true });
  });
  it('does not alert when a dial result is already stored or the call is not final', () => {
    assert.equal(abandonAlertDecision({ params: { CallSid: 'CA1', CallStatus: 'completed' }, row: { dial_status: 'no-answer', processing_status: 'pending' } }).alert, false);
    assert.equal(abandonAlertDecision({ params: { CallSid: 'CA1', CallStatus: 'completed' }, row: { dial_status: 'completed', processing_status: 'done' } }).alert, false);
    assert.equal(abandonAlertDecision({ params: { CallSid: 'CA1', CallStatus: 'ringing' }, row: pending }).alert, false);
    assert.equal(abandonAlertDecision({ params: { CallSid: 'CA1', CallStatus: 'completed' }, row: null }).alert, false);
  });
  it('does not email a call whose dial result arrives while the final status is in flight', async () => {
    let waited = false;
    const decision = await confirmedAbandon({
      params: { CallSid: 'CA1', CallStatus: 'completed', CallDuration: '25' },
      row: { ...pending, started_at: '2026-10-22T14:29:01.000Z' },
      env: {} as NodeJS.ProcessEnv,
      reread: async () => ({ dial_status: 'completed', processing_status: 'pending' }),
      sleep: async () => { waited = true; },
    });
    assert.equal(waited, true);
    assert.equal(decision.alert, false);
    assert.equal(decision.reason, 'dial-arrived');
  });
  it('emails a shop-ring hang-up when the dial action never arrives, with the notice taken out', async () => {
    const decision = await confirmedAbandon({
      params: { CallSid: 'CA1', CallStatus: 'completed', CallDuration: '13' },
      row: { ...pending, started_at: '2026-10-22T14:29:01.000Z' },
      env: {} as NodeJS.ProcessEnv,
      reread: async () => ({ dial_status: null, processing_status: 'pending' }),
      sleep: async () => {},
    });
    assert.equal(decision.alert, true);
    assert.equal(decision.phase, 'dial');
    assert.equal(decision.noticePlayed, true);
    assert.equal(decision.ringSeconds, 8);
    assert.match(decision.summary, /rang about 8 seconds/);
    assert.match(decision.summary, /never reached Mike/);
  });
  it('emails a hang-up during the recording notice without waiting', async () => {
    let waited = false;
    const decision = await confirmedAbandon({
      params: { CallSid: 'CA1', CallStatus: 'completed', CallDuration: '4' },
      row: { ...pending, started_at: '2026-10-22T14:29:01.000Z' },
      env: {} as NodeJS.ProcessEnv,
      reread: async () => { throw new Error('should not re-read'); },
      sleep: async () => { waited = true; },
    });
    assert.equal(waited, false);
    assert.equal(decision.phase, 'before_dial');
    assert.equal(decision.ringSeconds, 0);
    assert.match(decision.summary, /recording notice/);
  });
  it('after hours, a short hang-up was already ringing Mike, so it waits and counts the whole call', async () => {
    let waited = false;
    const decision = await confirmedAbandon({
      params: { CallSid: 'CA1', CallStatus: 'completed', CallDuration: '8' },
      row: { ...pending, started_at: '2026-10-24T18:00:00.000Z' },
      env: {} as NodeJS.ProcessEnv,
      reread: async () => ({ dial_status: null, processing_status: 'pending' }),
      sleep: async () => { waited = true; },
    });
    assert.equal(waited, true);
    assert.equal(decision.phase, 'dial');
    assert.equal(decision.noticePlayed, false);
    assert.equal(decision.ringSeconds, 8);
  });
});

describe('missed-call email', () => {
  const when = new Date('2026-10-22T14:29:26.000Z');
  it('measures shop ring without the recording notice', () => {
    assert.equal(ringSecondsForAlert({
      phase: 'dial', startedAt: '2026-10-22T14:29:01.000Z', now: when, noticePlayed: true,
    }), 20);
    assert.equal(ringSecondsForAlert({ phase: 'before_dial', startedAt: '2026-10-22T14:29:01.000Z', now: when, noticePlayed: true }), 0);
    assert.equal(ringSecondsForAlert({ phase: 'dial', startedAt: '2026-10-22T14:29:01.000Z', now: new Date('2026-10-22T14:29:14.000Z'), noticePlayed: true }), 8);
  });
  it('names the caller, the line, Pacific time, the ring, and the dashboard call', () => {
    const copy = missedAlertCopy({
      callSid: 'CA085fc32751c1bc4408f34a05ce7503cb',
      caller: '+17603159054',
      called: '+17603312502',
      source: 'google_ads',
      when: new Date('2026-10-22T14:29:01.000Z'),
      ringSeconds: 20,
      phase: 'dial',
    }, { NEXT_PUBLIC_APP_URL: 'https://scws-jobs.vercel.app' } as NodeJS.ProcessEnv);
    assert.match(copy.subject, /Missed call before Mike: \(760\) 315-9054/);
    assert.match(copy.text, /Caller: \(760\) 315-9054/);
    assert.match(copy.text, /Line: Google Ads \(760\) 331-2502/);
    assert.match(copy.text, /Time: Thu, Oct 22, 2026, 7:29 AM PT/);
    assert.match(copy.text, /Ring duration: 20 seconds/);
    assert.match(copy.text, /never reached Mike/);
    assert.equal(callDashboardUrl('CA085fc32751c1bc4408f34a05ce7503cb', { NEXT_PUBLIC_APP_URL: 'https://scws-jobs.vercel.app' } as NodeJS.ProcessEnv),
      'https://scws-jobs.vercel.app/ops/calls?call=CA085fc32751c1bc4408f34a05ce7503cb');
    assert.match(copy.text, /https:\/\/scws-jobs\.vercel\.app\/ops\/calls\?call=CA085fc32751c1bc4408f34a05ce7503cb/);
    assert.equal(lineLabel('+17603312502', 'test'), 'Google Ads (760) 331-2502');
  });
  it('goes to Brighton and the office list, once each', () => {
    const to = missedAlertRecipients();
    assert.equal(to[0], 'brighton@scwellservice.com');
    assert.deepEqual(to, [...OFFICE_ALERT_EMAILS]);
    assert.equal(new Set(to).size, to.length);
  });
});

function memoryDb(seed?: Record<string, unknown> | null) {
  const row = seed === undefined ? {
    call_sid: 'CA1', caller_number: '+17603159054', tracking_number: '+17603312502', source: 'google_ads',
    started_at: '2026-10-22T14:29:01.000Z', processing_error: null as string | null,
  } : seed;
  const state = { row: row ? { ...row } : null };
  const db = {
    from() {
      return {
        select() {
          return { eq() { return { maybeSingle: async () => ({ data: state.row, error: null }) }; } };
        },
        update(patch: Record<string, unknown>) {
          const filters: Array<(r: Record<string, unknown>) => boolean> = [];
          const apply = () => {
            if (!state.row || filters.some((f) => !f(state.row as Record<string, unknown>))) return { data: [], error: null };
            Object.assign(state.row, patch);
            return { data: [{ call_sid: state.row.call_sid }], error: null };
          };
          const api: any = {
            eq(col: string, val: string) { filters.push((r) => r[col] === val); return api; },
            is(col: string, val: null) { filters.push((r) => r[col] == null); return api; },
            select: async () => apply(),
            then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) { return Promise.resolve(apply()).then(resolve, reject); },
          };
          return api;
        },
      };
    },
  };
  return { db, state };
}

describe('one email per call', () => {
  const input = {
    callSid: 'CA1', caller: '+17603159054', called: '+17603312502', source: 'google_ads',
    startedAt: '2026-10-22T14:29:01.000Z', phase: 'dial' as const, noticePlayed: true,
    now: new Date('2026-10-22T14:29:16.000Z'),
  };
  it('sends once, and not again for the same call', async () => {
    const { db, state } = memoryDb();
    const sent: string[] = [];
    const send = async (message: { to: string; subject: string; text: string }) => {
      sent.push(message.to);
      assert.match(message.text, /Ring duration: 10 seconds/);
      assert.match(message.text, /7:29 AM PT/);
      return { success: true };
    };
    const env = { NEXT_PUBLIC_APP_URL: 'https://scws-jobs.vercel.app' } as NodeJS.ProcessEnv;
    const first = await notifyMissedInboundCall(input, db, { send, env });
    const second = await notifyMissedInboundCall(input, db, { send, env });
    assert.equal(first.reason, 'sent');
    assert.equal(second.reason, 'already');
    assert.equal(sent.length, OFFICE_ALERT_EMAILS.length);
    assert.equal(state.row?.processing_error, MISSED_ALERT_MARKER);
  });
  it('does not send for a call that was already claimed, and retries when email fails', async () => {
    const claimed = memoryDb();
    claimed.state.row!.processing_error = MISSED_ALERT_MARKER;
    let calls = 0;
    const blocked = await notifyMissedInboundCall(input, claimed.db, { send: async () => { calls += 1; return { success: true }; } });
    assert.equal(blocked.reason, 'already');
    assert.equal(calls, 0);

    const { db, state } = memoryDb();
    const failed = await notifyMissedInboundCall(input, db, { send: async () => ({ success: false, error: 'down' }) });
    assert.equal(failed.reason, 'email-failed');
    assert.equal(state.row?.processing_error, null);
    const retried = await notifyMissedInboundCall(input, db, { send: async () => ({ success: true }) });
    assert.equal(retried.reason, 'sent');
  });
});

describe('Mike is unchanged and callbacks stay off', () => {
  it('does not touch Mike\'s greeting or the callback flag', () => {
    const mike = readFileSync(new URL('../receptionist/mike-callback.ts', import.meta.url), 'utf8');
    const name = readFileSync(new URL('../receptionist/assistant-name.ts', import.meta.url), 'utf8');
    assert.match(name, /ASSISTANT_NAME = 'Mike'/);
    assert.match(mike, /Hey, this is \$\{ASSISTANT_NAME\} with Southern California Well Service\. Just a heads up, this call's recorded\. What's going on with your well\?/);
    assert.match(mike, /truthy\(env\.MIKE_CALLBACKS_ENABLED\) \? 'full' : testNumbers\.size \? 'test' : 'off'/);
    for (const path of [
      '../../app/api/calls/inbound/route.ts',
      '../../app/api/calls/inbound/status/route.ts',
      '../../app/api/calls/webhook/route.ts',
      './missed-alert.ts',
      './ring-timeout.ts',
    ]) {
      const text = readFileSync(new URL(path, import.meta.url), 'utf8');
      assert.equal(text.includes('MIKE_CALLBACKS_ENABLED'), false, path);
    }
  });
});
