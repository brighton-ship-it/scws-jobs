import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBookingConsent, consentTurnsFromVapiBody, isBareFiller, slotLabel, type ConsentTurn } from './booking-consent.ts';

const slot = '2026-10-21T15:00:00.000Z';
const offer: ConsentTurn = { role: 'bot', text: 'The earliest I can get someone out is Wednesday between 8 and 10. Does that work for you?' };
const hold: ConsentTurn = { role: 'bot', text: 'Great, should I lock in Wednesday 8 to 10 for you?' };
const u = (text: string): ConsentTurn => ({ role: 'user', text });

test('rejects missing callerYes', () => {
  const r = checkBookingConsent({ startAt: slot }, []);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, 'missing_caller_yes');
    assert.equal((r.result as any).booked, false);
    assert.match(String((r.result as any).message), /Want me to hold Wednesday at 8 AM for you\?/);
  }
});

test('rejects questions, sooner asks, maybes and deferrals', () => {
  for (const w of [
    'Is there any way someone could come sooner?',
    'Could someone come out today',
    'Maybe, I guess',
    'I think that could work but let me check with my wife',
    'Hold on, I need to check with my husband',
    "Don't book it yet",
    'No',
    'Not yet',
    'Hmm',
    'Can I call you back',
  ]) {
    const r = checkBookingConsent({ startAt: slot, callerYes: w }, []);
    assert.equal(r.ok, false, w);
  }
});

test('rejects words that are not a yes', () => {
  const r = checkBookingConsent({ startAt: slot, callerYes: 'Dana Whitaker, 1520 Main Street' }, []);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'not_a_yes');
});

test('bare filler needs a hold/lock-in confirmation first', () => {
  assert.equal(isBareFiller('Yeah.'), true);
  assert.equal(isBareFiller('Yeah yeah okay look'), true);
  assert.equal(isBareFiller('Yes, book it'), false);
  const noTranscript = checkBookingConsent({ startAt: slot, callerYes: 'Yeah.' }, []);
  assert.equal(noTranscript.ok, false);
  const afterOffer = checkBookingConsent({ startAt: slot, callerYes: 'Yeah.' }, [offer, u('Yeah.')]);
  assert.equal(afterOffer.ok, false);
  if (!afterOffer.ok) assert.equal(afterOffer.code, 'unconfirmed_filler');
  const afterHold = checkBookingConsent({ startAt: slot, callerYes: 'Yeah.' }, [offer, u('Yeah.'), hold, u('Yeah.')]);
  assert.equal(afterHold.ok, true);
});

test('accepts a clear yes', () => {
  for (const w of ['Yes', 'Yes, book it', 'Yeah, that works for me', 'Okay, put me down for Wednesday', 'Sounds good, go ahead', 'Yes please']) {
    assert.equal(checkBookingConsent({ startAt: slot, callerYes: w }, []).ok, true, w);
  }
  const live = checkBookingConsent({ startAt: slot, callerYes: 'Yes, that works. Book it.' }, [offer, u('Yes, that works. Book it.')]);
  assert.equal(live.ok, true);
  const noProblem = checkBookingConsent({ startAt: slot, callerYes: 'Yes, no problem, book it' }, [offer, u('Yes, no problem, book it')]);
  assert.equal(noProblem.ok, true);
});

test('transcript wins: model cannot invent a yes the caller did not say', () => {
  const sooner = checkBookingConsent(
    { startAt: slot, callerYes: 'Yes, book it' },
    [offer, u('Oh, is there any way someone could come sooner? The animals need water.')],
  );
  assert.equal(sooner.ok, false);
  if (!sooner.ok) assert.equal(sooner.code, 'latest_words_not_yes');
  const mismatch = checkBookingConsent({ startAt: slot, callerYes: 'Yes, put me down for Wednesday' }, [offer, u('Okay sure that works')]);
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.code, 'not_in_transcript');
  const spouse = checkBookingConsent({ startAt: slot, callerYes: 'Okay' }, [offer, u('Okay. But let me check with my husband first.')]);
  assert.equal(spouse.ok, false);
});

test('reads Vapi artifact messages', () => {
  const turns = consentTurnsFromVapiBody({
    message: {
      type: 'tool-calls',
      artifact: {
        messages: [
          { role: 'system', message: 'sys' },
          { role: 'bot', message: 'Does that work?' },
          { role: 'user', message: 'Yes, book it.' },
          { role: 'tool_calls', toolCalls: [] },
        ],
      },
    },
  });
  assert.deepEqual(turns, [{ role: 'bot', text: 'Does that work?' }, { role: 'user', text: 'Yes, book it.' }]);
  assert.equal(slotLabel(slot), 'Wednesday at 8 AM');
});
