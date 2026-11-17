/**
 * A caller who asks for the owner or a real person.
 * The callback row is the office log. This does not dial or text.
 */

import { OWNER_CALLBACK_REASON } from './mike-call-fixes.ts';
import type { OfficeRequest } from './office-callback.ts';

const ASK_TARGET =
  'the owner|your owner|an owner|the boss|a manager|the manager|a real person|an actual person|a real human|an actual human|a human|a live person|a live human|a person|somebody|someone|brighton';

/** A request to be connected. "I am the owner" and "the owner is out of town" do not match. */
const ASK = new RegExp(
  `\\b(?:speak(?:\\s+with|\\s+to)?|talk(?:\\s+with|\\s+to)?|get in touch(?:\\s+with)?|reach|connect(?:\\s+me)?(?:\\s+(?:with|to))?|transfer(?:\\s+me)?(?:\\s+to)?|put me (?:through|on)(?:\\s+with)?|get me)\\b[^.\n]{0,50}\\b(?:${ASK_TARGET})\\b`,
  'i',
);

/** Caller lines only. Saying they are the owner is not a request to speak to one. */
export function callerAskedForOwnerOrPerson(text: string): boolean {
  return String(text || '')
    .split(/\n+/)
    .some((line) => {
      const said = line.trim();
      return Boolean(said) && ASK.test(said);
    });
}

export type OwnerCallbackLookup = 'yes' | 'no' | 'unknown';

/**
 * One callback row per call. 'done' means a row is already there.
 * 'skip' means a lookup failure already produced an attempt, so do not insert again.
 * 'insert' is the first write, including the one try allowed when lookup is down.
 */
export function ownerCallbackAction(input: {
  succeeded: boolean;
  attempted: boolean;
  lookup: OwnerCallbackLookup;
}): 'done' | 'skip' | 'insert' {
  if (input.succeeded) return 'done';
  if (input.attempted) return 'skip';
  if (input.lookup === 'yes') return 'done';
  return 'insert';
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
