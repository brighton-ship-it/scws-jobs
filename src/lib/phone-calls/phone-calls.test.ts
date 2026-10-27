import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import twilio from 'twilio';
import { parseTwilio } from './auth.ts';
import { aiFallbackNumber, forwardTargets, lineFor } from './config.ts';
import { handleRecording, normalizePhone } from './handle-recording.ts';
import { buildNoteMessage } from './jobber-note.ts';
import { parseSummary, transcribe } from './process.ts';
import { buildAiHandoffTwiml, buildInboundTwiml, buildVoicemailTwiml } from './twiml.ts';

const TOKEN = 'tok';
const URL_ = 'https://scws-jobs.vercel.app/api/calls/inbound';
function req(params: Record<string, string>, sig?: string) {
  const body = new URLSearchParams(params);
  return new Request(URL_, { method: 'POST', body, headers: { 'x-twilio-signature': sig ?? '', 'x-forwarded-host': 'scws-jobs.vercel.app', 'x-forwarded-proto': 'https' } });
}

describe('phone-calls', () => {
  it('validates the Twilio signature', async () => {
    const p = { CallSid: 'CA1', From: '+17605550100' };
    const ok = await parseTwilio(req(p, twilio.getExpectedTwilioSignature(TOKEN, URL_, p)), { TWILIO_AUTH_TOKEN: TOKEN } as any);
    assert.equal(ok.valid, true);
    const bad = await parseTwilio(req(p, 'nope'), { TWILIO_AUTH_TOKEN: TOKEN } as any);
    assert.equal(bad.valid, false);
    const none = await parseTwilio(req(p), {} as any);
    assert.equal(none.valid, false);
  });
  it('twiml dials with recording and does not play a separate notice', () => {
    const x = buildInboundTwiml({ shopNumbers: ['+17604408520'], baseUrl: 'https://x.test' });
    assert.doesNotMatch(x, /<Say/);
    assert.match(x, /record="record-from-answer-dual"/);
    assert.match(x, /<Number[^>]*>\+17604408520<\/Number>/);
    assert.match(x, /recording"/);
  });
  it('normalizes phones and parses summaries defensively', () => {
    assert.equal(normalizePhone('(760) 271-2106'), '+17602712106');
    assert.equal(normalizePhone('abc'), null);
    assert.equal(parseSummary('garbage').outcome, 'other');
    assert.equal(parseSummary('{"summary":"s","outcome":"booked","needs_followup":1}').needs_followup, true);
  });
  it('transcribes via openai when no deepgram key', async () => {
    let url = '';
    const t = await transcribe(new ArrayBuffer(4), { OPENAI_API_KEY: 'k' } as any, (async (u: any) => { url = String(u); return new Response('hello world'); }) as any);
    assert.equal(t, 'hello world'); assert.match(url, /openai/);
  });
  function fakeDb() {
    const rows = new Map<string, any>();
    const q = (table: string) => ({
      select: () => ({ eq: (_c: string, v: string) => ({ maybeSingle: async () => ({ data: rows.get(v) ?? null }) }), not: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { jobber_client_id: 'JC1' } }) }) }), }),
    });
    const db: any = { rows, from: (t: string) => ({ ...q(t), upsert: async (r: any) => { rows.set(r.call_sid, { ...(rows.get(r.call_sid) ?? {}), ...r }); return {}; } }) };
    // support .select().eq().maybeSingle and ads_calls chain .select().eq().not().limit().maybeSingle
    db.from = (t: string) => ({
      select: () => ({ eq: (_c: string, v: string) => ({ maybeSingle: async () => ({ data: rows.get(v) ?? null }), not: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { jobber_client_id: 'JC1' } }) }) }) }) }),
      upsert: async (r: any) => { rows.set(r.call_sid, { ...(rows.get(r.call_sid) ?? {}), ...r }); return {}; },
    });
    return db;
  }
  it('stores transcript + summary and matches client', async () => {
    const db = fakeDb();
    const f = (async (u: any) => {
      u = String(u);
      if (u.includes('twilio.com')) return new Response(new ArrayBuffer(8));
      if (u.includes('transcriptions')) return new Response('Hi this is Ryan, my well pump is down and I have cattle, please send someone.');
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"Ryan needs pump service","outcome":"emergency","caller_name":"Ryan","needs_followup":true}' } }] }));
    }) as any;
    const r = await handleRecording({ CallSid: 'CA9', From: '+17602712106', RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE1', RecordingSid: 'RE1', RecordingDuration: '45' }, db, { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', OPENAI_API_KEY: 'k' } as any, { fetch: f, jobber: null });
    assert.equal(r.reason, 'done');
    const row = db.rows.get('CA9');
    assert.equal(row.processing_status, 'done'); assert.equal(row.outcome, 'emergency'); assert.equal(row.jobber_client_id, 'JC1');
    assert.equal((await handleRecording({ CallSid: 'CA9', RecordingUrl: 'x' }, db)).reason, 'already processed');
  });
  it('skips very short recordings and rejects non-twilio hosts', async () => {
    const db = fakeDb();
    assert.equal((await handleRecording({ CallSid: 'CA2', RecordingUrl: 'https://api.twilio.com/x', RecordingDuration: '3' }, db)).reason, 'too short');
    const r = await handleRecording({ CallSid: 'CA3', RecordingUrl: 'https://evil.test/x', RecordingDuration: '30' }, db, { TWILIO_ACCOUNT_SID: 'a', TWILIO_AUTH_TOKEN: 'b' } as any);
    assert.equal(r.ok, false);
    assert.equal(db.rows.get('CA3').processing_status, 'failed');
  });
  it('does not drop an alert claim already stored on the call', async () => {
    const db = fakeDb();
    db.rows.set('CA9', { call_sid: 'CA9', processing_error: 'call-alert-sent|leg:mike', caller_number: '+17602712106' });
    const f = (async (u: any) => {
      u = String(u);
      if (u.includes('twilio.com')) return new Response(new ArrayBuffer(8));
      if (u.includes('transcriptions')) return new Response('Hi this is Ryan, my well pump is down and I have cattle, please send someone.');
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"Ryan needs pump service","outcome":"emergency","caller_name":"Ryan","needs_followup":true}' } }] }));
    }) as any;
    const r = await handleRecording({ CallSid: 'CA9', From: '+17602712106', RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE1', RecordingSid: 'RE1', RecordingDuration: '45' }, db, { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', OPENAI_API_KEY: 'k' } as any, { fetch: f, jobber: null });
    assert.equal(r.reason, 'done');
    assert.equal(db.rows.get('CA9').processing_error, 'call-alert-sent|leg:mike');
  });
});

describe('note, caller id, and ported lines', () => {
  it('note message + callerId + jobber hook', async () => {
    const m = buildNoteMessage({ startedAt: '2026-10-12T16:00:00Z', source: 'google_ads', summary: 'S', outcome: 'quote_request', needsFollowup: true, transcript: 'hi', durationSeconds: 40 });
    assert.match(m, /Oct 12, 9:00 AM PT \(40s\) · google_ads/); assert.match(m, /NEEDS FOLLOW-UP/);
    assert.match(buildInboundTwiml({ shopNumbers: ['+1'], baseUrl: 'https://x', callerId: '+18773863995' }), /callerId="\+18773863995"/);
    assert.doesNotMatch(buildInboundTwiml({ shopNumbers: ['+1'], baseUrl: 'https://x' }), /callerId/);
  });
  it('ported main/ransom lines', () => {
    assert.equal(lineFor('+17604408520')?.key, 'main');
    assert.equal(lineFor('+18773863995', 'ransom')?.source, 'ransom_line');
    assert.equal(lineFor('+18773863995', 'x'), null);
    assert.deepEqual(forwardTargets(lineFor('+17607895955')!, { PHONE_CALL_FORWARD_RANSOM: '+17605550100, bad' } as any), ['+17605550100']);
    assert.match(buildInboundTwiml({ shopNumbers: ['+1'], baseUrl: 'https://x', actionQuery: '?line=main' }), /status\?line=main"/);
    assert.match(buildVoicemailTwiml('https://x'), /<Record [^>]*inbound\/recording/);
  });
});

describe('AI receptionist no-answer handoff', () => {
  it('is off unless ?ai=1 or env', () => {
    assert.equal(aiFallbackNumber(new URLSearchParams(''), {} as any), null);
    assert.equal(aiFallbackNumber(new URLSearchParams('ai=1'), {} as any), '+17604915348');
    assert.equal(aiFallbackNumber(new URLSearchParams(''), { PHONE_CALL_AI_FALLBACK: '1', PHONE_CALL_AI_NUMBER: '+15550001111' } as any), '+15550001111');
  });
  it('dials the AI number with no action (no loop)', () => {
    const x = buildAiHandoffTwiml('+17604915348', 'https://x.test/');
    assert.match(x, /<Number[^>]*>\+17604915348<\/Number>/);
    assert.doesNotMatch(x, /<Dial[^>]* action=/);
    assert.doesNotMatch(x, /machineDetection/);
  });
});

describe('recording notice', () => {
  it('says the notice before dialing', () => {
    const x = buildInboundTwiml({ shopNumbers: ['+17602763468'], baseUrl: 'https://x.test', notice: 'This call may be recorded for quality and training purposes.' });
    assert.ok(x.indexOf('<Say') > -1 && x.indexOf('<Say') < x.indexOf('<Dial'));
    assert.match(x, /<Say voice="Polly\.Joanna-Neural">/);
  });
});
