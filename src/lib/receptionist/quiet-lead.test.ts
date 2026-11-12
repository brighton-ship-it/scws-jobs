import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractCallOutcome } from './call-email.ts';
import {
  applyQuietLeadOutcome,
  callerGaveLead,
  quietLeadBeforeHangup,
} from './quiet-lead.ts';

const moore = [
  'No. I need a well.',
  'Hello?',
  'Oh, this is more.',
  'A pineal tail.',
  'I am new. Town.',
].join('\n');

const tim = "Oh, hey. Uh, Mike. This is Tim. The pump the motor went out and it's 650 feet deep. My number is 7 1 4 9 1 7 7 0 0 0.";

test('Moore is a drilling lead and Tim is a lead that is not drilling', () => {
  const mooreLead = callerGaveLead(moore);
  assert.equal(mooreLead.lead, true);
  assert.equal(mooreLead.drilling, true);
  const timLead = callerGaveLead(tim);
  assert.equal(timLead.lead, true);
  assert.equal(timLead.drilling, false);
  assert.equal(callerGaveLead('Hello?').lead, false);
  assert.equal(callerGaveLead('I need a well pump').drilling, false);
  assert.equal(callerGaveLead('').lead, false);
  assert.equal(callerGaveLead("I'm calling from Ferguson about a delivery").lead, false);
  assert.equal(callerGaveLead('Well, I was just calling to check on my invoice').lead, false);
  assert.equal(callerGaveLead('Just checking on the status of my appointment').lead, false);
  assert.equal(callerGaveLead('The well is dry and we have no water').lead, true);
});

test('a quiet drilling lead becomes a Damian callback, and a saved callback or booking does not', () => {
  const quiet = quietLeadBeforeHangup({ callerText: moore, messages: [] });
  assert.ok(quiet);
  assert.equal(quiet?.drilling, true);
  assert.match(quiet?.note || '', /Damian/);
  assert.match(quiet?.note || '', /New well \/ drilling/);

  const outcome = extractCallOutcome([], { name: 'Moore', phone: '7606461995', issue: 'well drilling' });
  applyQuietLeadOutcome(outcome, quiet);
  assert.equal(outcome.kind, 'callback');
  assert.equal(outcome.callback, true);
  assert.match(outcome.issue, /Damian/);
  assert.match(outcome.issue, /well drilling/);

  const saved = quietLeadBeforeHangup({
    callerText: moore,
    messages: [{ role: 'tool_call_result', name: 'createCallback', result: JSON.stringify({ success: true }) }],
  });
  assert.equal(saved, null);

  const booked = extractCallOutcome([], { issue: 'pump' });
  booked.booked = true;
  booked.kind = 'booked';
  applyQuietLeadOutcome(booked, { drilling: false, note: 'Callback before hangup.' });
  assert.equal(booked.kind, 'booked');
  assert.equal(booked.callback, false);
});

test('the hangup path saves the lead and leaves the callback dialer off', () => {
  const route = readFileSync(new URL('../../app/api/receptionist/webhook/route.ts', import.meta.url), 'utf8');
  assert.match(route, /quietLeadBeforeHangup/);
  assert.match(route, /applyQuietLeadOutcome/);
  assert.equal(route.includes('MIKE_CALLBACKS_ENABLED'), false);
  const src = readFileSync(new URL('./quiet-lead.ts', import.meta.url), 'utf8');
  assert.equal(src.includes('MIKE_CALLBACKS_ENABLED=true'), false);
  assert.equal(src.includes('api.vapi.ai'), false);
  assert.match(src, /Damian/);
});
