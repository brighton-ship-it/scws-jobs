export const CHAT_OFFICE_EMAILS = [
  'brighton@scwellservice.com',
  'lizbeth@scwellservice.com',
] as const;

export const URGENT_PATTERN = /no water|emergency|flood|urgent/i;
export const PHONE_PATTERN = /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/;
export const CONTACT_PATTERN = /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|@/;

const MAX_HISTORY = 20;

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface VisitorInfo {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  pageUrl?: string | null;
}

export function isUrgentMessage(text: string): boolean {
  return URGENT_PATTERN.test(text);
}

export function hasContactInfo(text: string): boolean {
  return CONTACT_PATTERN.test(text);
}

export function sanitizeHistory(history: unknown): ChatTurn[] {
  if (!Array.isArray(history)) {
    return [];
  }

  const cleaned: ChatTurn[] = [];
  for (const item of history) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      continue;
    }
    const trimmed = content.trim();
    if (!trimmed) continue;
    cleaned.push({ role, content: trimmed });
  }

  return cleaned.slice(-MAX_HISTORY);
}

/** Drop a trailing user turn that repeats the current message (client included it). */
export function priorHistory(history: unknown, currentMessage: string): ChatTurn[] {
  const sanitized = sanitizeHistory(history);
  const last = sanitized[sanitized.length - 1];
  if (last?.role === 'user' && last.content === currentMessage.trim()) {
    return sanitized.slice(0, -1);
  }
  return sanitized;
}

function userTexts(turns: ChatTurn[]): string[] {
  return turns.filter((t) => t.role === 'user').map((t) => t.content);
}

/**
 * One email per session when the chat becomes a lead.
 * Trigger: current message is urgent, has phone/email, or this is the 3rd+ user turn.
 * Dedup: if earlier history already had a phone/email/urgent hit (or already
 * passed the 3rd-turn trigger), do not send again unless this message is
 * newly urgent and earlier ones were not.
 */
export function shouldSendLeadEmail(
  history: ChatTurn[],
  currentMessage: string
): boolean {
  const current = currentMessage.trim();
  if (!current) return false;

  const priorUser = userTexts(history);
  const currentUrgent = isUrgentMessage(current);
  const currentContact = hasContactInfo(current);
  const currentTurn = priorUser.length + 1;

  const priorUrgent = priorUser.some(isUrgentMessage);
  const priorContact = priorUser.some(hasContactInfo);
  const alreadyEmailed = priorUrgent || priorContact || priorUser.length >= 3;

  if (alreadyEmailed) {
    return currentUrgent && !priorUrgent;
  }

  return currentUrgent || currentContact || currentTurn >= 3;
}

export function extractPhone(text: string): string | null {
  const match = text.match(PHONE_PATTERN);
  return match ? match[0] : null;
}

export function extractTypedName(text: string): string | null {
  const match = text.match(
    /(?:my name is|i(?:'m| am)|this is)\s+([A-Za-z][A-Za-z'-]{0,30}(?:\s+[A-Za-z][A-Za-z'-]{0,30})?)/i
  );
  const name = match?.[1]?.trim();
  if (!name) return null;
  if (/^(calling|here|about|interested|looking)$/i.test(name)) return null;
  return name;
}

export function pageHost(pageUrl?: string | null): string | null {
  if (!pageUrl || typeof pageUrl !== 'string') return null;
  try {
    const host = new URL(pageUrl).hostname;
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function leadSubjectLabel(
  visitorInfo: VisitorInfo | undefined,
  transcriptTexts: string[]
): string {
  const typedName = visitorInfo?.name?.trim();
  if (typedName) return typedName;

  for (const text of transcriptTexts) {
    const fromMessage = extractTypedName(text);
    if (fromMessage) return fromMessage;
  }

  const visitorPhone = visitorInfo?.phone?.trim();
  if (visitorPhone) return visitorPhone;

  for (const text of transcriptTexts) {
    const phone = extractPhone(text);
    if (phone) return phone;
  }

  return pageHost(visitorInfo?.pageUrl) || 'website chat';
}

export function formatPacificTimestamp(date = new Date()): string {
  return date.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatTranscript(turns: ChatTurn[]): string {
  return turns
    .map((turn) => {
      const speaker = turn.role === 'user' ? 'User' : 'Sarah';
      return `${speaker}: ${turn.content}`;
    })
    .join('\n');
}

export function buildLeadEmail(options: {
  sessionId: string;
  visitorInfo?: VisitorInfo;
  history: ChatTurn[];
  userMessage: string;
  assistantReply: string;
  urgent: boolean;
  now?: Date;
}): { subject: string; text: string } {
  const {
    sessionId,
    visitorInfo,
    history,
    userMessage,
    assistantReply,
    urgent,
    now,
  } = options;

  const transcriptTurns: ChatTurn[] = [
    ...history,
    { role: 'user', content: userMessage.trim() },
    { role: 'assistant', content: assistantReply },
  ];
  const transcriptTexts = transcriptTurns.map((t) => t.content);
  const label = leadSubjectLabel(visitorInfo, transcriptTexts);
  const subject = `Sarah chat: ${label}${urgent ? ' ⚠️ URGENT' : ''}`;
  const pageUrl = visitorInfo?.pageUrl?.trim() || 'unknown';
  const timestamp = formatPacificTimestamp(now);

  const lines = [
    'Website chat with Sarah',
    '',
    `Page: ${pageUrl}`,
    `Session: ${sessionId}`,
    `Time: ${timestamp} PT`,
  ];
  if (urgent) {
    lines.push('', '⚠️ MARKED AS URGENT');
  }
  lines.push('', 'TRANSCRIPT:', formatTranscript(transcriptTurns));
  const text = lines.join('\n');

  return { subject, text };
}
