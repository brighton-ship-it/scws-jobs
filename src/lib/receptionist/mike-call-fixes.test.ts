import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CALLBACK_SAY_VOICE, mikeFirstMessage } from './mike-callback.ts';
import { bookingRowForOfficeRequest, officeRequestFromTool } from './office-callback.ts';
import { scheduleUrgencyText } from './check-schedule.ts';
import {
  ADDRESS_CONFIRM_HEADING,
  ADDRESS_CONFIRM_RETRY_LIMIT,
  ADDRESS_ON_FILE_RULE,
  LONG_TURN_HEADING,
  LOST_PRESSURE_HEADING,
  MIKE_QUIET_LEAD_RULE,
  MIKE_SLOT_DAY_RULE,
  MIKE_SPANISH_RULE,
  PRESSURE_EMERGENCY_TAG,
  QUIET_LEAD_HEADING,
  SLOT_DAY_HEADING,
  SPANISH_HEADING,
  SPANISH_ONLY_LINE,
  SPANISH_SPEAKER_FLAG,
  applyMikeCallFixes,
  callerNeedsSpanish,
  checkServiceAddressConfirmation,
  isLostPressureEmergency,
  isSameAsNoWaterEmergency,
  sameAsNoWaterBookingSuffix,
  spanishSpeechResult,
  spanishToolBlock,
  withEmergencyNote,
  withSpanishSpeakerFlag,
} from './mike-call-fixes.ts';
import { isCallerUrgent } from './caller-urgency.ts';

const PROMPT = `Hey, this is Mike with Southern California Well Service. Just a heads up, this call's recorded. What's going on with your well?
Voice stays on the current assistant voice. Routing stays on the shop leg, then Mike.
MIKE_CALLBACKS_ENABLED stays off.

## NEVER GO SILENT (hard rule)
After EVERY tool result you must speak in the same turn.
`;

test('pressure completely gone, or zero/no pressure, plus today or ASAP is the same emergency as no water', () => {
  const axel = 'The pressure is completely gone. I need someone today.';
  assert.equal(isLostPressureEmergency(axel), true);
  assert.equal(isSameAsNoWaterEmergency(axel), true);
  assert.equal(isSameAsNoWaterEmergency('We have zero pressure and need help ASAP'), true);
  assert.equal(isSameAsNoWaterEmergency('There is no pressure. Can you come out today?'), true);
  assert.equal(isSameAsNoWaterEmergency('no water at the house'), true);
  assert.equal(isLostPressureEmergency('The pressure is completely gone but next month is fine'), false);
  assert.equal(isSameAsNoWaterEmergency('Pressure is a little low. Monday is fine.'), false);
  assert.equal(isLostPressureEmergency('low pressure, can you come next week'), false);
  assert.equal(isLostPressureEmergency('pressure is gone, ASAP'), true);
  assert.equal(isLostPressureEmergency('calling today... no pressure to rush, next week'), false);
  assert.equal(isLostPressureEmergency('I am calling today to check in. There is no pressure to rush, next week is fine.'), false);
  assert.equal(isCallerUrgent({
    structuredUrgency: 'normal',
    messages: [{ role: 'user', message: 'calling today... no pressure to rush, next week' }],
  }), false);

  const transcript = 'The pressure is gone, ASAP. My gate code is 1234 and the dog is friendly. '.repeat(8);
  const tagged = withEmergencyNote('pump quit', transcript);
  assert.equal(tagged, `${PRESSURE_EMERGENCY_TAG}. pump quit`);
  assert.equal(tagged.includes('gate code'), false);
  assert.equal(tagged.includes(transcript), false);

  const suffix = sameAsNoWaterBookingSuffix(axel, [
    { date: 'Sunday, November 1', time: 'between 1:00 PM and 3:00 PM' },
    { date: 'Monday, November 2', time: 'between 8:00 AM and 10:00 AM' },
  ]);
  assert.match(suffix, /same as no water/i);
  assert.match(suffix, /Sunday, November 1/);
  assert.match(suffix, /do not offer only a later weekday such as Monday/i);
  assert.match(suffix, /flagEmergency once/i);
  assert.equal(sameAsNoWaterBookingSuffix('low pressure next week'), '');
  assert.match(scheduleUrgencyText({ phone: '7605550100', notes: axel, urgency: 'normal' }), /completely gone/);
});

test('Spanish callers get one fixed line and a Spanish speaker callback', () => {
  assert.equal(callerNeedsSpanish('Do you speak Spanish?'), true);
  assert.equal(callerNeedsSpanish('¿Habla español?'), true);
  assert.equal(callerNeedsSpanish('Hola, no tengo agua en el pozo'), true);
  assert.equal(callerNeedsSpanish('The pressure is completely gone'), false);
  assert.equal(callerNeedsSpanish(''), false);
  assert.equal(callerNeedsSpanish('My name is Jose Peña'), false);
  assert.equal(callerNeedsSpanish('Hola, I need help, gracias'), false);
  assert.equal(spanishToolBlock('bookJob', 'My name is Jose Peña'), null);
  assert.equal(spanishToolBlock('lookupCustomer', 'Hola, I need help, gracias'), null);
  assert.equal(spanishToolBlock('createCallback', 'Do you speak Spanish?'), null);
  assert.equal(spanishToolBlock('bookJob', '¿Habla español?')?.message, SPANISH_ONLY_LINE);

  const speech = spanishSpeechResult();
  assert.equal(speech.sayExactly, SPANISH_ONLY_LINE);
  assert.equal(speech.message, SPANISH_ONLY_LINE);
  assert.equal(speech.spanishSpeaker, true);
  assert.match(String(speech.instruction), /no other Spanish/);
  assert.equal(String(speech.instruction).includes(SPANISH_ONLY_LINE), false);
  const withoutLine = MIKE_SPANISH_RULE.split(SPANISH_ONLY_LINE).join('');
  assert.equal(withoutLine.includes(SPANISH_ONLY_LINE), false);
  assert.doesNotMatch(withoutLine, /[¿¡ñ]/);
  assert.doesNotMatch(withoutLine, /\b(?:sí|hola|gracias|español|bueno)\b/i);

  const flagged = withSpanishSpeakerFlag({ name: 'Maria', phone: '9515550101', reason: 'Caller asked for Spanish' });
  assert.equal(String(flagged.reason).startsWith(SPANISH_SPEAKER_FLAG), true);
  assert.equal(flagged.spanishSpeaker, true);
  const request = officeRequestFromTool('createCallback', flagged, '9515550101');
  assert.equal(request.kind, 'callback');
  assert.match(request.reason, /Spanish speaker/);
  const row = bookingRowForOfficeRequest(request);
  assert.match(row.notes, /Spanish speaker/);
  assert.equal(row.service_type, 'Callback');
});

test('booking confirms street and city even for an existing customer', () => {
  assert.match(ADDRESS_ON_FILE_RULE, /even for an existing customer/i);
  assert.match(ADDRESS_ON_FILE_RULE, /Do not assume the city from the line they called/i);

  const assumedRamona = checkServiceAddressConfirmation(
    { name: 'Andrea Coffey', address: 'Ramona', city: 'Ramona', existingCustomer: true },
    [
      { role: 'bot', text: 'Welcome back, Andrea. I have you in Ramona.' },
      { role: 'user', text: 'I need someone to look at the well.' },
    ],
  );
  assert.equal(assumedRamona.ok, false);

  const callerCorrects = checkServiceAddressConfirmation(
    { name: 'Andrea Coffey', address: 'Ramona', city: 'Ramona', addressConfirmed: 'yes' },
    [
      { role: 'bot', text: 'I have you down in Ramona.' },
      { role: 'user', text: 'No, the well is on S Citrus Ave in Escondido.' },
    ],
  );
  assert.equal(callerCorrects.ok, false);
  if (!callerCorrects.ok) assert.match(String(callerCorrects.result.message), /Escondido/);

  const onFileNotEnough = checkServiceAddressConfirmation(
    { address: 'S Citrus Ave', city: 'Escondido', existingCustomer: true, addressOnFile: 'S Citrus Ave, Escondido' },
    [
      { role: 'bot', text: 'Welcome back. I have your account pulled up.' },
      { role: 'user', text: 'Yes, please come out.' },
    ],
  );
  assert.equal(onFileNotEnough.ok, false);

  const confirmed = checkServiceAddressConfirmation(
    { address: 'S Citrus Ave', city: 'Escondido', addressConfirmed: 'yes' },
    [
      { role: 'bot', text: 'Just to confirm, the well is at S Citrus Ave in Escondido?' },
      { role: 'user', text: 'Yes, that is the one.' },
    ],
  );
  assert.equal(confirmed.ok, true);

  const southSpelling = checkServiceAddressConfirmation(
    { address: 'South Citrus Avenue', city: 'Escondido' },
    [
      { role: 'bot', text: 'Just to confirm, the well is at S Citrus Ave in Escondido?' },
      { role: 'user', text: 'Yes.' },
    ],
  );
  assert.equal(southSpelling.ok, true);

  const missing = checkServiceAddressConfirmation({ city: 'Escondido' }, []);
  assert.equal(missing.ok, false);
  const unconfirmed = checkServiceAddressConfirmation({ address: 'S Citrus Ave', city: 'Escondido' }, []);
  assert.equal(unconfirmed.ok, false);

  const highway = checkServiceAddressConfirmation(
    { address: '14000 Highway 78', city: 'Ramona' },
    [
      { role: 'bot', text: 'Just to confirm, the well is at 14000 Hwy 78 in Ramona?' },
      { role: 'user', text: 'Yes.' },
    ],
  );
  assert.equal(highway.ok, true);

  const streetAbbrev = checkServiceAddressConfirmation(
    { address: '12 Main Street', city: 'Escondido' },
    [
      { role: 'bot', text: 'Just to confirm, the well is at 12 Main St in Escondido?' },
      { role: 'user', text: 'Yes, that is right.' },
    ],
  );
  assert.equal(streetAbbrev.ok, true);

  const laterTown = checkServiceAddressConfirmation(
    { address: 'S Citrus Ave', city: 'Escondido' },
    [
      { role: 'bot', text: 'Just to confirm, the well is at S Citrus Ave in Escondido?' },
      { role: 'user', text: 'Yes.' },
      { role: 'user', text: 'I called the Ramona line.' },
    ],
  );
  assert.equal(laterTown.ok, true);

  const asks = [
    { role: 'bot' as const, text: 'Just to confirm, the well is at 12 Main St in Ramona?' },
    { role: 'user' as const, text: 'What?' },
    { role: 'bot' as const, text: 'Just to confirm, the well is at 12 Main Street in Ramona?' },
    { role: 'user' as const, text: 'I called the Escondido line maybe.' },
  ];
  assert.equal(ADDRESS_CONFIRM_RETRY_LIMIT, 2);
  const giveUp = checkServiceAddressConfirmation({ address: '12 Main St', city: 'Ramona' }, asks);
  assert.equal(giveUp.ok, false);
  if (!giveUp.ok) {
    assert.equal(giveUp.result.fallback, 'createCallback');
    assert.match(String(giveUp.result.message), /Do not call book_job again/);
  }
});

test('prompt patch leaves greeting, voice, and routing alone and stays idempotent', () => {
  const once = applyMikeCallFixes(PROMPT);
  const twice = applyMikeCallFixes(once);
  assert.equal(twice, once);
  assert.match(once, new RegExp(LOST_PRESSURE_HEADING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(once, new RegExp(SPANISH_HEADING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(once, new RegExp(ADDRESS_CONFIRM_HEADING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(once, new RegExp(SLOT_DAY_HEADING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(once, new RegExp(QUIET_LEAD_HEADING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(once, new RegExp(LONG_TURN_HEADING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(MIKE_SLOT_DAY_RULE, /say label verbatim/);
  assert.match(MIKE_QUIET_LEAD_RULE, /createCallback once before you say goodbye/);
  assert.match(MIKE_QUIET_LEAD_RULE, /still goes to Damian/);
  assert.match(MIKE_QUIET_LEAD_RULE, /do not book a visit/);
  assert.equal(once.includes(SPANISH_ONLY_LINE), true);
  assert.match(once, /Hey, this is Mike with Southern California Well Service\. Just a heads up, this call's recorded\./);
  assert.match(once, /Routing stays on the shop leg, then Mike\./);
  assert.match(once, /MIKE_CALLBACKS_ENABLED stays off/);
  assert.equal(once.includes('MIKE_CALLBACKS_ENABLED=true'), false);
  assert.equal(once.indexOf("Hey, this is Mike"), once.lastIndexOf("Hey, this is Mike"));

  assert.equal(
    mikeFirstMessage(),
    "Hey, this is Mike with Southern California Well Service. Just a heads up, this call's recorded. What's going on with your well?",
  );
  assert.equal(CALLBACK_SAY_VOICE, 'Google.en-US-Chirp3-HD-Charon');

  const src = readFileSync(new URL('./mike-call-fixes.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../../app/api/receptionist/webhook/route.ts', import.meta.url), 'utf8');
  const inbound = readFileSync(new URL('../../app/api/calls/inbound/route.ts', import.meta.url), 'utf8');
  const roll = readFileSync(new URL('../../app/api/calls/webhook/route.ts', import.meta.url), 'utf8');
  assert.equal(src.includes('MIKE_CALLBACKS_ENABLED=true'), false);
  assert.equal(src.includes('firstMessage'), false);
  assert.equal(src.includes('api.vapi.ai'), false);
  assert.equal(route.includes('MIKE_CALLBACKS_ENABLED'), false);
  assert.equal(route.includes('params.notes = [params.notes, callerText]'), false);
  assert.match(route, /withEmergencyNote/);
  assert.equal(inbound.includes('mike-call-fixes'), false);
  assert.equal(roll.includes('mike-call-fixes'), false);
  assert.equal(inbound.includes('SPANISH_ONLY_LINE'), false);
});
