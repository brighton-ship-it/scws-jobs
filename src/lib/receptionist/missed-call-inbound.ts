/**
 * Persist inbound SMS onto the missed-call text that customer already received.
 * Reads and updates missed_call_texts only. Never sends a text and never changes
 * thread_status, Mike's tools, or the office forward.
 */
import { digits10 } from '../ads/call-dashboard.ts';

export interface InboundSmsInput {
  from: string;
  body: string;
  sid: string | null;
  now: Date;
}

type ThreadMessage = { role?: string; content?: string; at?: string; sid?: string | null; name?: string };

/** Same body from the texter in this window is the message the AI thread already stored. */
const DUP_MS = 3 * 60_000;

export function threadWithInbound(thread: unknown, inbound: { body: string; at: string; sid: string | null }): { thread: ThreadMessage[]; changed: boolean } {
  const list: ThreadMessage[] = Array.isArray(thread) ? thread.map((m) => (m && typeof m === 'object' ? { ...(m as ThreadMessage) } : {})) : [];
  const body = inbound.body.trim().slice(0, 1000);
  if (!body) return { thread: list, changed: false };
  if (inbound.sid && list.some((m) => m.sid && m.sid === inbound.sid)) return { thread: list, changed: false };
  const atMs = Date.parse(inbound.at);
  const dup = list.findIndex((m) => {
    if (m.role !== 'user') return false;
    if ((m.content || '').trim() !== body) return false;
    const t = Date.parse(m.at || '');
    return Number.isFinite(t) && Number.isFinite(atMs) && Math.abs(t - atMs) < DUP_MS;
  });
  if (dup >= 0) {
    if (inbound.sid && !list[dup].sid) {
      list[dup] = { ...list[dup], sid: inbound.sid };
      return { thread: list, changed: true };
    }
    return { thread: list, changed: false };
  }
  list.push({ role: 'user', content: body, at: inbound.at, ...(inbound.sid ? { sid: inbound.sid } : {}) });
  return { thread: list, changed: true };
}

/**
 * Attach this inbound text to the latest sent missed-call text for the number.
 * No row, empty body, or a copy already on the thread: no write.
 */
export async function recordInboundSms(db: any, input: InboundSmsInput): Promise<'saved' | 'none' | 'duplicate'> {
  const phone = digits10(input.from);
  const body = input.body.trim();
  if (!phone || !body || !db) return 'none';
  const found = await db.from('missed_call_texts').select('id, thread').eq('caller_phone', phone).eq('outcome', 'sent').order('sent_at', { ascending: false }).limit(1);
  if (found?.error || !found?.data?.[0]) return 'none';
  const row = found.data[0];
  const next = threadWithInbound(row.thread, { body, at: input.now.toISOString(), sid: input.sid });
  if (!next.changed) return 'duplicate';
  const upd = await db.from('missed_call_texts').update({
    thread: next.thread,
    last_inbound_at: input.now.toISOString(),
    updated_at: input.now.toISOString(),
  }).eq('id', row.id);
  if (upd?.error) return 'none';
  return 'saved';
}

/** Store Twilio's delivery callback. Does not send, and ignores unknown message sids. */
export async function saveDeliveryStatus(db: any, input: { sid: string; status: string; error: string | null; now: Date }): Promise<'saved' | 'missing' | 'ignored'> {
  const sid = input.sid.trim();
  const status = input.status.trim().toLowerCase();
  if (!sid || !status || !db) return 'ignored';
  const now = input.now.toISOString();
  const upd = await db.from('missed_call_texts').update({
    delivery_status: status,
    delivery_error: input.error,
    delivery_updated_at: now,
    updated_at: now,
  }).eq('twilio_message_sid', sid);
  const message = String(upd?.error?.message || '');
  if (upd?.error && /delivery_status|delivery_updated_at|delivery_error/i.test(message)) return 'missing';
  if (upd?.error) return 'ignored';
  return 'saved';
}
