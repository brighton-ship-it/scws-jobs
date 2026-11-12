import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NO_PUNCTUATION_ENDPOINT_SECONDS, VAPI_TRANSCRIPTION_ENDPOINTING_PLAN } from './vapi-assistant.ts';
import { LONG_TURN_HEADING, MIKE_LONG_TURN_RULE, applyMikeCallFixes } from './mike-call-fixes.ts';

const PROMPT = `Hey, this is Mike with Southern California Well Service. Just a heads up, this call's recorded. What's going on with your well?
## NEVER GO SILENT (hard rule)
After EVERY tool result you must speak in the same turn.
`;

test('no-punctuation endpointing is 1.0 seconds', () => {
  assert.equal(NO_PUNCTUATION_ENDPOINT_SECONDS, 1);
  assert.equal(VAPI_TRANSCRIPTION_ENDPOINTING_PLAN.onNoPunctuationSeconds, 1);
  assert.notEqual(NO_PUNCTUATION_ENDPOINT_SECONDS, 1.5);
  const src = readFileSync(new URL('./vapi-assistant.ts', import.meta.url), 'utf8');
  assert.match(src, /onNoPunctuationSeconds/);
  assert.equal(src.includes('1.5'), false);
  assert.equal(src.includes('api.vapi.ai'), false);
  assert.equal(src.includes('firstMessage'), false);
  assert.equal(src.includes('MIKE_CALLBACKS_ENABLED'), false);
  assert.equal(src.includes('Chirp3'), false);
});

test('a long voicemail-style turn gets a cut-in nudge and nothing else moves', () => {
  const next = applyMikeCallFixes(PROMPT);
  assert.match(next, new RegExp(LONG_TURN_HEADING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(MIKE_LONG_TURN_RULE, /fifteen seconds/);
  assert.match(next, /createCallback before the call ends/);
  assert.match(next, /Hey, this is Mike with Southern California Well Service/);
  assert.equal(next.includes('MIKE_CALLBACKS_ENABLED=true'), false);
});
