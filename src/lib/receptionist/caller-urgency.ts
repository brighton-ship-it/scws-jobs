/**
 * Urgency keywords are matched against the caller's lines only.
 * Sarah's own questions ("Is this an emergency? Do you have no water?")
 * must not mark the call urgent.
 */

const URGENT_PATTERN = /urgent|emergency|no water|no pressure|flooding/i;
const CALLER_ROLES = /^(user|customer|caller|human)$/i;
const CALLER_LINE = /^(user|customer|caller|human)\s*:\s*(.*)$/i;

export type CallerMessage = {
  role?: string;
  content?: string;
  message?: string;
};

export function callerUtteranceText(
  transcript?: string | null,
  messages?: CallerMessage[] | null,
): string {
  const fromMessages = (messages || [])
    .filter((entry) => CALLER_ROLES.test(entry?.role || ''))
    .map((entry) => (entry.content || entry.message || '').trim())
    .filter(Boolean);

  if (fromMessages.length > 0) return fromMessages.join('\n');

  return (transcript || '')
    .split(/\n+/)
    .map((line) => {
      const match = line.trim().match(CALLER_LINE);
      return match ? match[2].trim() : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function isCallerUrgent(input: {
  structuredUrgency?: string | null;
  transcript?: string | null;
  messages?: CallerMessage[] | null;
}): boolean {
  const structured = (input.structuredUrgency || '').trim().toLowerCase();
  if (structured === 'urgent' || structured === 'emergency') return true;
  return URGENT_PATTERN.test(callerUtteranceText(input.transcript, input.messages));
}
