import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bookingRowForOfficeRequest } from './office-callback.ts';
import { OWNER_CALLBACK_REASON } from './mike-call-fixes.ts';
import { buildMissedServiceFlag } from './missed-service-flag.ts';
import { callerAskedForOwnerOrPerson, ownerPersonCallback } from './owner-request.ts';

const MAGGIE = 'Hi. Maggie, this White.\nI would like to get in touch with the owner.';

test('Maggie asking for the owner logs a callback from caller ID, and a property owner does not', () => {
  assert.equal(callerAskedForOwnerOrPerson(MAGGIE), true);
  assert.equal(callerAskedForOwnerOrPerson('Can I please speak with an actual human individual?'), true);
  assert.equal(callerAskedForOwnerOrPerson("I'm the owner of the property. The pump is out."), false);
  assert.equal(callerAskedForOwnerOrPerson('I need someone to look at the well.'), false);

  const logged = ownerPersonCallback({
    callerText: MAGGIE,
    name: 'Maggie White',
    phone: '16462050212',
    callbackLogged: true,
  });
  assert.equal(logged, null);

  const row = ownerPersonCallback({
    callerText: MAGGIE,
    name: 'Maggie White',
    phone: '16462050212',
    callbackLogged: false,
  });
  assert.ok(row);
  assert.equal(row.kind, 'callback');
  assert.equal(row.name, 'Maggie White');
  assert.equal(row.phone, '16462050212');
  assert.equal(row.reason, OWNER_CALLBACK_REASON);
  assert.equal(row.reason, 'asked for owner/person');

  const saved = bookingRowForOfficeRequest(row, { vapiCallId: 'call-maggie', toolCallId: 'owner-request-end' });
  assert.equal(saved.service_type, 'Callback');
  assert.equal(saved.customer_name, 'Maggie White');
  assert.equal(saved.phone, '16462050212');
  assert.match(saved.notes, /asked for owner\/person/);
  assert.equal(saved.vapi_call_id, 'call-maggie');

  const noPhone = ownerPersonCallback({ callerText: MAGGIE, name: 'Maggie White', phone: '', callbackLogged: false });
  assert.equal(noPhone, null);
});

test('an owner request is not also auto-flagged, and the webhook does not dial', () => {
  const flag = buildMissedServiceFlag({
    messages: [{ role: 'user', message: 'I would like to get in touch with the owner.' }],
    summary: 'Maggie asked for the owner and hung up.',
    transcript: 'User: I would like to get in touch with the owner.',
    isTestCall: false,
    callbackAttempt: false,
    callbackAlreadyLogged: true,
    vapiCallId: 'call-maggie',
    phone: '16462050212',
  });
  assert.equal(flag.flag, false);

  const route = readFileSync(new URL('../../app/api/receptionist/webhook/route.ts', import.meta.url), 'utf8');
  const src = readFileSync(new URL('./owner-request.ts', import.meta.url), 'utf8');
  assert.match(route, /logOwnerPersonCallback/);
  assert.match(route, /toolCallId: 'owner-request'/);
  assert.match(route, /toolCallId: 'owner-request-end'/);
  assert.equal(route.includes('MIKE_CALLBACKS_ENABLED'), false);
  assert.equal(src.includes('MIKE_CALLBACKS_ENABLED'), false);
  assert.equal(route.includes('placeTwilioCallback'), false);
  assert.equal(src.includes('placeTwilio'), false);
  assert.equal(src.includes('sendSms'), false);
});
