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
  AWAIT_MIKE_MARKER,
  CALL_ALERT_MARKER,
  deliverMikeCallEmail,
  inboundAlertCopy,
  inboundCallEmailPlan,
  mergeMikeCallEmail,
  mergeProcessingError,
  missedAlertRecipients,
  noteMikeAwaitingReport,
  notifyMissedInboundCall,
  partyFromProcessing,
  pickInboundForMike,
  recordAnsweredParty,
  ringSecondsForAlert,
  SHOP_ANSWER_MIN_SECONDS,
  shopLegCountsAsMissed,
  statusCallbackPlan,
  sweepInboundEmail,
  SWEEP_MIKE_WAIT_MS,
  SWEEP_UNKNOWN_MIKE_MS,
  commitProcessingNote,
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
    assert.ok(x.indexOf('party=shop') < x.indexOf('party=mike'));
    assert.ok(x.indexOf(SHOP) < x.indexOf(MIKE));
    assert.match(x, /inbound\/leg\?party=shop/);
    assert.equal(x.split(SHOP).length - 1, 1);
    assert.match(x, /status\?ai=1&amp;rolled=1&amp;notice=1"/);
    assert.doesNotMatch(x, /<Number>\+17604915348<\/Number>\s*<Number>/);
  });
  it('still reaches Mike about 15s after the first ring when several shop numbers are configured', () => {
    const extra = '+17605550111';
    const xml = buildInboundTwiml({
      shopNumbers: [SHOP, extra, '+17605550222'],
      nextNumber: MIKE,
      baseUrl: 'https://scws-jobs.vercel.app/',
      timeout: dialTimeoutAttribute(15),
    });
    const numbers = [...xml.matchAll(/<Number[^>]*>([^<]+)<\/Number>/g)].map((m) => m[1]);
    assert.deepEqual(numbers, [SHOP, MIKE]);
    assert.equal(xml.includes(extra), false);
    assert.match(xml, /sequential="true"/);
    assert.match(xml, /timeout="10"/);
    assert.ok(xml.indexOf('party=shop') < xml.indexOf('party=mike'));
  });
  it('does not add Mike or sequential when the AI fallback is off', () => {
    const plain = buildInboundTwiml({ shopNumbers: [SHOP], baseUrl: 'https://x.test', timeout: 10 });
    assert.doesNotMatch(plain, /sequential/);
    assert.doesNotMatch(plain, /17604915348/);
  });
  it('a fallback Mike leg cannot dial him twice', () => {
    const handoff = buildAiHandoffTwiml(MIKE, 'https://x.test', '?rolled=1&leg=mike');
    assert.match(handoff, /<Number[^>]*>\+17604915348<\/Number>/);
    assert.match(handoff, /rolled=1/);
    assert.equal(handoff.match(/<Dial /g)?.length, 1);
    assert.equal(statusCallbackPlan({ dialStatus: 'no-answer', canHandoff: false }).handoff, false);
  });
});

describe('status callback', () => {
  const base = { canHandoff: false, party: null as 'shop' | 'mike' | null, mikeOnly: false, mikeInDial: true };
  it('does not email when the shop answered', () => {
    assert.equal(SHOP_ANSWER_MIN_SECONDS, 20);
    assert.equal(shopLegCountsAsMissed(20), false);
    assert.equal(shopLegCountsAsMissed(null), false);
    assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus: 'completed', party: 'shop', mikeInDial: true, shopSeconds: 125 }), { handoff: false, send: 'no', who: null });
    assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus: 'completed', party: 'shop', mikeInDial: true, shopSeconds: 20 }), { handoff: false, send: 'no', who: null });
    assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus: 'answered', party: 'shop', mikeInDial: false, shopSeconds: 95 }), { handoff: false, send: 'no', who: null });
    assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus: 'completed', party: 'shop', mikeInDial: true }), { handoff: false, send: 'no', who: null });
    assert.deepEqual(inboundCallEmailPlan({ dialStatus: 'completed', canHandoff: false, party: null, mikeOnly: false, mikeInDial: false, shopSeconds: 95 }), { handoff: false, send: 'no', who: null });
  });
  it('counts a short shop leg as missed, because that is voicemail answering', () => {
    assert.equal(shopLegCountsAsMissed(0), true);
    assert.equal(shopLegCountsAsMissed(19), true);
    assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus: 'completed', party: 'shop', mikeInDial: true, shopSeconds: 8 }), { handoff: false, send: 'now', who: 'missed' });
    assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus: 'completed', party: 'shop', mikeInDial: true, shopSeconds: 19 }), { handoff: false, send: 'now', who: 'missed' });
    assert.deepEqual(inboundCallEmailPlan({ dialStatus: 'completed', canHandoff: false, party: null, mikeOnly: false, mikeInDial: false, shopSeconds: 12 }), { handoff: false, send: 'now', who: 'missed' });
    assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus: 'completed', party: 'mike', shopSeconds: 8 }), { handoff: false, send: 'defer', who: 'mike' });
    assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus: 'completed', party: null, mikeOnly: true, mikeInDial: true, shopSeconds: 8 }), { handoff: false, send: 'defer', who: 'mike' });
    assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus: 'completed', party: null, mikeInDial: true, shopSeconds: 8 }), { handoff: false, send: 'defer', who: 'mike' });
  });
  it('waits for Mike\'s end-of-call report when Mike answered', () => {
    assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus: 'completed', party: 'mike' }), { handoff: false, send: 'defer', who: 'mike' });
    assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus: 'completed', party: null, mikeOnly: true, mikeInDial: true }), { handoff: false, send: 'defer', who: 'mike' });
  });
  it('hands off a shop timeout only when Mike is not already in the dial, and does not email yet', () => {
    assert.deepEqual(inboundCallEmailPlan({ dialStatus: 'no-answer', canHandoff: true, party: null, mikeOnly: false, mikeInDial: false }), { handoff: true, send: 'no', who: null });
    assert.equal(statusCallbackPlan({ dialStatus: 'busy', canHandoff: true }).handoff, true);
    assert.equal(statusCallbackPlan({ dialStatus: 'busy', canHandoff: true }).alert, false);
  });
  it('emails when the caller hangs up, because returned TwiML will not run', () => {
    assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus: 'canceled', canHandoff: true }), { handoff: false, send: 'now', who: 'missed' });
    assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus: 'canceled' }), { handoff: false, send: 'now', who: 'missed' });
  });
  it('emails when Mike was already in the dial and nobody answered', () => {
    for (const dialStatus of ['no-answer', 'busy', 'failed', '']) {
      assert.deepEqual(inboundCallEmailPlan({ ...base, dialStatus }), { handoff: false, send: 'now', who: 'missed' });
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
    const copy = inboundAlertCopy({
      callSid: 'CA085fc32751c1bc4408f34a05ce7503cb',
      caller: '+17603159054',
      called: '+17603312502',
      source: 'google_ads',
      when: new Date('2026-10-22T14:29:01.000Z'),
      who: 'missed',
      durationSeconds: 20,
    }, { NEXT_PUBLIC_APP_URL: 'https://scws-jobs.vercel.app' } as NodeJS.ProcessEnv);
    assert.match(copy.subject, /Missed call: \(760\) 315-9054/);
    assert.match(copy.text, /Answered by: Missed/);
    assert.match(copy.text, /Caller: \(760\) 315-9054/);
    assert.match(copy.text, /Line: Google Ads \(760\) 331-2502/);
    assert.match(copy.text, /Time: Thu, Oct 22, 2026, 7:29 AM PT/);
    assert.match(copy.text, /Ring duration: 20 seconds/);
    const mike = inboundAlertCopy({
      callSid: 'CA9', caller: '+17603159054', called: '+17603312502', source: 'google_ads',
      when: new Date('2026-10-22T14:29:01.000Z'), who: 'mike', durationSeconds: 125,
    }, { NEXT_PUBLIC_APP_URL: 'https://scws-jobs.vercel.app' } as NodeJS.ProcessEnv);
    assert.match(mike.subject, /Mike answered: \(760\) 315-9054/);
    assert.match(mike.text, /Answered by: Mike/);
    assert.match(mike.text, /Talk duration: 2 minutes 5 seconds/);
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
  it('does not email a shop-answered call', async () => {
    const { db, state } = memoryDb();
    let calls = 0;
    const result = await notifyMissedInboundCall({ ...input, who: 'shop', durationSeconds: 125 }, db, {
      send: async () => { calls += 1; return { success: true }; },
    });
    assert.equal(result.reason, 'shop-answered');
    assert.equal(result.sent, false);
    assert.equal(calls, 0);
    assert.equal(state.row?.processing_error, null);
  });
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
    assert.equal(state.row?.processing_error, CALL_ALERT_MARKER);
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

describe('one email when Mike also reports the call', () => {
  const built = { subject: '📞 Mike call: (760) 315-9054', text: 'Outcome: Took the call. No booking, emergency flag or callback request was made.\n\nSUMMARY:\nPump is short-cycling.' };
  const mikeRow = {
    call_sid: 'CA1', caller_number: '+17603159054', tracking_number: '+17603312502', source: 'google_ads',
    started_at: '2026-10-22T14:29:01.000Z', processing_error: 'leg:mike',
    answered: true, dial_status: 'completed', duration_seconds: 95,
  };
  it('sends Mike\'s summary once, with who answered, and not again', async () => {
    const { db, state } = memoryDb(mikeRow);
    const sent: string[] = [];
    const env = { NEXT_PUBLIC_APP_URL: 'https://scws-jobs.vercel.app' } as NodeJS.ProcessEnv;
    const first = await deliverMikeCallEmail(db, {
      phone: '7603159054', startedAtMs: Date.parse('2026-10-22T14:29:20.000Z'), built, talkSeconds: 90,
    }, {
      rows: [state.row as typeof mikeRow], env,
      send: async (message) => { sent.push(message.text); assert.equal(message.subject, built.subject); return { success: true }; },
    });
    assert.equal(first.reason, 'merged');
    assert.match(sent[0], /Answered by: Mike/);
    assert.match(sent[0], /Caller: \(760\) 315-9054/);
    assert.match(sent[0], /Line: Google Ads \(760\) 331-2502/);
    assert.match(sent[0], /Time: Thu, Oct 22, 2026, 7:29 AM PT/);
    assert.match(sent[0], /Talk duration: 1 minute 35 seconds/);
    assert.match(sent[0], /Dashboard: https:\/\/scws-jobs\.vercel\.app\/ops\/calls\?call=CA1/);
    assert.match(sent[0], /SUMMARY:\nPump is short-cycling/);
    assert.equal(state.row?.processing_error, `${CALL_ALERT_MARKER}|leg:mike`);
    const second = await deliverMikeCallEmail(db, {
      phone: '+17603159054', startedAtMs: Date.parse('2026-10-22T14:29:20.000Z'), built,
    }, { rows: [state.row as typeof mikeRow], send: async () => { sent.push('again'); return { success: true }; } });
    assert.equal(second.reason, 'already');
    assert.equal(sent.filter((text) => text !== 'again').length, OFFICE_ALERT_EMAILS.length);
  });
  it('still sends Mike\'s summary when the recording callback wins the claim race', async () => {
    const row = { ...mikeRow };
    let raced = false;
    const db = {
      from() {
        return {
          select() {
            return { eq() { return { maybeSingle: async () => ({ data: { ...row }, error: null }) }; } };
          },
          update(patch: Record<string, unknown>) {
            const filters: Array<(current: typeof row) => boolean> = [];
            const api: any = {
              eq(col: string, val: string) { filters.push((current) => (current as any)[col] === val); return api; },
              is(col: string, val: null) { filters.push((current) => (current as any)[col] == null); return api; },
              select: async () => {
                if (!raced && filters.every((f) => f(row))) {
                  raced = true;
                  row.processing_error = 'leg:mike|note posted';
                  return { data: [], error: null };
                }
                if (filters.some((f) => !f(row))) return { data: [], error: null };
                Object.assign(row, patch);
                return { data: [{ call_sid: row.call_sid }], error: null };
              },
            };
            return api;
          },
        };
      },
    };
    const sent: string[] = [];
    const result = await deliverMikeCallEmail(db, {
      phone: '+17603159054', startedAtMs: Date.parse(mikeRow.started_at), built,
    }, { rows: [mikeRow], send: async (message) => { sent.push(message.text); return { success: true }; } });
    assert.equal(result.reason, 'merged');
    assert.equal(row.processing_error, `${CALL_ALERT_MARKER}|leg:mike|note posted`);
    assert.match(sent[0], /SUMMARY:\nPump is short-cycling/);
    assert.match(sent[0], /Answered by: Mike/);
  });
  it('still sends Mike\'s own email when the call did not come through an inbound line', async () => {
    const sent: string[] = [];
    const result = await deliverMikeCallEmail(null, { phone: '+17605550100', startedAtMs: Date.now(), built }, {
      rows: [],
      send: async (message) => { sent.push(message.to); return { success: true }; },
    });
    assert.equal(result.reason, 'own');
    assert.equal(sent.length, OFFICE_ALERT_EMAILS.length);
    let skippedSends = 0;
    const skipped = await deliverMikeCallEmail(null, { phone: '+17605550100', startedAtMs: Date.now(), built, inboundOnly: true }, {
      rows: [],
      send: async () => { skippedSends += 1; return { success: true }; },
    });
    assert.equal(skipped.reason, 'own');
    assert.equal(skippedSends, 0);
    assert.equal(pickInboundForMike([{ ...mikeRow, processing_error: 'leg:shop' }], { phone: '+17603159054', startedAtMs: Date.parse(mikeRow.started_at) }).action, 'own');
    const byLine = pickInboundForMike([mikeRow], { phone: '+17603312502', startedAtMs: Date.parse('2026-10-22T14:29:20.000Z') });
    assert.equal(byLine.action, 'merge');
    if (byLine.action === 'merge') assert.equal(byLine.row.call_sid, 'CA1');
  });
  it('keeps the answered party when the recording note is saved', () => {
    assert.equal(mergeProcessingError('call-alert-sent|leg:shop', 'note posted'), 'call-alert-sent|leg:shop|note posted');
    assert.equal(mergeProcessingError(AWAIT_MIKE_MARKER, 'note posted'), `${AWAIT_MIKE_MARKER}|note posted`);
    assert.equal(mergeMikeCallEmail(built, 'Answered by: Mike').text.startsWith('Answered by: Mike'), true);
  });
});

describe('who answered, and the backup send', () => {
  it('records the first party that answers and ignores a later leg', async () => {
    const { db, state } = memoryDb();
    assert.equal(await recordAnsweredParty(db, 'CA1', 'shop'), 'recorded');
    assert.equal(partyFromProcessing(state.row?.processing_error), 'shop');
    assert.equal(await recordAnsweredParty(db, 'CA1', 'mike'), 'already');
    assert.equal(partyFromProcessing(state.row?.processing_error), 'shop');
  });
  it('sweeps a finished Mike call only after his report had time to arrive', () => {
    const now = Date.parse('2026-10-22T15:00:00.000Z');
    assert.equal(SWEEP_MIKE_WAIT_MS, 45 * 60 * 1000);
    const row = { processing_error: 'leg:mike', dial_status: 'completed', answered: true, updated_at: new Date(now - 11 * 60_000).toISOString() };
    assert.equal(sweepInboundEmail(row, now), null);
    assert.equal(sweepInboundEmail({ ...row, updated_at: new Date(now - SWEEP_MIKE_WAIT_MS - 60_000).toISOString() }, now), 'mike');
    assert.equal(sweepInboundEmail({ ...row, processing_error: `${CALL_ALERT_MARKER}|leg:mike`, updated_at: new Date(now - SWEEP_MIKE_WAIT_MS - 60_000).toISOString() }, now), null);
    const unknown = { processing_error: null, dial_status: 'completed', answered: true, updated_at: new Date(now - 11 * 60_000).toISOString() };
    assert.equal(sweepInboundEmail(unknown, now), null);
    assert.equal(sweepInboundEmail({ ...unknown, updated_at: new Date(now - SWEEP_MIKE_WAIT_MS - 60_000).toISOString() }, now), null);
    assert.equal(sweepInboundEmail({ processing_error: 'leg:shop', dial_status: 'completed', answered: true, duration_seconds: 125, updated_at: new Date(now - 3 * 60_000).toISOString() }, now), null);
    assert.equal(sweepInboundEmail({ processing_error: null, dial_status: 'canceled', answered: false, updated_at: new Date(now - 3 * 60_000).toISOString() }, now), 'missed');
    assert.equal(sweepInboundEmail({ processing_error: null, dial_status: null, answered: null, updated_at: new Date(now - 30 * 60_000).toISOString() }, now), null);
  });
  it('keeps the alert claim when the recording note is saved after it', async () => {
    const { db, state } = memoryDb({ call_sid: 'CA1', processing_error: `${CALL_ALERT_MARKER}|leg:mike` });
    await commitProcessingNote(db, 'CA1', 'note posted', '2026-10-22T15:00:00.000Z');
    assert.equal(state.row?.processing_error, `${CALL_ALERT_MARKER}|leg:mike|note posted`);
  });
});

describe('shop voicemail and a missing Mike report', () => {
  const now = Date.parse('2026-10-22T15:00:00.000Z');
  const input = {
    callSid: 'CA1', caller: '+17603159054', called: '+17603312502', source: 'google_ads',
    startedAt: '2026-10-22T14:29:01.000Z', phase: 'dial' as const, noticePlayed: true,
    now: new Date('2026-10-22T14:29:16.000Z'),
  };
  const seed = {
    call_sid: 'CA1', caller_number: '+17603159054', tracking_number: '+17603312502', source: 'google_ads',
    started_at: '2026-10-22T14:29:01.000Z', processing_error: null as string | null,
    dial_status: 'completed', answered: true, duration_seconds: 11,
    updated_at: new Date(now - 3 * 60_000).toISOString(),
  };

  it('emails a voicemail-answered shop leg once, and the sweep does not send again', async () => {
    const plan = inboundCallEmailPlan({ dialStatus: 'completed', canHandoff: false, party: 'shop', mikeOnly: false, mikeInDial: true, shopSeconds: 11 });
    assert.deepEqual(plan, { handoff: false, send: 'now', who: 'missed' });
    const { db, state } = memoryDb({ ...seed, processing_error: 'leg:shop' });
    const sent: string[] = [];
    const send = async (message: { to: string; subject: string; text: string }) => {
      sent.push(message.subject);
      assert.match(message.subject, /^Missed call:/);
      assert.match(message.text, /Nobody answered this call/);
      assert.equal(message.text.includes('The shop answered'), false);
      return { success: true };
    };
    const first = await notifyMissedInboundCall({ ...input, who: 'missed' }, db, { send });
    const second = await notifyMissedInboundCall({ ...input, who: 'missed' }, db, { send });
    assert.equal(first.reason, 'sent');
    assert.equal(second.reason, 'already');
    assert.equal(sent.length, OFFICE_ALERT_EMAILS.length);
    assert.equal(sweepInboundEmail(state.row as typeof seed, now), null);
  });

  it('retries a voicemail email that failed, still only once', async () => {
    const { db, state } = memoryDb({ ...seed, processing_error: 'leg:shop', duration_seconds: 6 });
    const failed = await notifyMissedInboundCall({ ...input, who: 'missed' }, db, {
      send: async () => ({ success: false, error: 'down' }),
    });
    assert.equal(failed.reason, 'email-failed');
    assert.equal(state.row?.processing_error, 'leg:shop');
    const sweepAt = Date.now() + 3 * 60_000;
    assert.equal(sweepInboundEmail(state.row as typeof seed, sweepAt), 'missed');
    let calls = 0;
    const retried = await notifyMissedInboundCall({ ...input, who: 'missed' }, db, {
      send: async () => { calls += 1; return { success: true }; },
    });
    assert.equal(retried.reason, 'sent');
    assert.equal(calls, OFFICE_ALERT_EMAILS.length);
    assert.equal(sweepInboundEmail(state.row as typeof seed, sweepAt), null);
  });

  it('does not email when the shop stayed on the line', () => {
    const plan = inboundCallEmailPlan({ dialStatus: 'completed', canHandoff: false, party: 'shop', mikeOnly: false, mikeInDial: true, shopSeconds: 95 });
    assert.deepEqual(plan, { handoff: false, send: 'no', who: null });
    assert.equal(sweepInboundEmail({
      processing_error: 'leg:shop', dial_status: 'completed', answered: true, duration_seconds: 95,
      updated_at: new Date(now - 30 * 60_000).toISOString(),
    }, now), null);
    assert.equal(sweepInboundEmail({
      processing_error: `${AWAIT_MIKE_MARKER}|leg:shop`, dial_status: 'completed', answered: true, duration_seconds: 95,
      updated_at: new Date(now - 30 * 60_000).toISOString(),
    }, now), null);
  });

  it('sends one missed-call email when Mike was in the dial and his report never arrives', async () => {
    assert.equal(SWEEP_UNKNOWN_MIKE_MS, 10 * 60 * 1000);
    const { db, state } = memoryDb({
      ...seed, duration_seconds: 80, started_at: '2026-10-22T14:49:00.000Z',
      updated_at: new Date(now - 60_000).toISOString(),
    });
    assert.equal(await noteMikeAwaitingReport(db, 'CA1'), 'noted');
    assert.equal(state.row?.processing_error, AWAIT_MIKE_MARKER);
    assert.equal(await noteMikeAwaitingReport(db, 'CA1'), 'already');
    state.row!.updated_at = new Date(now - SWEEP_UNKNOWN_MIKE_MS + 1000).toISOString();
    assert.equal(sweepInboundEmail(state.row as typeof seed, now), null);
    state.row!.updated_at = new Date(now - SWEEP_UNKNOWN_MIKE_MS).toISOString();
    assert.equal(sweepInboundEmail(state.row as typeof seed, now), 'missed');

    const sent: string[] = [];
    const send = async (message: { subject: string }) => {
      sent.push(message.subject);
      assert.match(message.subject, /^Missed call:/);
      return { success: true };
    };
    const first = await notifyMissedInboundCall({ ...input, who: 'missed', startedAt: '2026-10-22T14:49:00.000Z', ringSeconds: 15 }, db, { send });
    assert.equal(first.reason, 'sent');
    assert.equal(state.row?.processing_error, `${CALL_ALERT_MARKER}|${AWAIT_MIKE_MARKER}`);
    assert.equal(sweepInboundEmail(state.row as typeof seed, now), null);
    const again = await notifyMissedInboundCall({ ...input, who: 'missed', ringSeconds: 15 }, db, { send });
    assert.equal(again.reason, 'already');
    assert.equal(sent.length, OFFICE_ALERT_EMAILS.length);

    let mikeSends = 0;
    const report = await deliverMikeCallEmail(db, {
      phone: '+17603159054',
      startedAtMs: Date.parse('2026-10-22T14:49:00.000Z'),
      built: { subject: 'Mike answered: (760) 315-9054', text: 'SUMMARY:\nPump is short-cycling.' },
    }, {
      rows: [state.row as typeof seed],
      send: async () => { mikeSends += 1; return { success: true }; },
    });
    assert.equal(report.reason, 'already');
    assert.equal(mikeSends, 0);
  });

  it('leaves a shop answer silent when the leg arrives after the dial, and still catches a short one', async () => {
    const known = memoryDb({ call_sid: 'CA1', processing_error: 'leg:shop' });
    assert.equal(await noteMikeAwaitingReport(known.db, 'CA1'), 'already');
    assert.equal(known.state.row?.processing_error, 'leg:shop');

    const { db, state } = memoryDb({ call_sid: 'CA1', processing_error: null });
    assert.equal(await noteMikeAwaitingReport(db, 'CA1'), 'noted');
    assert.equal(await recordAnsweredParty(db, 'CA1', 'shop'), 'recorded');
    assert.equal(state.row?.processing_error, `${AWAIT_MIKE_MARKER}|leg:shop`);
    const baseRow = {
      processing_error: state.row?.processing_error ?? null,
      dial_status: 'completed', answered: true, duration_seconds: 95,
      updated_at: new Date(now - 11 * 60_000).toISOString(),
    };
    assert.equal(sweepInboundEmail(baseRow, now), null);
    assert.equal(sweepInboundEmail({ ...baseRow, duration_seconds: 9, updated_at: new Date(now - 3 * 60_000).toISOString() }, now), 'missed');
    assert.equal(sweepInboundEmail({ ...baseRow, duration_seconds: 9, updated_at: new Date(now - 30_000).toISOString() }, now), null);
    assert.equal(await noteMikeAwaitingReport(memoryDb(null).db, 'CA1'), 'missing');
  });

  it('keeps a known Mike call on the long wait', () => {
    const row = {
      processing_error: `${AWAIT_MIKE_MARKER}|leg:mike`, dial_status: 'completed', answered: true, duration_seconds: 40,
      updated_at: new Date(now - 11 * 60_000).toISOString(),
    };
    assert.equal(sweepInboundEmail(row, now), null);
    assert.equal(sweepInboundEmail({ ...row, updated_at: new Date(now - SWEEP_MIKE_WAIT_MS - 1000).toISOString() }, now), 'mike');
    assert.equal(sweepInboundEmail({
      processing_error: `${CALL_ALERT_MARKER}|${AWAIT_MIKE_MARKER}`,
      dial_status: 'completed', answered: true, duration_seconds: 80,
      updated_at: new Date(now - 20 * 60_000).toISOString(),
    }, now), null);
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
