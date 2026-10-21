import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestResolvesCallback } from '../ads/callbacks.ts';
import { loadCallbackSnapshot, runMikeCallbackPass } from './mike-callback-run.ts';
import {
  AUTO_FLAG_BOOKING_PREFIX,
  AUTO_FLAG_EMAIL_LINE,
  AUTO_FLAG_NOTE,
  buildMissedServiceFlag,
  isServiceIntent,
  missedServiceFlagOperations,
  needsCallbackFlag,
  toolOutcomes,
} from './missed-service-flag.ts';

const no = { isTestCall: false, callbackAttempt: false };

function tool(name: string, result: unknown) {
  return [
    { role: 'tool_calls', toolCalls: [{ id: 't1', type: 'function', function: { name, arguments: '{}' } }] },
    { role: 'tool_call_result', name, toolCallId: 't1', result: JSON.stringify(result) },
  ];
}

test('520-388-0897 New pump hung up at 26s with no tools', () => {
  const flag = buildMissedServiceFlag({
    messages: [
      { role: 'bot', message: "What's going on with your well?" },
      { role: 'user', message: 'I need a new pump.' },
    ],
    serviceNeeded: 'New pump',
    summary: 'Caller needs a new pump and hung up.',
    transcript: 'User: I need a new pump.',
    isTestCall: false,
    callbackAttempt: false,
    vapiCallId: 'call-520-388-0897',
    phone: '5203880897',
  });
  assert.equal(flag.flag, true);
  assert.equal(flag.notes, AUTO_FLAG_NOTE);
  assert.equal(flag.needsCallback, true);
  assert.equal(flag.serviceType, 'Needs callback: New pump');
  assert.equal(flag.bookingNotesPrefix, AUTO_FLAG_BOOKING_PREFIX);
  assert.equal(flag.emailLine, AUTO_FLAG_EMAIL_LINE);
  assert.equal(toolOutcomes([]).booked, false);
});

test('Hovik 10/19 pump leak with only lookupCustomer', () => {
  const messages = tool('lookupCustomer', { found: true, customerName: 'Hovik', city: 'Ramona' });
  const flag = needsCallbackFlag(
    toolOutcomes(messages),
    isServiceIntent({ transcript: 'The pump is leaking.', summary: 'Pump leak.' }),
    no,
  );
  assert.equal(flag, true);
  assert.equal(toolOutcomes(messages).booked, false);
  assert.equal(toolOutcomes(messages).callbackLogged, false);
});

test('Edward 10/21 createCallback ok is not flagged', () => {
  const messages = tool('createCallback', { success: true, message: 'office will follow up' });
  const flag = needsCallbackFlag(
    toolOutcomes(messages),
    isServiceIntent({ serviceNeeded: 'Squeaking pump', transcript: 'The pump is squeaking.' }),
    no,
  );
  assert.equal(flag, false);
  assert.equal(toolOutcomes(messages).callbackLogged, true);
});

test('Lorena 10/21 invoice copy is not a service intent', () => {
  const messages = tool('createCallback', { ok: true });
  assert.equal(isServiceIntent({
    serviceNeeded: 'Invoice copy',
    summary: 'Caller wants a copy of an invoice.',
    transcript: 'User: Can I get a copy of my invoice?',
  }), false);
  assert.equal(needsCallbackFlag(toolOutcomes(messages), false, no), false);
});

test('760-459-2411 robocall is not flagged', () => {
  assert.equal(isServiceIntent({
    serviceNeeded: 'Robocall',
    transcript: 'This is an automated robocall about your car warranty.',
  }), false);
  assert.equal(needsCallbackFlag(toolOutcomes([]), false, no), false);
});

test('916-804-5888 empty 13s hang-up has no service intent', () => {
  assert.equal(isServiceIntent({ serviceNeeded: '', summary: '', transcript: '' }), false);
  assert.equal(isServiceIntent({ transcript: 'No transcript available' }), false);
  const flag = buildMissedServiceFlag({
    messages: [],
    serviceNeeded: '',
    summary: '',
    transcript: '',
    isTestCall: false,
    callbackAttempt: false,
    vapiCallId: 'call-916',
    phone: '9168045888',
  });
  assert.equal(flag.flag, false);
});

test('the test line and a callback attempt are not flagged', () => {
  const intent = isServiceIntent({ serviceNeeded: 'New pump' });
  assert.equal(intent, true);
  assert.equal(needsCallbackFlag(toolOutcomes([]), intent, { isTestCall: true, callbackAttempt: false }), false);
  assert.equal(needsCallbackFlag(toolOutcomes([]), intent, { isTestCall: false, callbackAttempt: true }), false);
  const booked = tool('book_job', { booked: true });
  assert.equal(needsCallbackFlag(toolOutcomes(booked), intent, no), false);
  const emergency = tool('flagEmergency', { success: true });
  assert.equal(needsCallbackFlag(toolOutcomes(emergency), intent, no), false);
});

function snapshotDb(tables: Record<string, any[]>) {
  const selects: Array<{ table: string; columns: string }> = [];
  const from = (table: string) => ({
    select(columns: string) {
      selects.push({ table, columns });
      const promise = Promise.resolve({ data: tables[table] ?? [], error: null });
      const api: any = {
        then: (ok: any, err: any) => promise.then(ok, err),
        catch: (err: any) => promise.catch(err),
        finally: (fn: any) => promise.finally(fn),
      };
      for (const method of ['gte', 'neq', 'in', 'limit', 'eq', 'order']) api[method] = () => api;
      return api;
    },
  });
  return { from, selects };
}

test('the callback cron does not pick up an auto-flag row when callbacks are turned on', async () => {
  const flaggedAt = '2026-10-21T16:30:00.000Z';
  const db = snapshotDb({
    booking_requests: [{
      phone: '5203880897',
      created_at: flaggedAt,
      vapi_call_id: 'call-520-388-0897',
      source: 'phone',
      service_type: 'Needs callback: New pump',
      notes: `${AUTO_FLAG_BOOKING_PREFIX}\nNew pump`,
    }],
    receptionist_calls: [{
      phone: '5203880897',
      vapi_call_id: 'call-520-388-0897',
      notes: AUTO_FLAG_NOTE,
      needs_callback: true,
      status: 'pending',
    }],
    phone_call_log: [],
    inbound_call_recordings: [],
    mike_callback_attempts: [],
    jobber_jobs: [],
    jobber_quotes: [],
    jobber_invoices: [],
    collection_holds: [],
    sms_do_not_text: [],
    jobber_clients: [],
  });
  const env = { MIKE_CALLBACKS_ENABLED: 'true', NEXT_PUBLIC_APP_URL: 'https://scws.example' } as unknown as NodeJS.ProcessEnv;
  const now = new Date('2026-10-21T18:00:00.000Z');
  const snapshot = await loadCallbackSnapshot(db, env, now);
  assert.equal(snapshot.calls.length, 0);
  assert.equal(requestResolvesCallback('phone'), false);
  assert.equal(db.selects.some((row) => row.table === 'receptionist_calls'), false);
  const requestSelect = db.selects.find((row) => row.table === 'booking_requests');
  assert.equal(requestSelect?.columns, 'phone, created_at, vapi_call_id, source');
  assert.equal(/notes|service_type|needs_callback/.test(requestSelect?.columns || ''), false);

  let dials = 0;
  const summary = await runMikeCallbackPass(db, env, now, async () => {
    dials += 1;
    throw new Error('dial attempted');
  });
  assert.equal(summary.mode, 'full');
  assert.equal(summary.dialed, 0);
  assert.equal(dials, 0);
  assert.deepEqual(
    missedServiceFlagOperations(true).filter((op) => /sms|dial|alert|twilio/i.test(op)),
    [],
  );
});
