/**
 * Inbound-text forwarding for the ported Google Voice lines (main 440-8520, Ransom 789-5955).
 * Every text to those lines is relayed to the office phone (Liz by default). No reply goes back
 * to the customer and nothing is created in Jobber. Pure helpers here; the route does the I/O.
 */
import { PORTED_LINES } from '../phone-calls/config.ts';

/** Liz's Google Voice line (lizbeth@scwellservice.com, see ads/staff-lines.ts). Override with SMS_FORWARD_TO. */
export const DEFAULT_FORWARD_TO = '+16193208264';
/** A2P 10DLC registered service. Forwards send from its pool so carriers don't filter them. */
export const DEFAULT_FORWARD_MESSAGING_SERVICE_SID = 'MG66ff74e6d46a9e5439d0a2a718b3a14d';
/** Our own Twilio numbers. Texts from these are never forwarded (prevents loops). */
export const OWN_NUMBERS = new Set([
  '+17604408520', '+17607895955', '+17608237963', '+18773863995', '+17604630493', '+17608914264',
  '+17604540365', '+17603312502', '+17602791262', '+19516510957', '+17604937719',
]);
const MAX_SMS_BODY = 1500; // Twilio max is 1600; leave room
const MAX_MEDIA = 10;

const E164 = /^\+\d{10,15}$/;

export function forwardTargets(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.SMS_FORWARD_TO?.trim();
  const list = (raw ? raw.split(',') : [DEFAULT_FORWARD_TO]).map((s) => s.trim()).filter((x) => E164.test(x));
  return list;
}

export function forwardMessagingServiceSid(env: NodeJS.ProcessEnv = process.env): string {
  return env.SMS_FORWARD_MESSAGING_SERVICE_SID?.trim() || DEFAULT_FORWARD_MESSAGING_SERVICE_SID;
}

/** Which ported line was texted, or null if this number isn't one we forward. */
export function forwardLine(to: string | null | undefined): { key: string; number: string; label: string; source: string } | null {
  const hit = Object.entries(PORTED_LINES).find(([, l]) => l.number === (to ?? '').trim());
  if (!hit) return null;
  const [key, l] = hit;
  return { key, number: l.number, label: `${l.label} line`, source: l.source };
}

export function mediaUrls(params: Record<string, string>): string[] {
  const n = Math.min(parseInt(params.NumMedia || '0', 10) || 0, MAX_MEDIA);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const u = params[`MediaUrl${i}`];
    if (u && /^https:\/\//.test(u)) out.push(u);
  }
  return out;
}

/** "From +17605550100 to Main line: <body>" (+ photo note). */
export function buildForwardBody(params: Record<string, string>, lineLabel: string): string {
  const from = params.From || 'unknown';
  const text = (params.Body || '').trim();
  const media = mediaUrls(params);
  const note = media.length ? ` [${media.length} ${media.length === 1 ? 'photo/file' : 'photos/files'} attached]` : '';
  const head = `From ${from} to ${lineLabel}: `;
  let body = `${head}${text || (media.length ? '(no text)' : '(empty)')}${note}`;
  if (body.length > MAX_SMS_BODY) body = `${body.slice(0, MAX_SMS_BODY - 15)}... (truncated)`;
  return body;
}

export type ForwardPlan =
  | { action: 'forward'; to: string[]; body: string; mediaUrl: string[]; line: NonNullable<ReturnType<typeof forwardLine>> }
  | { action: 'skip'; reason: 'not_forwarded_line' | 'own_number' | 'no_target' };

export function planForward(params: Record<string, string>, env: NodeJS.ProcessEnv = process.env): ForwardPlan {
  const line = forwardLine(params.To);
  if (!line) return { action: 'skip', reason: 'not_forwarded_line' };
  const targets = forwardTargets(env);
  const from = (params.From || '').trim();
  if (OWN_NUMBERS.has(from) || targets.includes(from)) return { action: 'skip', reason: 'own_number' };
  const to = targets.filter((t) => !OWN_NUMBERS.has(t));
  if (!to.length) return { action: 'skip', reason: 'no_target' };
  return { action: 'forward', to, body: buildForwardBody(params, line.label), mediaUrl: mediaUrls(params), line };
}

/** Empty TwiML: Twilio sends nothing back to the texter. */
export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
