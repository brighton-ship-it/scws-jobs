/**
 * A caller who asks for the owner or a real person.
 * The callback row is the office log. This does not dial or text.
 */

import { OWNER_CALLBACK_REASON } from './mike-call-fixes.ts';
import type { OfficeRequest } from './office-callback.ts';

const PERSON =
  'the owner|your owner|an owner|the boss|a manager|the manager|a real person|an actual person|a real human|an actual human|a human|a live person|a live human|somebody real|someone real';

const ASK = new RegExp(
  `\\b(?:speak(?:\\s+with|\\s+to)?|talk(?:\\s+with|\\s+to)?|get in touch(?:\\s+with)?|reach|connect(?:\\s+me)?(?:\\s+(?:with|to))?|transfer(?:\\s+me)?(?:\\s+to)?|put me (?:through|on)(?:\\s+with)?|ask for|get me|let me talk to)\\b[^.\n]{0,60}\\b(?:${PERSON})\\b`,
  'i',
);

const WANT = new RegExp(
  `\\b(?:want|need|like|hoping|trying)\\b[^.\n]{0,50}\\b(?:the owner|your owner|an owner|the boss|a manager|the manager|a real person|an actual person|a real human|an actual human|a live person)\\b`,
  'i',
);

/** Caller lines only. "I am the owner" is not a request to speak to one. */
export function callerAskedForOwnerOrPerson(text: string): boolean {
  return String(text || '')
    .split(/\n+/)
    .some((line) => {
      const said = line.trim();
      return Boolean(said) && (ASK.test(said) || WANT.test(said));
    });
}

/**
 * The callback to save when the caller asked for the owner or a person and none
 * was logged yet. Null when one is already logged, the phone is missing, or they did not ask.
 */
export function ownerPersonCallback(input: {
  callerText: string;
  name?: string | null;
  phone?: string | null;
  callbackLogged: boolean;
}): OfficeRequest | null {
  if (input.callbackLogged) return null;
  if (!callerAskedForOwnerOrPerson(input.callerText)) return null;
  const phone = String(input.phone || '').trim();
  if (!phone) return null;
  return {
    kind: 'callback',
    name: String(input.name || '').trim(),
    phone,
    email: '',
    address: '',
    city: '',
    reason: OWNER_CALLBACK_REASON,
    repeatCaller: null,
  };
}
