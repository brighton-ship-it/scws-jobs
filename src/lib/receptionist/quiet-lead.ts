/**
 * A caller who has given a name, a need, or a number must not be hung up on
 * without createCallback. Moore (Nov 9 2026) wanted a new well, the town was
 * garbled, and Mike said goodbye with no callback. Drilling still goes to
 * Damian through that same callback. This does not dial anyone and does not
 * read MIKE_CALLBACKS_ENABLED.
 */

import { toolOutcomes } from './missed-service-flag.ts';

const NAME_STOP = new Set([
  'a', 'an', 'the', 'about', 'for', 'my', 'not', 'just', 'going', 'still', 'ok', 'okay', 'here', 'fine',
  'calling', 'checking', 'wondering',
]);

const DRILLING = /\b(?:new well|need a well(?!\s+pump)|needs a well(?!\s+pump)|drill(?:ing)?(?:\s+a)?\s+well|well drilled|well drilling)\b/i;
const NEED = /\b(?:no water|pump|pressure|leak|tank|motor|(?:my|the|our)\s+well|drill\w*|quote|estimate|inspection|certification|install)\b/i;

export type QuietLead = { note: string; drilling: boolean };

function hasStatedName(text: string): boolean {
  const re = /\b(?:my name is|this is|i am|i'm|it is|it's)\s+([a-z]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (!NAME_STOP.has(match[1].toLowerCase())) return true;
  }
  return false;
}

function hasSpokenPhone(text: string): boolean {
  const groups = text.match(/\d+/g) || [];
  if (groups.some((group) => group.length >= 10)) return true;
  if (groups.length >= 10 && groups.join('').length >= 10 && groups.every((group) => group.length <= 4)) return true;
  return /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(text);
}

/** Name, need, or a number the caller said. Caller ID alone is not a lead. */
export function callerGaveLead(text: string): { lead: boolean; drilling: boolean } {
  const raw = String(text || '').trim();
  if (!raw) return { lead: false, drilling: false };
  const drilling = DRILLING.test(raw);
  const lead = drilling || NEED.test(raw) || hasStatedName(raw) || hasSpokenPhone(raw);
  return { lead, drilling };
}

export function quietLeadNote(drilling: boolean): string {
  if (drilling) {
    return 'New well / drilling (Damian). Caller went quiet or the call ended before a callback was saved.';
  }
  return 'Callback before hangup. The caller gave a name, a need, or a number and the call ended with no callback.';
}

/**
 * A lead with no accepted booking, callback, or emergency flag.
 * Null when Mike already saved one, or the caller never gave a lead.
 */
export function quietLeadBeforeHangup(input: {
  callerText?: string | null;
  messages?: any[] | null;
}): QuietLead | null {
  const gave = callerGaveLead(input.callerText || '');
  if (!gave.lead) return null;
  const tools = toolOutcomes(input.messages || []);
  if (tools.booked || tools.callbackLogged || tools.emergencyFlagged) return null;
  return { drilling: gave.drilling, note: quietLeadNote(gave.drilling) };
}

export function applyQuietLeadOutcome<T extends {
  booked: boolean;
  callback: boolean;
  emergency: boolean;
  kind: string;
  issue: string;
}>(outcome: T, quiet: QuietLead | null): T {
  if (!quiet || outcome.booked || outcome.callback || outcome.emergency) return outcome;
  outcome.callback = true;
  outcome.kind = 'callback';
  outcome.issue = [quiet.note, outcome.issue].filter(Boolean).join(' ');
  return outcome;
}
