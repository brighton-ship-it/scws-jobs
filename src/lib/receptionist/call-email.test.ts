import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCallEmail, extractCallOutcome, jobberJobUrl, shortWindow } from './call-email.ts';
import { FALLBACK_MARKER, isFallbackCandidate } from './alert-fallback.ts';
import { resolveOfficeToolBatch, type OfficeRequestDeps } from './office-callback.ts';

const JOB_GID = Buffer.from('gid://Jobber/Job/159691229').toString('base64');
const bookResult = {
  booked: true,
  weekendEmergency: false,
  visit: {
    id: 'v', jobId: JOB_GID, date: 'Thursday, October 15', time: 'between 10:00 AM and 12:00 PM',
    technicians: ['Brian Eads'],
  },
  assignedTechName: 'Brian Eads',
};

function calls(...list: Array<[string, string, Record<string, unknown>, unknown]>) {
  const messages: any[] = [];
  for (const [id, name, args, result] of list) {
    messages.push({ role: 'tool_calls', toolCalls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    messages.push({ role: 'tool_call_result', name, toolCallId: id, result: JSON.stringify(result) });
  }
  return messages;
}

const flag = ['c1', 'flagEmergency', { phone: '+17605550195', callerName: 'Zztest Weekendb', description: 'No water, pump quit', address: '2 Test Road', city: 'Ramona' }, { success: true }] as const;
const book = ['c2', 'book_job', { phone: '+17605550195', callerName: 'Zztest Weekendb', address: '2 Test Road', city: 'Ramona' }, bookResult] as const;

describe('one email per call: outcome and subject', () => {
  it('emergency + booked is one email with booked window and Jobber link', () => {
    const outcome = extractCallOutcome(calls([...flag], [...book]));
    assert.equal(outcome.kind, 'booked');
    assert.equal(outcome.emergency, true);
    const mail = buildCallEmail({ outcome, summary: 'No water.', transcript: 'AI: hi' });
    assert.match(mail.subject, /^🚨 Mike EMERGENCY \(booked Thursday, October 15 10 AM-12 PM\): Zztest Weekendb$/);
    assert.match(mail.text, /Jobber: https:\/\/secure\.getjobber\.com\/jobs\/159691229/);
    assert.match(mail.text, /Caller: Zztest Weekendb/);
    assert.match(mail.text, /Number: \(760\) 555-0195/);
    assert.match(mail.text, /Address: 2 Test Road, Ramona/);
    assert.match(mail.text, /Issue: No water, pump quit/);
    assert.match(mail.text, /Booked a \$200 service call/);
  });

  it('booked only', () => {
    const outcome = extractCallOutcome(calls([...book]));
    const mail = buildCallEmail({ outcome });
    assert.equal(mail.subject, '✅ Mike BOOKED: Zztest Weekendb Thursday, October 15 10 AM-12 PM');
  });

  it('emergency only', () => {
    const outcome = extractCallOutcome(calls([...flag]));
    assert.equal(outcome.kind, 'emergency');
    assert.equal(buildCallEmail({ outcome }).subject, '🚨 Mike EMERGENCY: Zztest Weekendb');
    assert.match(buildCallEmail({ outcome }).text, /No visit was booked/);
  });

  it('callback only, and createCallback with isEmergency counts as emergency', () => {
    const cb = ['c3', 'createCallback', { phone: '+17605550198', callerName: 'Ann Lee', reason: 'Billing question' }, { success: true }] as const;
    const outcome = extractCallOutcome(calls([...cb]));
    assert.equal(outcome.kind, 'callback');
    assert.equal(buildCallEmail({ outcome }).subject, '📞 Mike callback: Ann Lee');
    const em = extractCallOutcome(calls(['c4', 'createCallback', { ...cb[2], isEmergency: true }, { success: true }]));
    assert.equal(em.kind, 'emergency');
  });

  it('weekend emergency result with no flag tool still counts as emergency', () => {
    const outcome = extractCallOutcome(calls(['c5', 'book_job', { callerName: 'Bo', phone: '7605550101' }, { booked: false, weekendEmergency: true }]));
    assert.equal(outcome.kind, 'emergency');
  });

  it('failed tools and failed booking do not claim an outcome', () => {
    const outcome = extractCallOutcome(calls(
      ['c6', 'flagEmergency', { callerName: 'X' }, { success: false, message: 'could not' }],
      ['c7', 'book_job', { callerName: 'X' }, { booked: false, lookupStatus: 'error' }],
    ), { name: 'X' });
    assert.equal(outcome.kind, 'none');
    assert.equal(buildCallEmail({ outcome, fallbackName: 'X' }).subject, '📞 Mike call: X');
  });

  it('wrapped vapi results ({ result: {...} }) and missing messages are tolerated', () => {
    const wrapped = extractCallOutcome(calls(['c8', 'book_job', { callerName: 'Z' }, { result: bookResult }]));
    assert.equal(wrapped.booked, true);
    assert.equal(extractCallOutcome(undefined).kind, 'none');
  });

  it('helpers', () => {
    assert.equal(jobberJobUrl(JOB_GID), 'https://secure.getjobber.com/jobs/159691229');
    assert.equal(jobberJobUrl(''), '');
    assert.equal(shortWindow('Friday, October 16', 'between 11:00 AM and 1:00 PM'), 'Friday, October 16 11 AM-1 PM');
  });
});

describe('mid-call tools never email', () => {
  it('flag + callback in one turn: one row, sendAlert is the deferred no-op in the route', async () => {
    const sent: unknown[] = [];
    const deps: OfficeRequestDeps = {
      insertBooking: async () => ({ id: 'row-1' }),
      sendAlert: async () => ({ success: true }), // same as the route: deferred, nothing is sent
    };
    const out = await resolveOfficeToolBatch(
      [
        { id: 'a', name: 'flagEmergency', params: { callerName: 'Q', phone: '7605550100', description: 'no water' } },
        { id: 'b', name: 'createCallback', params: { callerName: 'Q', phone: '7605550100', message: 'call back' } },
      ],
      { vapiCallId: 'call-1', deps },
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].body.result.success, true);
    assert.equal(sent.length, 0);
  });
});

describe('alert fallback when end-of-call never arrives', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const row = (over = {}) => ({ service_type: 'Emergency', notes: 'x', vapi_call_id: 'c', created_at: '2026-10-10T11:40:00Z', ...over });
  it('pages only for old enough, unsent emergency/callback rows with a call id', () => {
    assert.equal(isFallbackCandidate(row(), now), true);
    assert.equal(isFallbackCandidate(row({ created_at: '2026-10-10T11:55:00Z' }), now), false);
    assert.equal(isFallbackCandidate(row({ created_at: '2026-10-10T07:00:00Z' }), now), false);
    assert.equal(isFallbackCandidate(row({ notes: `x\n${FALLBACK_MARKER}` }), now), false);
    assert.equal(isFallbackCandidate(row({ vapi_call_id: null }), now), false);
    assert.equal(isFallbackCandidate(row({ service_type: 'Phone Inquiry' }), now), false);
  });
});
